-- ============================================================
-- part_aliases already exists (created directly via SQL editor in an
-- earlier session) with proper org-scoped RLS, but wasn't wired into any
-- actual matching or write logic. This migration just ensures the unique
-- constraint the "Resolve & Deduct" flow's upsert relies on actually
-- exists — safe to run even if it's already there.
--
-- Run this in Supabase → SQL Editor → New query → Run.
-- ============================================================

create unique index if not exists uq_part_aliases_org_alias
  on part_aliases (org_id, alias_name);
