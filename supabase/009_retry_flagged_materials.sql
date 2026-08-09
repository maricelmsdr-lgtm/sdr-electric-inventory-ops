-- ============================================================
-- Fixes materials getting permanently stuck in Needs Review even after
-- matching improved. Previously, once a material was flagged (no_match /
-- insufficient_stock), every later sync skipped it forever via a
-- "flaggedUuids" exclusion in the route — so materials flagged before
-- catalog-code matching, bundle-header filtering, or the alias system
-- existed never got a second chance once those improvements landed.
--
-- The app side (route.js) now only permanently excludes a material once
-- someone has made a FINAL decision on it (resolved or ignored) — a
-- "pending" flag gets retried on every sync. That means
-- process_synced_materials can now be called again for the SAME
-- servicem8_material_uuid it already flagged once, so it needs to upsert
-- instead of blind-insert (the existing unique constraint on
-- (job_id, servicem8_material_uuid) makes this straightforward), and
-- clean up any stale pending flag once a material finally does match.
--
-- Run this in Supabase → SQL Editor → New query → Run.
-- ============================================================

create or replace function process_synced_materials(p_org_id uuid, p_location_id uuid, p_materials jsonb)
returns table(deducted_count int, flagged_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb;
  v_part_id uuid;
  v_qty numeric;
  v_job_id uuid;
  v_material_uuid text;
  v_deducted int := 0;
  v_flagged int := 0;
begin
  for m in select * from jsonb_array_elements(p_materials)
  loop
    v_part_id := nullif(m->>'part_id', '')::uuid;
    v_qty := (m->>'qty')::numeric;
    v_job_id := (m->>'job_id')::uuid;
    v_material_uuid := m->>'servicem8_material_uuid';

    if v_part_id is null then
      insert into unmatched_materials (org_id, job_id, servicem8_material_uuid, raw_name, qty, unit_cost, reason, status)
      values (p_org_id, v_job_id, v_material_uuid, m->>'raw_name', v_qty, (m->>'unit_cost')::numeric, 'no_match', 'pending')
      on conflict (job_id, servicem8_material_uuid) do update set
        raw_name = excluded.raw_name, qty = excluded.qty, unit_cost = excluded.unit_cost, reason = excluded.reason;
      v_flagged := v_flagged + 1;
      continue;
    end if;

    begin
      perform apply_inventory_qty_change(p_org_id, v_part_id, p_location_id, -v_qty);
      insert into job_line_items (job_id, part_id, qty, part_cost, sale_cost, servicem8_material_uuid)
      values (v_job_id, v_part_id, v_qty, (m->>'unit_cost')::numeric, (m->>'sale_cost')::numeric, v_material_uuid);
      -- Clean up a stale pending flag now that this material — which may
      -- have been flagged by an earlier, less capable version of the
      -- matcher — has finally matched successfully.
      delete from unmatched_materials where job_id = v_job_id and servicem8_material_uuid = v_material_uuid;
      v_deducted := v_deducted + 1;
    exception when check_violation then
      insert into unmatched_materials (org_id, job_id, servicem8_material_uuid, raw_name, qty, unit_cost, reason, status)
      values (p_org_id, v_job_id, v_material_uuid, m->>'raw_name', v_qty, (m->>'unit_cost')::numeric, 'insufficient_stock', 'pending')
      on conflict (job_id, servicem8_material_uuid) do update set
        raw_name = excluded.raw_name, qty = excluded.qty, unit_cost = excluded.unit_cost, reason = excluded.reason;
      v_flagged := v_flagged + 1;
    end;
  end loop;

  return query select v_deducted, v_flagged;
end;
$$;
