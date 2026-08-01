# SDR Electric — Inventory Ops

Real, database-backed starting point for the inventory app. **Parts Catalog is fully wired to Supabase** (list, add, edit, delete, auth-gated) — that's your working proof that the pipeline is correct. Everything else (Jobs, Purchase Orders, Truck Load Out, Fleet, etc.) still needs to be ported the same way, using `/app/parts/page.js` as the template.

Reference files also included:
- `reference/InventoryApp.jsx` — the full original prototype with all 16 features (mock data, in-browser only). Use this to copy the UI/logic for each remaining screen.
- `reference/SDR-Inventory-Build-Spec.md` — the full build plan, including the complete data model, RLS policies, and integration notes.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create your Supabase project** at supabase.com, then in the SQL Editor run the entire contents of `supabase/schema.sql`. This creates every table, sets up row-level security, and adds a trigger so new signups automatically join the "SDR Electric" org.

3. **Add your environment variables** — copy `.env.local.example` to `.env.local` and fill in your Supabase Project URL and anon key (Supabase → Settings → API).

4. **Run it locally**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 — it'll redirect to `/login`. Sign up with an email/password (Supabase's default email confirmation may be on — check Supabase → Authentication → Providers if you want to turn that off for faster local testing). Once logged in, you'll land on a real, empty Parts Catalog backed by your database.

5. **Deploy to Vercel** — push this folder to a GitHub repo, import it into Vercel, add the same two environment variables in Vercel's project settings, and deploy.

## Building out the rest

For each remaining screen (Jobs, Purchase Orders, Truck Load Out, Fleet, Field Requests, Stock Adjustment, Cycle Counts, Stock In, Reports, Integrations, Activity Log, Barcode Scanner, Dashboard):

1. Look at how that section works in `reference/InventoryApp.jsx`.
2. Look at the matching table(s) in `supabase/schema.sql`.
3. Create a new page under `app/<section>/page.js`, following the pattern in `app/parts/page.js`: auth guard → fetch from Supabase → render with the shared components in `components/ui.js` → wire the modal's Save/Delete to `supabase.from(...).insert/update/delete`.

Jobs, Purchase Orders, and Truck Load Out are the trickiest since they each have a parent table plus a line-items table — see Section 5 of the build spec for how to handle that (upsert the parent, then replace its line items).

Once all screens are ported, the last step is a shared sidebar/nav layout (the prototype's `Sidebar` component is a good starting point) so you're not jumping between raw URLs.
