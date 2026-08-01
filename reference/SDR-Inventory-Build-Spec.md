# SDR Electric — Inventory Ops
## Production Build Spec (Supabase + Vercel)

This spec takes the working prototype (`InventoryApp.jsx`) and lays out what's needed to turn it into a real, hosted, multi-user app. Hand this to a developer, or work through it yourself section by section.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router), deployed on Vercel | Same React component model as the prototype — most of the UI ports over directly |
| Database + Auth | Supabase (Postgres + Supabase Auth) | Real accounts, row-level security, generous free tier |
| Backend logic | Supabase Edge Functions (or Vercel serverless routes) | Needed for OAuth token exchange/refresh with QBO, ServiceM8, Housecall Pro, GoHighLevel |
| File/image storage (if needed later) | Supabase Storage | For job photos, receipts, etc. — not in the current feature set but easy to add |

---

## 2. Data Model (Postgres / Supabase)

Every table gets `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`, and `org_id uuid` (for row-level security — see §4). Trimmed below to the fields that matter.

```sql
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

-- Integrations (per-org connection state; tokens live in a separate secure table)
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
  access_token text,      -- encrypted at rest via Supabase Vault
  refresh_token text,
  expires_at timestamptz
);
```

**Quantity math stays server-side.** In the prototype, saving a job/adjustment/stock-in also mutates `parts.qty` in the same client action. In production, do this with a Postgres function + trigger (or a single transaction in your API route) so quantity changes are atomic and can't be skipped by a client bug:

```sql
create or replace function apply_qty_change(p_part_id uuid, p_delta integer)
returns void as $$
  update parts set qty = qty + p_delta, updated_at = now() where id = p_part_id;
$$ language sql;
```

Call this from the same server action that inserts the job/adjustment/stock-in row, wrapped in a transaction.

---

## 3. Auth

- Supabase Auth, email + password (add magic link later if you want passwordless).
- One `orgs` row for SDR Electric; every user's `profiles.org_id` points to it. This is what makes multi-org support possible later without a rewrite.
- Roles (`admin`, `dispatcher`, `technician`) gate what's editable — e.g. only admins can delete parts or manage integrations; technicians can log jobs and truck load-outs.

## 4. Row-Level Security

Every table gets a policy scoping reads/writes to the caller's `org_id`:

```sql
alter table parts enable row level security;

create policy "org members can read parts"
  on parts for select
  using (org_id = (select org_id from profiles where id = auth.uid()));

create policy "org members can write parts"
  on parts for insert with check (org_id = (select org_id from profiles where id = auth.uid()));
```

Repeat per table. This is what actually keeps one company's inventory private from another if you ever host more than one org on the same instance.

---

## 5. Porting the Prototype UI

Most of `InventoryApp.jsx` ports directly:

- All the presentational components (`Panel`, `Th`/`Td`, `Badge`, `Gauge`, modals) — copy as-is.
- Replace the `useState(seedX)` + `window.storage` persistence with:
  - Initial data fetch: `supabase.from('parts').select('*, ...')` in a Server Component or `useEffect`.
  - Mutations: replace `setParts(prev => ...)` with `supabase.from('parts').insert/update/delete(...)`, then update local state from the response (or use Supabase's realtime subscriptions to keep all logged-in users in sync automatically — nice for a dispatcher and a tech both watching stock levels).
- Swap the mock login screen for Supabase Auth's `signInWithPassword`.
- Line-item tables (`job_line_items`, `po_line_items`, `loadout_line_items`) mean job/PO/load-out saves become two-step: upsert the parent row, then replace its line items.

## 6. Deployment

1. Push the Next.js project to a GitHub repo.
2. Create a Supabase project → run the schema above via the SQL editor → grab the project URL and anon key.
3. Import the repo into Vercel → add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables → deploy.
4. Point your domain (or a subdomain) at the Vercel deployment.

---

## 7. Integrations

Each of these needs a registered developer app with the provider, an OAuth redirect URI pointing at your Vercel domain, and a serverless route (Vercel API route or Supabase Edge Function) to handle the token exchange and refresh. None of them can be wired up purely from the frontend — tokens must be exchanged and refreshed server-side.

| Provider | What you register | Redirect target | Notes |
|---|---|---|---|
| **QuickBooks Online** | Intuit Developer app (sandbox first) | `/api/integrations/qbo/callback` | OAuth2. Use for syncing job costs/invoices to the books. |
| **ServiceM8** | ServiceM8 developer app | `/api/integrations/servicem8/callback` | OAuth2. Pull job details, push parts usage back onto the job. |
| **Housecall Pro** | HCP API access (API key or OAuth depending on their current program) | `/api/integrations/hcp/callback` | Check current HCP developer docs — auth method has changed before. |
| **GoHighLevel** | GHL marketplace app | `/api/integrations/ghl/callback` | OAuth2. Use to trigger low-stock/reorder alerts into your automations. |

Store `access_token`/`refresh_token` in `integration_tokens`, encrypted via Supabase Vault — never in a table readable by the frontend. Sync jobs (e.g. "push today's job costs to QBO") run as scheduled Edge Functions, not on page load.

---

## 8. Suggested Build Order

1. Supabase project + schema + RLS policies
2. Auth + org/profile setup
3. Port Parts Catalog + Fleet (simplest CRUD, no line items) to prove the Supabase wiring works
4. Port Jobs, Purchase Orders, Truck Load Out (line-item tables)
5. Port the rest (Field Requests, Stock Adjustment, Cycle Counts, Stock In, Activity Log, Barcode Scanner)
6. Deploy to Vercel, use it for real for a couple weeks
7. Add integrations one at a time, starting with whichever saves the most manual work today
