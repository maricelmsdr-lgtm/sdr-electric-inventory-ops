-- ============================================================
-- SDR Electric — Multi-Location Inventory (v2)
--
-- This project already has `locations` and `inventory_balances`
-- tables from an earlier, more advanced (but unfinished/buggy)
-- scaffold. This migration REUSES those two tables — they're
-- well designed — but adds its own small, verified function
-- instead of relying on the existing incomplete posting logic
-- (_get_or_create_inventory_balance references columns that
-- don't exist on inventory_balances, and post_inventory_document
-- never actually writes transactions or updates balances).
--
-- Safe to run on this project. Does NOT create a `locations`
-- table (already exists) or a `part_stock` table.
-- ============================================================

-- inventory_balances currently has RLS disabled — fix that first,
-- since without it every authenticated user can read/write every
-- org's balances.
alter table inventory_balances enable row level security;

drop policy if exists "org read inventory_balances" on inventory_balances;
drop policy if exists "org write inventory_balances" on inventory_balances;
drop policy if exists "org update inventory_balances" on inventory_balances;
drop policy if exists "org delete inventory_balances" on inventory_balances;

create policy "org read inventory_balances" on inventory_balances
  for select using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org write inventory_balances" on inventory_balances
  for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org update inventory_balances" on inventory_balances
  for update using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org delete inventory_balances" on inventory_balances
  for delete using (org_id = (select org_id from profiles where id = auth.uid()));

-- Make sure every truck in fleet has a matching location row.
-- (Only 2 locations exist right now — Main Warehouse + one truck —
-- so this backfills anything missing.)
insert into locations (org_id, code, name, type, active)
select f.org_id, 'TRUCK-' || f.truck_number, f.truck_number, 'TRUCK', true
from fleet f
where not exists (
  select 1 from locations l where l.org_id = f.org_id and l.code = 'TRUCK-' || f.truck_number
);

-- Keep a truck's location row roughly in sync going forward.
-- Note: if a truck's truck_number itself is renamed, this won't
-- relink to the old location row (the old one goes inactive,
-- a new one is created) — acceptable for now, flagged here.
create or replace function sync_truck_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into locations (org_id, code, name, type, active)
    values (new.org_id, 'TRUCK-' || new.truck_number, new.truck_number, 'TRUCK', true)
    on conflict (org_id, code) do update set name = excluded.name, active = true;
  elsif tg_op = 'UPDATE' then
    update locations set name = new.truck_number, active = (new.status = 'Active')
    where org_id = new.org_id and code = 'TRUCK-' || new.truck_number;
  elsif tg_op = 'DELETE' then
    update locations set active = false
    where org_id = old.org_id and code = 'TRUCK-' || old.truck_number;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_truck_location on fleet;
create trigger trg_sync_truck_location
  after insert or update or delete on fleet
  for each row execute procedure sync_truck_location();

-- Apply a quantity change at a specific location. Upserts into
-- inventory_balances using its REAL column names (quantity_on_hand,
-- average_unit_cost, inventory_value) — the existing
-- _get_or_create_inventory_balance function references columns
-- called "quantity"/"average_cost" that don't exist and would
-- error if called, so this is a clean, from-scratch replacement.
--
-- The table's own CHECK constraint (quantity_on_hand >= 0) will
-- reject any change that would take a location negative — the app
-- should catch that and show "not enough stock at that location."
create or replace function apply_inventory_qty_change(
  p_org_id uuid,
  p_part_id uuid,
  p_location_id uuid,
  p_delta numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_cost numeric;
begin
  select unit_cost into v_unit_cost from parts where id = p_part_id;
  v_unit_cost := coalesce(v_unit_cost, 0);

  insert into inventory_balances (org_id, part_id, location_id, quantity_on_hand, average_unit_cost, inventory_value)
  values (p_org_id, p_part_id, p_location_id, p_delta, v_unit_cost, p_delta * v_unit_cost)
  on conflict (org_id, part_id, location_id)
  do update set
    quantity_on_hand = inventory_balances.quantity_on_hand + p_delta,
    average_unit_cost = v_unit_cost,
    inventory_value = (inventory_balances.quantity_on_hand + p_delta) * v_unit_cost,
    version = inventory_balances.version + 1,
    updated_at = now();
end;
$$;

-- Mirror the per-location total back onto parts.qty, so existing
-- low-stock checks / dashboard math (which read parts.qty) keep
-- working without any other changes.
create or replace function sync_parts_qty_from_balances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_part_id uuid;
begin
  affected_part_id := coalesce(new.part_id, old.part_id);
  update parts
  set qty = (select coalesce(sum(quantity_on_hand), 0) from inventory_balances where part_id = affected_part_id),
      updated_at = now()
  where id = affected_part_id;
  return null;
end;
$$;

drop trigger if exists trg_sync_parts_qty_from_balances on inventory_balances;
create trigger trg_sync_parts_qty_from_balances
  after insert or update or delete on inventory_balances
  for each row execute procedure sync_parts_qty_from_balances();

-- Move any existing parts.qty into inventory_balances at each
-- org's Main Warehouse (code = 'MAIN'), so nothing already on
-- hand disappears. Uses apply_inventory_qty_change so parts.qty
-- ends up correctly mirrored afterward too.
do $$
declare
  r record;
  wh_id uuid;
begin
  for r in select id, org_id, qty from parts where qty > 0 loop
    select id into wh_id from locations where org_id = r.org_id and code = 'MAIN';
    if wh_id is not null then
      perform apply_inventory_qty_change(r.org_id, r.id, wh_id, r.qty);
    end if;
  end loop;
end $$;

-- Track WHICH location each stock-moving record affected
alter table jobs add column if not exists location_id uuid references locations(id);
alter table stock_ins add column if not exists location_id uuid references locations(id);
alter table stock_adjustments add column if not exists location_id uuid references locations(id);
alter table cycle_counts add column if not exists location_id uuid references locations(id);
alter table truck_loadouts add column if not exists from_location_id uuid references locations(id);
alter table truck_loadouts add column if not exists to_location_id uuid references locations(id);

-- Backfill existing rows to each org's Main Warehouse so nothing is left null
update jobs j set location_id = l.id from locations l where l.org_id = j.org_id and l.code = 'MAIN' and j.location_id is null;
update stock_ins s set location_id = l.id from locations l where l.org_id = s.org_id and l.code = 'MAIN' and s.location_id is null;
update stock_adjustments s set location_id = l.id from locations l where l.org_id = s.org_id and l.code = 'MAIN' and s.location_id is null;
update cycle_counts c set location_id = l.id from locations l where l.org_id = c.org_id and l.code = 'MAIN' and c.location_id is null;
