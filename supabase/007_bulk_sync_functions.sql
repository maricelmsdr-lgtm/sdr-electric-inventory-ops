-- ============================================================
-- Fixes the ServiceM8 sync still timing out at Vercel's 60s cap even
-- after batching the app-side loops. The Vercel function logs showed
-- the real problem: one HTTP round trip PER JOB (upsert) and PER
-- MATERIAL (stock deduction + insert) to Supabase. A busy shop's
-- 90-day window can easily mean several hundred jobs + material
-- lines — several hundred to a thousand+ separate network calls,
-- which no reasonable client-side concurrency reliably finishes in
-- 60 seconds.
--
-- This migration moves both loops INTO Postgres as a single call
-- each: the whole batch of jobs (or materials) is sent as one jsonb
-- array, and the database loops through it internally — no network
-- round trip per row. Run this whole file in Supabase → SQL Editor →
-- New query → Run.
-- ============================================================

-- Upserts many synced ServiceM8 jobs in one call. Relies on the existing
-- partial unique index on servicem8_job_uuid (004_servicem8_sync.sql).
-- Returns id + servicem8_job_uuid for every row touched, so the caller
-- can build its uuid → id map without a separate query.
create or replace function upsert_synced_jobs(p_jobs jsonb)
returns table(id uuid, servicem8_job_uuid text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into jobs (org_id, job_no, client, address, job_date, location_id, servicem8_job_uuid, synced_from_servicem8)
  select
    (x->>'org_id')::uuid,
    x->>'job_no',
    x->>'client',
    x->>'address',
    (x->>'job_date')::date,
    (x->>'location_id')::uuid,
    x->>'servicem8_job_uuid',
    true
  from jsonb_array_elements(p_jobs) as x
  on conflict (servicem8_job_uuid) where servicem8_job_uuid is not null
  do update set
    job_no = excluded.job_no,
    client = excluded.client,
    address = excluded.address,
    job_date = excluded.job_date,
    location_id = excluded.location_id,
    synced_from_servicem8 = true
  returning jobs.id, jobs.servicem8_job_uuid;
end;
$$;

-- Processes many synced ServiceM8 material lines in one call: for each,
-- either deducts stock + records a job_line_items row, or (no catalog
-- match / not enough stock) records an unmatched_materials row for
-- review — exactly what the app-side loop did per item, just run inside
-- Postgres instead of one HTTP call per item. Matching materials to
-- parts by SKU/part_no stays in the app (it's a cheap in-memory lookup,
-- no need to move it here) — this function just takes the already-
-- resolved part_id (or null for "no match") per material.
--
-- Each iteration's exception handler relies on inventory_balances'
-- existing CHECK (quantity_on_hand >= 0) constraint — apply_inventory_
-- qty_change raises a check_violation when a deduction would go
-- negative, which is caught here per-row (via plpgsql's implicit
-- per-block savepoint) so one bad line can't abort the whole batch.
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
  v_deducted int := 0;
  v_flagged int := 0;
begin
  for m in select * from jsonb_array_elements(p_materials)
  loop
    v_part_id := nullif(m->>'part_id', '')::uuid;
    v_qty := (m->>'qty')::numeric;

    if v_part_id is null then
      insert into unmatched_materials (org_id, job_id, servicem8_material_uuid, raw_name, qty, unit_cost, reason)
      values (p_org_id, (m->>'job_id')::uuid, m->>'servicem8_material_uuid', m->>'raw_name', v_qty, (m->>'unit_cost')::numeric, 'no_match');
      v_flagged := v_flagged + 1;
      continue;
    end if;

    begin
      perform apply_inventory_qty_change(p_org_id, v_part_id, p_location_id, -v_qty);
      insert into job_line_items (job_id, part_id, qty, part_cost, sale_cost, servicem8_material_uuid)
      values ((m->>'job_id')::uuid, v_part_id, v_qty, (m->>'unit_cost')::numeric, (m->>'sale_cost')::numeric, m->>'servicem8_material_uuid');
      v_deducted := v_deducted + 1;
    exception when check_violation then
      insert into unmatched_materials (org_id, job_id, servicem8_material_uuid, raw_name, qty, unit_cost, reason)
      values (p_org_id, (m->>'job_id')::uuid, m->>'servicem8_material_uuid', m->>'raw_name', v_qty, (m->>'unit_cost')::numeric, 'insufficient_stock');
      v_flagged := v_flagged + 1;
    end;
  end loop;

  return query select v_deducted, v_flagged;
end;
$$;
