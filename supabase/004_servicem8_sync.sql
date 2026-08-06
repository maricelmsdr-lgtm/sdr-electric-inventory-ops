-- ============================================================
-- SDR Electric — ServiceM8 Job/Material Sync
--
-- One-way pull: ServiceM8 is the source of truth for jobs and
-- materials used. This migration adds the columns needed to
-- (a) avoid importing the same ServiceM8 job/material twice on
-- repeat syncs, and (b) hold anything the sync couldn't safely
-- apply automatically (unknown material, or not enough stock)
-- so it shows up for manual review instead of failing silently.
-- ============================================================

-- Track which ServiceM8 job a row came from, and mark it as
-- synced vs. manually entered.
alter table jobs add column if not exists servicem8_job_uuid text;
alter table jobs add column if not exists synced_from_servicem8 boolean default false;
create unique index if not exists jobs_servicem8_job_uuid_idx on jobs (servicem8_job_uuid) where servicem8_job_uuid is not null;

-- Track which ServiceM8 material a line item came from, so a
-- re-sync skips materials already applied instead of deducting
-- stock twice.
alter table job_line_items add column if not exists servicem8_material_uuid text;
create unique index if not exists job_line_items_servicem8_material_uuid_idx on job_line_items (servicem8_material_uuid) where servicem8_material_uuid is not null;

-- Last successful sync time, shown on the Integrations page.
alter table integrations add column if not exists last_synced_at timestamptz;

-- Materials from ServiceM8 that the sync could not safely apply:
-- either no matching part in the SDR catalog, or a matching part
-- with not enough stock on hand to deduct. Held here for manual
-- review/resolution rather than silently skipped or forced through.
create table if not exists unmatched_materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  job_id uuid references jobs(id) on delete cascade,
  servicem8_material_uuid text not null,
  raw_name text,
  qty numeric not null,
  unit_cost numeric(10,2) default 0,
  reason text not null default 'no_match', -- no_match | insufficient_stock
  status text not null default 'pending',  -- pending | resolved | ignored
  resolved_part_id uuid references parts(id),
  created_at timestamptz default now(),
  unique (job_id, servicem8_material_uuid)
);

alter table unmatched_materials enable row level security;

drop policy if exists "org read unmatched_materials" on unmatched_materials;
drop policy if exists "org write unmatched_materials" on unmatched_materials;
drop policy if exists "org update unmatched_materials" on unmatched_materials;

create policy "org read unmatched_materials" on unmatched_materials
  for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write unmatched_materials" on unmatched_materials
  for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update unmatched_materials" on unmatched_materials
  for update using (org_id = (select org_id from profiles where id = auth.uid()));
