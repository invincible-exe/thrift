-- 10/10 Thrifts — seller email notification webhook wiring.
-- SAFE TO RE-RUN: every statement is guarded (create if not exists / add
-- column if not exists / on conflict do update).
--
-- 1) Ensures the app_settings table exists (it lives in 0001_init.sql but
--    older databases may predate it — this makes the email wiring
--    self-contained).
-- 2) Registers the DB→app webhook: the admin SQL functions
--    (admin_set_product_status / admin_delete_product) fire a pg_net POST
--    to email_webhook_url with x-webhook-secret = email_webhook_secret.
--    The app's /api/notifications/email route verifies that header against
--    EMAIL_WEBHOOK_SECRET in .env.local — they MUST match.
--
-- Run in the Supabase SQL editor (after 0001_init.sql / 0002 / 0003 if your
-- project doesn't have them yet).

-- ====================================================================
-- 1. APP SETTINGS (idempotent — matches the definition in 0001_init.sql)
-- ====================================================================
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_settings add column if not exists key text;
alter table public.app_settings add column if not exists value text not null default '';
alter table public.app_settings add column if not exists updated_at timestamptz not null default now();
alter table public.app_settings enable row level security;

-- ====================================================================
-- 2. WEBHOOK REGISTRATION
--    ⚠️  The two placeholder values below MUST be replaced with the real
--        ones BEFORE running this in the SQL editor:
--        • email_webhook_url   → your live public URL (e.g. the current
--          ngrok URL) + /api/notifications/email. If your tunnel restarts
--          its URL changes — re-run with the new URL.
--        • email_webhook_secret → the exact value of EMAIL_WEBHOOK_SECRET
--          in .env.local (they must match byte-for-byte).
--        Never commit the real secret to a tracked migration file.
-- ====================================================================
insert into public.app_settings (key, value) values
  ('email_webhook_url',   'https://YOUR-PUBLIC-URL/api/notifications/email'),
  ('email_webhook_secret', 'REPLACE-WITH-EMAIL_WEBHOOK_SECRET')
on conflict (key) do update set value = excluded.value;
