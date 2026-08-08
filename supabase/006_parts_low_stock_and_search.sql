-- ============================================================
-- Fixes the Parts Catalog "truncation bug": the page was pulling
-- every row into the browser (capped at 1,000 by Supabase) and
-- filtering/low-stock-checking client-side. With 9,743 parts,
-- real rows like TYWRAP8MOUNTBLK fell outside that first 1,000-row
-- slice and looked "missing" even though they exist.
--
-- This migration adds a generated `is_low_stock` column so the
-- low-stock check (qty <= min_reorder) can run as a normal
-- PostgREST filter/count on the server — Supabase's filter builder
-- can't compare two columns directly, only a column to a fixed
-- value, so a stored generated column is the simplest fix.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run
-- ============================================================

-- gin_trgm_ops requires the pg_trgm extension (safe to run even if already enabled).
create extension if not exists pg_trgm;

alter table parts
  add column if not exists is_low_stock boolean generated always as (qty <= min_reorder) stored;

-- Speeds up the header "N LOW STOCK" count and the low-stock-only filter.
create index if not exists idx_parts_org_low_stock on parts (org_id, is_low_stock);

-- Speeds up server-side search (part_no / sku / location / description ilike).
create index if not exists idx_parts_org_part_no on parts (org_id, part_no);
create index if not exists idx_parts_search_trgm on parts using gin (
  (part_no || ' ' || sku || ' ' || coalesce(location, '') || ' ' || coalesce(description, '')) gin_trgm_ops
);
