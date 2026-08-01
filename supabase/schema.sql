-- ============================================================
-- SDR Electric — Inventory Ops
-- Run this whole file in Supabase → SQL Editor → New query → Run
-- ============================================================

-- Organizations & Users
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table profiles (
  id uuid primary key references auth.users(id),
  org_id uuid references orgs(id),
  full_name text,
  role text default 'technician' -- admin | dispatcher | technician
);

-- Bootstrap: one org for now. Every new signup auto-joins it.
insert into orgs (name) values ('SDR Electric');

create or replace function handle_new_user()
returns trigger as $$
declare
  default_org_id uuid;
begin
  select id into default_org_id from orgs order by name limit 1;
  insert into profiles (id, org_id, full_name)
  values (new.id, default_org_id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Parts Catalog
create table parts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  part_no text not null,
  sku text not null,
  category text not null,        -- Electrical | Plumbing | HVAC | General
  location text,
  qty integer not null default 0,
  min_reorder integer not null default 0,
  unit_cost numeric(10,2) not null default 0,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (org_id, sku)
);

-- Fleet
create table fleet (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  truck_number text not null,
  nickname text,
  driver text,
  plate text,
  home_base text,
  status text default 'Active'
);

-- Jobs
create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  job_no text not null,
  client text not null,
  address text,
  job_date date not null,
  technician text,
  created_by uuid references profiles(id)
);

create table job_line_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  part_id uuid references parts(id),
  qty integer not null,
  part_cost numeric(10,2) not null,
  sale_cost numeric(10,2) not null
);

-- Purchase Orders
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  po_no text not null,
  vendor text not null,
  po_date date not null,
  status text default 'Ordered' -- Draft | Ordered | Received | Cancelled
);

create table po_line_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid references purchase_orders(id) on delete cascade,
  part_id uuid references parts(id),
  qty integer not null,
  unit_cost numeric(10,2) not null
);

-- Truck Load Outs
create table truck_loadouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  loadout_date date not null,
  truck_id uuid references fleet(id),
  direction text not null, -- Load Out | Used on Job | Return to Warehouse
  job_ref text,
  technician text
);

create table loadout_line_items (
  id uuid primary key default gen_random_uuid(),
  loadout_id uuid references truck_loadouts(id) on delete cascade,
  part_id uuid references parts(id),
  qty integer not null
);

-- Field Requests
create table field_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  requested_by text not null,
  truck text,
  part_id uuid references parts(id),
  qty_requested integer not null,
  priority text default 'Normal', -- Low | Normal | Urgent
  status text default 'Pending',  -- Pending | Approved | Fulfilled | Denied
  notes text
);

-- Stock Adjustments
create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  adj_date date not null,
  part_id uuid references parts(id),
  qty_change integer not null,
  reason text, -- Damaged | Lost | Found | Correction | Return
  adjusted_by text,
  notes text
);

-- Cycle Counts
create table cycle_counts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  count_date date not null,
  location text,
  part_id uuid references parts(id),
  system_qty integer not null,
  counted_qty integer not null,
  counted_by text
);

-- Stock In (Receiving)
create table stock_ins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  received_date date not null,
  part_id uuid references parts(id),
  qty integer not null,
  vendor text,
  po_ref text,
  received_by text
);

-- Activity Log
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  user_id uuid references profiles(id),
  message text not null,
  created_at timestamptz default now()
);

-- Integrations
create table integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  provider text not null, -- qbo | servicem8 | housecallpro | ghl
  connected boolean default false,
  connected_at timestamptz,
  unique (org_id, provider)
);

create table integration_tokens (
  integration_id uuid primary key references integrations(id) on delete cascade,
  access_token text,
  refresh_token text,
  expires_at timestamptz
);

-- Quantity helper (call this from the same transaction as any insert
-- that should move stock: jobs, stock_adjustments, stock_ins, etc.)
create or replace function apply_qty_change(p_part_id uuid, p_delta integer)
returns void as $$
  update parts set qty = qty + p_delta, updated_at = now() where id = p_part_id;
$$ language sql;

-- ============================================================
-- Row Level Security — scopes every table to the caller's org
-- ============================================================
alter table parts enable row level security;
alter table fleet enable row level security;
alter table jobs enable row level security;
alter table job_line_items enable row level security;
alter table purchase_orders enable row level security;
alter table po_line_items enable row level security;
alter table truck_loadouts enable row level security;
alter table loadout_line_items enable row level security;
alter table field_requests enable row level security;
alter table stock_adjustments enable row level security;
alter table cycle_counts enable row level security;
alter table stock_ins enable row level security;
alter table activity_log enable row level security;
alter table integrations enable row level security;
alter table profiles enable row level security;

create policy "org read parts" on parts for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write parts" on parts for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update parts" on parts for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete parts" on parts for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read fleet" on fleet for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write fleet" on fleet for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update fleet" on fleet for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete fleet" on fleet for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read jobs" on jobs for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write jobs" on jobs for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update jobs" on jobs for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete jobs" on jobs for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read job_line_items" on job_line_items for select using (job_id in (select id from jobs where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org write job_line_items" on job_line_items for insert with check (job_id in (select id from jobs where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org update job_line_items" on job_line_items for update using (job_id in (select id from jobs where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org delete job_line_items" on job_line_items for delete using (job_id in (select id from jobs where org_id = (select org_id from profiles where id = auth.uid())));

create policy "org read pos" on purchase_orders for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write pos" on purchase_orders for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update pos" on purchase_orders for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete pos" on purchase_orders for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read po_line_items" on po_line_items for select using (po_id in (select id from purchase_orders where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org write po_line_items" on po_line_items for insert with check (po_id in (select id from purchase_orders where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org update po_line_items" on po_line_items for update using (po_id in (select id from purchase_orders where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org delete po_line_items" on po_line_items for delete using (po_id in (select id from purchase_orders where org_id = (select org_id from profiles where id = auth.uid())));

create policy "org read loadouts" on truck_loadouts for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write loadouts" on truck_loadouts for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update loadouts" on truck_loadouts for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete loadouts" on truck_loadouts for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read loadout_line_items" on loadout_line_items for select using (loadout_id in (select id from truck_loadouts where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org write loadout_line_items" on loadout_line_items for insert with check (loadout_id in (select id from truck_loadouts where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org update loadout_line_items" on loadout_line_items for update using (loadout_id in (select id from truck_loadouts where org_id = (select org_id from profiles where id = auth.uid())));
create policy "org delete loadout_line_items" on loadout_line_items for delete using (loadout_id in (select id from truck_loadouts where org_id = (select org_id from profiles where id = auth.uid())));

create policy "org read field_requests" on field_requests for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write field_requests" on field_requests for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update field_requests" on field_requests for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete field_requests" on field_requests for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read stock_adjustments" on stock_adjustments for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write stock_adjustments" on stock_adjustments for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update stock_adjustments" on stock_adjustments for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete stock_adjustments" on stock_adjustments for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read cycle_counts" on cycle_counts for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write cycle_counts" on cycle_counts for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update cycle_counts" on cycle_counts for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete cycle_counts" on cycle_counts for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read stock_ins" on stock_ins for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write stock_ins" on stock_ins for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update stock_ins" on stock_ins for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete stock_ins" on stock_ins for delete using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read activity_log" on activity_log for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write activity_log" on activity_log for insert with check (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org read integrations" on integrations for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write integrations" on integrations for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update integrations" on integrations for update using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "read own profile" on profiles for select using (id = auth.uid());
create policy "update own profile" on profiles for update using (id = auth.uid());
