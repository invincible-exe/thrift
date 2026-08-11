-- 10/10 Thrifts — hourly payout auto-sweep (cron).
-- SAFE TO RE-RUN: grants are revoke-then-grant, the cron job is guarded.
--
-- WHAT THIS ADDS:
--  1. `release_expired_escrow` execute for service_role. The page-load sweep
--     still runs as `authenticated` (account/admin pages), but the cron runs
--     with NO user session — it calls the sweep as service role, so the RPC
--     must be executable by service_role too.
--  2. A pg_cron job (hourly, on the hour) that POSTs to the app's
--     /api/cron/payout-sweep route via pg_net with x-cron-secret =
--     payout_sweep_secret. The route releases expired escrows and dispatches
--     pending payouts, so money never waits for a page load.
--
-- ⚠️  Placeholders to replace BEFORE running in the SQL editor (mirrors the
--     email webhook registration in 0004_email_webhook.sql):
--       • payout_sweep_url    → your live public URL (e.g. the current ngrok
--         URL) + /api/cron/payout-sweep. If the tunnel restarts and the URL
--         changes, re-run with the new URL (or update the app_settings row).
--       • payout_sweep_secret → the exact value of CRON_SECRET in .env.local
--         (must match byte-for-byte; never commit the real secret).
--     Both are read from app_settings at every run, so updating the row is
--     enough — no need to touch the job itself.
-- ====================================================================

-- 1. GRANTS — service role can run the escrow sweep (cron has no session).
revoke all on function public.release_expired_escrow from public;
grant execute on function public.release_expired_escrow to authenticated;
grant execute on function public.release_expired_escrow to service_role;

-- 2. pg_cron + pg_net (best-effort: some platforms may not ship them, in
--    which case the page-load sweep is still there).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension pg_cron;
    exception when others then
      raise notice 'pg_cron not available — hourly sweep skipped: %', sqlerrm;
    end;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension pg_net;
    exception when others then
      raise notice 'pg_net not available — hourly sweep skipped: %', sqlerrm;
    end;
  end if;
end $$;

-- 3. SETTINGS — the sweep endpoint + shared secret (app_settings is RLS
--    locked to SECURITY DEFINER functions, so clients never see the secret).
insert into public.app_settings (key, value) values
  ('payout_sweep_url',    'https://YOUR-PUBLIC-URL/api/cron/payout-sweep'),
  ('payout_sweep_secret', 'REPLACE-WITH-CRON_SECRET')
on conflict (key) do update set value = excluded.value;

-- 4. HOURLY JOB — POST to the sweep route on the hour. Guarded so re-running
--    this file doesn't stack duplicate jobs.
-- NOTE: the schedule body uses $cron$ … $cron$ (a distinct tag) because a
-- nested $$ … $$ inside this outer do $$ … $$ block would close it early.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'payout-sweep';
  if v_job_id is null then
    perform cron.schedule(
      'payout-sweep',
      '0 * * * *',
      $cron$
      select net.http_post(
        url     := (select value from public.app_settings where key = 'payout_sweep_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select value from public.app_settings where key = 'payout_sweep_secret')
        ),
        body    := '{}'
      ) as req_id;
      $cron$
    );
  end if;
end $$;
