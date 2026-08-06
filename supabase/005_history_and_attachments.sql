-- ============================================================
-- SDR Electric — Sync History + File Attachments
--
-- Part 1: timestamps needed to show a history of what synced
-- and when (jobs/job_line_items didn't track this before).
--
-- Part 2: Supabase Storage buckets + columns so stock-in
-- receipts can link to a PO and attach a supplier invoice,
-- and parts can have a photo.
-- ============================================================

alter table jobs add column if not exists created_at timestamptz default now();
alter table job_line_items add column if not exists created_at timestamptz default now();

-- Stock In: link to a purchase order, and store the path to an
-- uploaded supplier invoice (private bucket — see below).
alter table stock_ins add column if not exists po_id uuid references purchase_orders(id);
alter table stock_ins add column if not exists invoice_path text;

-- Parts: store the path to an uploaded photo (public bucket —
-- part photos aren't sensitive, so no signed URL needed to view).
alter table parts add column if not exists photo_path text;

-- ============================================================
-- Storage buckets
-- ============================================================

insert into storage.buckets (id, name, public)
values ('receiving-invoices', 'receiving-invoices', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('part-photos', 'part-photos', true)
on conflict (id) do nothing;

-- Every object is stored as `${org_id}/${filename}` — policies check that
-- the first path segment matches the caller's own org_id, same pattern
-- used everywhere else in this schema.

drop policy if exists "org read receiving-invoices" on storage.objects;
drop policy if exists "org write receiving-invoices" on storage.objects;
drop policy if exists "org update receiving-invoices" on storage.objects;
drop policy if exists "org delete receiving-invoices" on storage.objects;

create policy "org read receiving-invoices" on storage.objects for select
  using (bucket_id = 'receiving-invoices' and (storage.foldername(name))[1] = (select org_id::text from profiles where id = auth.uid()));
create policy "org write receiving-invoices" on storage.objects for insert
  with check (bucket_id = 'receiving-invoices' and (storage.foldername(name))[1] = (select org_id::text from profiles where id = auth.uid()));
create policy "org update receiving-invoices" on storage.objects for update
  using (bucket_id = 'receiving-invoices' and (storage.foldername(name))[1] = (select org_id::text from profiles where id = auth.uid()));
create policy "org delete receiving-invoices" on storage.objects for delete
  using (bucket_id = 'receiving-invoices' and (storage.foldername(name))[1] = (select org_id::text from profiles where id = auth.uid()));

-- part-photos is a public bucket (anyone with the URL can view — fine for
-- product photos), but writes are still restricted to the owning org.
drop policy if exists "org write part-photos" on storage.objects;
drop policy if exists "org update part-photos" on storage.objects;
drop policy if exists "org delete part-photos" on storage.objects;

create policy "org write part-photos" on storage.objects for insert
  with check (bucket_id = 'part-photos' and (storage.foldername(name))[1] = (select org_id::text from profiles where id = auth.uid()));
create policy "org update part-photos" on storage.objects for update
  using (bucket_id = 'part-photos' and (storage.foldername(name))[1] = (select org_id::text from profiles where id = auth.uid()));
create policy "org delete part-photos" on storage.objects for delete
  using (bucket_id = 'part-photos' and (storage.foldername(name))[1] = (select org_id::text from profiles where id = auth.uid()));
