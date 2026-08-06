-- integration_tokens holds OAuth access/refresh tokens for connected services
-- (ServiceM8, QuickBooks, etc). These must never be readable by the browser's
-- public anon key. Enabling RLS with zero policies denies all access to the
-- anon/authenticated roles; only the service_role key (used exclusively in
-- server-side API routes, never shipped to the browser) bypasses RLS.
alter table integration_tokens enable row level security;
