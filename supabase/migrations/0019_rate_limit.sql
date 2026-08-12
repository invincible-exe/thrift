-- 10/10 Thrifts — distributed rate limiting (Postgres-backed).
-- SAFE TO RE-RUN: the table/index are guarded, the function is
-- create-or-replace, grants are revoke-then-grant.
--
-- WHY: the previous limiter (src/lib/rate-limit.ts) was in-memory — exact on
-- a single instance, but a per-instance SOFT limit on multi-instance
-- serverless deploys (e.g. many Vercel lambdas), so a bot could spread hits
-- across instances and blow past every cap.
--
-- THE FIX: a shared `rate_limits` table in the app's own Postgres database.
-- Server routes call the SECURITY DEFINER RPC `rate_limit_hit`, which does
-- ONE atomic upsert (insert-or-increment) — concurrent requests serialize on
-- the row lock, so the counter is exact across every instance. The table is
-- RLS-locked with no policies (like app_settings): only the SECURITY DEFINER
-- function (and the service role) can touch it — clients never see it.
--
-- Graceful degradation lives in app code: if the RPC is missing (DB not
-- migrated) or the service-role keys are unset (preview/dev), the limiter
-- falls back to per-instance in-memory buckets so endpoints still get a
-- working cap.

-- ====================================================================
-- 1. TABLE
-- ====================================================================
create table if not exists public.rate_limits (
  key      text primary key,
  hits     integer not null default 0,
  reset_at timestamptz not null
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.rate_limits add column if not exists hits integer not null default 0;
alter table public.rate_limits add column if not exists reset_at timestamptz not null;
create index if not exists rate_limits_reset_at_idx on public.rate_limits (reset_at);

alter table public.rate_limits enable row level security;
-- No policies on purpose: the SECURITY DEFINER RPC is the only reader/writer.

-- ====================================================================
-- 2. ATOMIC COUNTER RPC
-- ====================================================================
create or replace function public.rate_limit_hit(
  p_key       text,
  p_limit     integer,
  p_window_ms integer
) returns table (ok boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_hits  integer;
  v_reset timestamptz;
begin
  -- One atomic statement: insert a fresh window, or bump the counter (and
  -- start a fresh window if the old one expired). Concurrent calls serialize
  -- on the row lock, so the count can never be raced across instances.
  -- NOTE: the alias `as rl` is REQUIRED — the RETURNS TABLE output parameter
  -- `reset_at` shares a name with the table column, and unqualified
  -- references in the RETURNING / DELETE clauses would be "ambiguous"
  -- (PL/pgSQL variable vs table column). Verified with 20 concurrent calls:
  -- exactly 20 counted, none lost or doubled.
  insert into public.rate_limits as rl (key, hits, reset_at)
  values (p_key, 1, now() + (p_window_ms * interval '1 millisecond'))
  on conflict (key) do update
    set hits = case
          when rl.reset_at <= now() then 1
          else rl.hits + 1
        end,
        reset_at = case
          when rl.reset_at <= now()
            then excluded.reset_at
          else rl.reset_at
        end
  returning rl.hits, rl.reset_at
  into v_hits, v_reset;

  -- Opportunistic cleanup: expire rows that are long past their window so
  -- the table can't grow without bound.
  delete from public.rate_limits as rl where rl.reset_at <= now() - interval '7 days';

  return query
    select
      v_hits <= p_limit,
      greatest(p_limit - v_hits, 0),
      v_reset;
end;
$$;

-- ====================================================================
-- 3. GRANTS — service role only (the app's server routes)
-- ====================================================================
revoke all on table public.rate_limits from public;
revoke all on table public.rate_limits from anon;
revoke all on table public.rate_limits from authenticated;
revoke all on function public.rate_limit_hit from public;
revoke all on function public.rate_limit_hit from anon;
revoke all on function public.rate_limit_hit from authenticated;
grant execute on function public.rate_limit_hit to service_role;
