-- ============================================================
-- REPLACEMENT: process_synced_materials
-- ServiceM8 -> Inventory deduction -> Job Issued Materials
-- ============================================================

create or replace function process_synced_materials(
  p_org_id uuid,
  p_location_id uuid,
  p_materials jsonb
)
returns table(
  deducted_count int,
  flagged_count int
)
language plpgsql
security definer
set search_path = public
as $$

declare
  m jsonb;

  v_part_id uuid;
  v_job_id uuid;
  v_material_uuid text;

  v_qty numeric;
  v_existing_qty numeric;
  v_delta numeric;

  v_unit_cost numeric;
  v_sale_cost numeric;

  v_stock numeric;

  v_existing_line_id uuid;
  v_existing_issued_id uuid;
  v_existing_issued_qty numeric;

  v_deducted int := 0;
  v_flagged int := 0;

begin

  -- ==========================================================
  -- PROCESS EACH SERVICE M8 MATERIAL
  -- ==========================================================

  for m in
    select *
    from jsonb_array_elements(
      coalesce(p_materials, '[]'::jsonb)
    )
  loop

    -- ========================================================
    -- READ PAYLOAD
    -- ========================================================

    v_part_id :=
      nullif(
        trim(m->>'part_id'),
        ''
      )::uuid;

    v_job_id :=
      nullif(
        trim(m->>'job_id'),
        ''
      )::uuid;

    v_material_uuid :=
      nullif(
        trim(m->>'servicem8_material_uuid'),
        ''
      );

    v_qty :=
      coalesce(
        nullif(m->>'qty', '')::numeric,
        0
      );

    v_unit_cost :=
      coalesce(
        nullif(m->>'unit_cost', '')::numeric,
        0
      );

    v_sale_cost :=
      coalesce(
        nullif(m->>'sale_cost', '')::numeric,
        0
      );

    -- ========================================================
    -- INVALID / ZERO QUANTITY
    -- ========================================================

    if v_qty <= 0 then
      continue;
    end if;


    -- ========================================================
    -- NO PART MATCH
    -- ========================================================

    if v_part_id is null then

      insert into unmatched_materials (
        org_id,
        job_id,
        servicem8_material_uuid,
        raw_name,
        qty,
        unit_cost,
        reason,
        status
      )
      values (
        p_org_id,
        v_job_id,
        v_material_uuid,
        coalesce(
          m->>'raw_name',
          '(unnamed)'
        ),
        v_qty,
        v_unit_cost,
        'no_match',
        'pending'
      )
      on conflict (
        job_id,
        servicem8_material_uuid
      )
      do update set
        raw_name = excluded.raw_name,
        qty = excluded.qty,
        unit_cost = excluded.unit_cost,
        reason = 'no_match',
        status = 'pending';

      v_flagged := v_flagged + 1;

      continue;

    end if;


    -- ========================================================
    -- FIND EXISTING SERVICE M8 JOB LINE
    --
    -- IMPORTANT:
    -- Match by BOTH job and ServiceM8 material UUID.
    -- ========================================================

    select
      id,
      qty
    into
      v_existing_line_id,
      v_existing_qty
    from job_line_items
    where job_id = v_job_id
      and servicem8_material_uuid = v_material_uuid
    limit 1;

    v_existing_qty :=
      coalesce(
        v_existing_qty,
        0
      );


    -- ========================================================
    -- CALCULATE NEW QUANTITY
    --
    -- First sync:
    -- ServiceM8 = 2
    -- Existing = 0
    -- Delta = 2
    --
    -- Later sync:
    -- ServiceM8 = 5
    -- Existing = 2
    -- Delta = 3
    --
    -- Only the additional 3 are deducted.
    -- ========================================================

    v_delta := v_qty - v_existing_qty;


    -- ========================================================
    -- EXISTING SERVICE M8 LINE
    -- ========================================================

    if v_existing_line_id is not null then

      -- ======================================================
      -- CHECK EXISTING ISSUED RECORD
      -- ======================================================

      select
        id,
        qty
      into
        v_existing_issued_id,
        v_existing_issued_qty
      from job_issued_materials
      where org_id = p_org_id
        and job_id = v_job_id
        and servicem8_material_uuid = v_material_uuid
      limit 1;

      v_existing_issued_qty :=
        coalesce(
          v_existing_issued_qty,
          0
        );


      -- ======================================================
      -- BACKFILL OLD SERVICE M8 MATERIAL
      --
      -- If the job line already exists but there is no issued
      -- record, the material was already processed previously.
      --
      -- Create the issued record WITHOUT deducting inventory.
      -- ======================================================

      if v_existing_issued_id is null then

        insert into job_issued_materials (
          org_id,
          job_id,
          part_id,
          qty,
          unit_cost,
          issued_by,
          issued_at,
          notes,
          servicem8_material_uuid
        )
        values (
          p_org_id,
          v_job_id,
          v_part_id,
          v_existing_qty,
          v_unit_cost,
          'ServiceM8 Auto Sync',
          now(),
          'Backfilled from previously processed ServiceM8 material.',
          v_material_uuid
        )
        on conflict (
          job_id,
          servicem8_material_uuid
        )
        do nothing;

        v_existing_issued_qty := v_existing_qty;

      end if;


      -- ======================================================
      -- NOTHING NEW TO DEDUCT
      -- ======================================================

      if v_delta <= 0 then

        update job_line_items
        set
          qty = v_qty,
          part_cost = v_unit_cost,
          sale_cost = v_sale_cost
        where id = v_existing_line_id;

        delete from unmatched_materials
        where job_id = v_job_id
          and servicem8_material_uuid = v_material_uuid;

        continue;

      end if;

    end if;


    -- ========================================================
    -- STOCK CHECK
    -- ========================================================

    select
      quantity_on_hand
    into
      v_stock
    from inventory_balances
    where org_id = p_org_id
      and part_id = v_part_id
      and location_id = p_location_id
    for update;

    v_stock :=
      coalesce(
        v_stock,
        0
      );


    -- ========================================================
    -- ZERO STOCK
    -- ========================================================

    if v_stock <= 0 then

      insert into unmatched_materials (
        org_id,
        job_id,
        servicem8_material_uuid,
        raw_name,
        qty,
        unit_cost,
        reason,
        status
      )
      values (
        p_org_id,
        v_job_id,
        v_material_uuid,
        coalesce(
          m->>'raw_name',
          '(unnamed)'
        ),
        v_qty,
        v_unit_cost,
        'insufficient_stock',
        'pending'
      )
      on conflict (
        job_id,
        servicem8_material_uuid
      )
      do update set
        raw_name = excluded.raw_name,
        qty = excluded.qty,
        unit_cost = excluded.unit_cost,
        reason = 'insufficient_stock',
        status = 'pending';

      v_flagged := v_flagged + 1;

      continue;

    end if;


    -- ========================================================
    -- INSUFFICIENT STOCK
    -- ========================================================

    if v_stock < v_delta then

      insert into unmatched_materials (
        org_id,
        job_id,
        servicem8_material_uuid,
        raw_name,
        qty,
        unit_cost,
        reason,
        status
      )
      values (
        p_org_id,
        v_job_id,
        v_material_uuid,
        coalesce(
          m->>'raw_name',
          '(unnamed)'
        ),
        v_qty,
        v_unit_cost,
        'insufficient_stock',
        'pending'
      )
      on conflict (
        job_id,
        servicem8_material_uuid
      )
      do update set
        raw_name = excluded.raw_name,
        qty = excluded.qty,
        unit_cost = excluded.unit_cost,
        reason = 'insufficient_stock',
        status = 'pending';

      v_flagged := v_flagged + 1;

      continue;

    end if;


    -- ========================================================
    -- SAFE TO DEDUCT
    -- ========================================================

    begin

      -- ======================================================
      -- ACTUAL INVENTORY DEDUCTION
      -- ======================================================

      perform apply_inventory_qty_change(
        p_org_id,
        v_part_id,
        p_location_id,
        -v_delta
      );


      -- ======================================================
      -- UPDATE / CREATE JOB LINE
      -- ======================================================

      if v_existing_line_id is not null then

        update job_line_items
        set
          qty = v_qty,
          part_cost = v_unit_cost,
          sale_cost = v_sale_cost
        where id = v_existing_line_id;

      else

        insert into job_line_items (
          job_id,
          part_id,
          qty,
          part_cost,
          sale_cost,
          servicem8_material_uuid
        )
        values (
          v_job_id,
          v_part_id,
          v_qty,
          v_unit_cost,
          v_sale_cost,
          v_material_uuid
        );

      end if;


      -- ======================================================
      -- UPDATE / CREATE ISSUED MATERIAL RECORD
      --
      -- The issued record represents the TOTAL quantity
      -- actually issued for this ServiceM8 material.
      --
      -- First sync:
      -- issued = 2
      --
      -- Later ServiceM8 quantity becomes 5:
      -- delta = 3
      -- issued = 2 + 3 = 5
      -- ======================================================

      insert into job_issued_materials (
        org_id,
        job_id,
        part_id,
        qty,
        unit_cost,
        issued_by,
        issued_at,
        notes,
        servicem8_material_uuid
      )
      values (
        p_org_id,
        v_job_id,
        v_part_id,
        v_delta,
        v_unit_cost,
        'ServiceM8 Auto Sync',
        now(),
        'Automatically issued from ServiceM8 job material.',
        v_material_uuid
      )
      on conflict (
        job_id,
        servicem8_material_uuid
      )
      do update set
        qty =
          job_issued_materials.qty
          + excluded.qty,

        part_id =
          excluded.part_id,

        unit_cost =
          excluded.unit_cost,

        issued_by =
          'ServiceM8 Auto Sync',

        issued_at =
          now(),

        notes =
          'Automatically issued from ServiceM8 job material.';


      -- ======================================================
      -- REMOVE OLD PENDING FLAG
      -- ======================================================

      delete from unmatched_materials
      where job_id = v_job_id
        and servicem8_material_uuid = v_material_uuid;


      v_deducted := v_deducted + 1;


    exception

      when check_violation then

        -- ====================================================
        -- ABSOLUTE INVENTORY SAFETY
        -- ====================================================

        insert into unmatched_materials (
          org_id,
          job_id,
          servicem8_material_uuid,
          raw_name,
          qty,
          unit_cost,
          reason,
          status
        )
        values (
          p_org_id,
          v_job_id,
          v_material_uuid,
          coalesce(
            m->>'raw_name',
            '(unnamed)'
          ),
          v_qty,
          v_unit_cost,
          'insufficient_stock',
          'pending'
        )
        on conflict (
          job_id,
          servicem8_material_uuid
        )
        do update set
          raw_name = excluded.raw_name,
          qty = excluded.qty,
          unit_cost = excluded.unit_cost,
          reason = 'insufficient_stock',
          status = 'pending';

        v_flagged := v_flagged + 1;

    end;

  end loop;


  return query
  select
    v_deducted,
    v_flagged;

end;

$$;


-- ============================================================
-- GRANTS
-- ============================================================

grant execute
on function process_synced_materials(
  uuid,
  uuid,
  jsonb
)
to authenticated;

grant execute
on function process_synced_materials(
  uuid,
  uuid,
  jsonb
)
to service_role;