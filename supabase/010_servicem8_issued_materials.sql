-- ============================================================
-- SDR ELECTRIC INVENTORY OPS
-- 010 — ServiceM8 Automatic Issued Materials
--
-- PURPOSE
-- -------
-- ServiceM8 job materials are actual materials used on jobs.
--
-- The existing sync already:
--   1. matches ServiceM8 material -> SDR part
--   2. deducts inventory from inventory_balances
--   3. records the ServiceM8 material in job_line_items
--
-- PROBLEM:
-- The Job Detail "Issued Materials" tab reads from
-- job_issued_materials, but the sync was not writing there.
--
-- THIS MIGRATION FIXES THAT.
--
-- RULE:
--   NEVER deduct if available stock is zero.
--   NEVER allow stock to become negative.
--
-- ALSO:
--   Existing previously-deducted ServiceM8 job_line_items are
--   backfilled into job_issued_materials WITHOUT deducting stock
--   a second time.
--
-- Run this entire file in:
-- Supabase -> SQL Editor -> New Query -> Run
-- ============================================================


-- ============================================================
-- 1. ISSUED MATERIALS TABLE
-- ============================================================

create table if not exists job_issued_materials (
  id uuid primary key default gen_random_uuid(),

  org_id uuid not null references orgs(id),

  job_id uuid not null
    references jobs(id)
    on delete cascade,

  part_id uuid not null
    references parts(id),

  qty numeric not null
    check (qty > 0),

  unit_cost numeric(10,2) not null default 0,

  issued_by text,

  issued_at timestamptz not null default now(),

  notes text,

  -- ServiceM8 Job Material UUID.
  -- Used for idempotency and automatic synchronization.
  servicem8_material_uuid text
);


-- ============================================================
-- 2. ADD MISSING COLUMNS SAFELY
-- ============================================================

alter table job_issued_materials
  add column if not exists org_id uuid references orgs(id);

alter table job_issued_materials
  add column if not exists job_id uuid references jobs(id) on delete cascade;

alter table job_issued_materials
  add column if not exists part_id uuid references parts(id);

alter table job_issued_materials
  add column if not exists qty numeric;

alter table job_issued_materials
  add column if not exists unit_cost numeric(10,2) default 0;

alter table job_issued_materials
  add column if not exists issued_by text;

alter table job_issued_materials
  add column if not exists issued_at timestamptz default now();

alter table job_issued_materials
  add column if not exists notes text;

alter table job_issued_materials
  add column if not exists servicem8_material_uuid text;


-- ============================================================
-- 3. IDEMPOTENCY INDEX
--
-- One issued-material record per ServiceM8 Job Material line.
-- If ServiceM8 quantity changes from 2 -> 5, we deduct only
-- the additional 3 and increase the issued record to 5.
-- ============================================================

create unique index if not exists
  job_issued_materials_servicem8_uuid_idx
on job_issued_materials (
  job_id,
  servicem8_material_uuid
)
where servicem8_material_uuid is not null;


-- ============================================================
-- 4. RLS
-- ============================================================

alter table job_issued_materials
  enable row level security;


drop policy if exists
  "org read job_issued_materials"
on job_issued_materials;

drop policy if exists
  "org write job_issued_materials"
on job_issued_materials;

drop policy if exists
  "org update job_issued_materials"
on job_issued_materials;

drop policy if exists
  "org delete job_issued_materials"
on job_issued_materials;


create policy
  "org read job_issued_materials"
on job_issued_materials
for select
using (
  org_id = (
    select org_id
    from profiles
    where id = auth.uid()
  )
);


create policy
  "org write job_issued_materials"
on job_issued_materials
for insert
with check (
  org_id = (
    select org_id
    from profiles
    where id = auth.uid()
  )
);


create policy
  "org update job_issued_materials"
on job_issued_materials
for update
using (
  org_id = (
    select org_id
    from profiles
    where id = auth.uid()
  )
)
with check (
  org_id = (
    select org_id
    from profiles
    where id = auth.uid()
  )
);


create policy
  "org delete job_issued_materials"
on job_issued_materials
for delete
using (
  org_id = (
    select org_id
    from profiles
    where id = auth.uid()
  )
);


-- ============================================================
-- 5. AUTOMATIC SERVICE M8 MATERIAL PROCESSOR
--
-- IMPORTANT:
--
-- This replaces the previous process_synced_materials function.
--
-- The function:
--
-- A. Matches material to an SDR part.
--
-- B. If no matching part:
--      -> no inventory deduction
--      -> put into unmatched_materials
--
-- C. If matching part:
--      -> determine how much ServiceM8 says is currently used
--
-- D. Compare against existing job_line_items.
--
-- E. Only the NEW quantity difference is deducted.
--
-- F. Explicitly checks stock before deduction.
--
-- G. ZERO STOCK = NO DEDUCTION.
--
-- H. INSUFFICIENT STOCK = NO DEDUCTION.
--
-- I. Successful deduction:
--      -> update inventory_balances
--      -> update/create job_line_items
--      -> update/create job_issued_materials
--
-- J. Existing job_line_items without an issued record:
--      -> backfill issued record
--      -> DO NOT deduct again.
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

    -- --------------------------------------------------------
    -- READ PAYLOAD
    -- --------------------------------------------------------

    v_part_id :=
      nullif(
        m->>'part_id',
        ''
      )::uuid;

    v_job_id :=
      nullif(
        m->>'job_id',
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


    -- --------------------------------------------------------
    -- INVALID / ZERO QUANTITY
    -- --------------------------------------------------------

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


      v_flagged :=
        v_flagged + 1;

      continue;

    end if;


    -- ========================================================
    -- FIND EXISTING SERVICE M8 LINE
    --
    -- This is what prevents duplicate deductions.
    -- ========================================================

    select
      id,
      qty

    into
      v_existing_line_id,
      v_existing_qty

    from job_line_items

    where servicem8_material_uuid =
      v_material_uuid

    limit 1;


    v_existing_qty :=
      coalesce(
        v_existing_qty,
        0
      );


    -- ========================================================
    -- CALCULATE DIFFERENCE
    --
    -- Example:
    --
    -- First sync:
    -- ServiceM8 = 2
    -- Existing = 0
    -- Delta = 2
    --
    -- Next sync:
    -- ServiceM8 = 5
    -- Existing = 2
    -- Delta = 3
    --
    -- Only 3 more are deducted.
    -- ========================================================

    v_delta :=
      v_qty - v_existing_qty;


    -- ========================================================
    -- EXISTING LINE ALREADY EXISTS
    -- ========================================================

    if v_existing_line_id is not null then

      -- ------------------------------------------------------
      -- BACKFILL ISSUED MATERIAL RECORD
      --
      -- This handles materials that were already deducted by
      -- the old sync function before job_issued_materials was
      -- connected.
      --
      -- CRITICAL:
      -- This does NOT deduct inventory.
      -- ------------------------------------------------------

      select id
      into v_existing_issued_id

      from job_issued_materials

      where job_id = v_job_id

        and servicem8_material_uuid =
          v_material_uuid

      limit 1;


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

      end if;


      -- ------------------------------------------------------
      -- NOTHING NEW TO DEDUCT
      -- ------------------------------------------------------

      if v_delta <= 0 then

        update job_line_items

        set
          qty = v_qty,
          part_cost = v_unit_cost,
          sale_cost = v_sale_cost

        where id =
          v_existing_line_id;


        delete from unmatched_materials

        where job_id = v_job_id

          and servicem8_material_uuid =
            v_material_uuid;


        continue;

      end if;

    end if;


    -- ========================================================
    -- STOCK CHECK
    --
    -- THIS IS THE HARD SAFETY RULE.
    --
    -- If stock is:
    --
    -- 0       -> DO NOT DEDUCT
    -- 1       -> cannot deduct 2
    -- 5       -> can deduct 2
    --
    -- We never allow negative inventory.
    -- ========================================================

    select
      quantity_on_hand

    into
      v_stock

    from inventory_balances

    where org_id =
      p_org_id

      and part_id =
        v_part_id

      and location_id =
        p_location_id

    for update;


    v_stock :=
      coalesce(
        v_stock,
        0
      );


    -- --------------------------------------------------------
    -- ZERO STOCK
    -- --------------------------------------------------------

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


      v_flagged :=
        v_flagged + 1;

      continue;

    end if;


    -- --------------------------------------------------------
    -- NOT ENOUGH STOCK
    -- --------------------------------------------------------

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


      v_flagged :=
        v_flagged + 1;

      continue;

    end if;


    -- ========================================================
    -- SAFE TO DEDUCT
    -- ========================================================

    begin

      -- ------------------------------------------------------
      -- ACTUAL INVENTORY DEDUCTION
      --
      -- Negative delta = stock leaving inventory.
      -- ------------------------------------------------------

      perform apply_inventory_qty_change(
        p_org_id,
        v_part_id,
        p_location_id,
        -v_delta
      );


      -- ------------------------------------------------------
      -- UPDATE / CREATE JOB LINE
      -- ------------------------------------------------------

      if v_existing_line_id is not null then

        update job_line_items

        set
          qty = v_qty,
          part_cost = v_unit_cost,
          sale_cost = v_sale_cost

        where id =
          v_existing_line_id;

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


      -- ------------------------------------------------------
      -- UPDATE / CREATE ISSUED MATERIAL
      --
      -- This is the missing piece that makes the Job Detail
      -- "Issued Materials" tab show the automatic deduction.
      -- ------------------------------------------------------

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

        unit_cost =
          excluded.unit_cost,

        issued_by =
          'ServiceM8 Auto Sync',

        issued_at =
          now(),

        notes =
          'Automatically issued from ServiceM8 job material.';


      -- ------------------------------------------------------
      -- REMOVE OLD PENDING FLAG
      -- ------------------------------------------------------

      delete from unmatched_materials

      where job_id =
        v_job_id

        and servicem8_material_uuid =
          v_material_uuid;


      v_deducted :=
        v_deducted + 1;


    exception

      when check_violation then

        -- ----------------------------------------------------
        -- ABSOLUTE SAFETY NET
        --
        -- If the inventory balance CHECK constraint catches a
        -- negative quantity, nothing from this transaction
        -- block is committed.
        --
        -- No issued record is created.
        -- ----------------------------------------------------

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


        v_flagged :=
          v_flagged + 1;

    end;

  end loop;


  return query

  select
    v_deducted,
    v_flagged;

end;

$$;


-- ============================================================
-- 6. GRANT RPC EXECUTION
--
-- The ServiceM8 sync uses the Supabase service-role client,
-- but granting execution keeps the function callable through
-- Supabase RPC infrastructure.
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


-- ============================================================
-- END
-- ============================================================