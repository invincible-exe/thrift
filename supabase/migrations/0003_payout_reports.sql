-- 10/10 Thrifts — automatic payouts + payout reports.
-- SAFE TO RE-RUN: every table/column/policy/function is guarded.
--
-- 1) payout_reports — a seller can flag a payout they never received, so the
--    owner can reconcile it. Creates a support queue in the admin dashboard.
-- 2) notify_payout_paid — the moment a seller payout flips to 'paid' (auto or
--    manual), the seller gets an in-app notification with the amount.
-- 3) Realtime — add `payouts` + `payout_reports` to supabase_realtime so the
--    account page and admin queue update live without a refresh.
--
-- Run in the Supabase SQL editor, or `supabase db push`.

-- ====================================================================
-- 1. PAYOUT REPORTS
-- ====================================================================
create table if not exists public.payout_reports (
  id          uuid primary key default gen_random_uuid(),
  payout_id   uuid references public.payouts(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  reason      text not null default '',
  status      text not null default 'open',    -- 'open' | 'resolved'
  admin_note  text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.payout_reports add column if not exists id uuid;
alter table public.payout_reports add column if not exists payout_id uuid;
alter table public.payout_reports add column if not exists user_id uuid;
alter table public.payout_reports add column if not exists reason text not null default '';
alter table public.payout_reports add column if not exists status text not null default 'open';
alter table public.payout_reports add column if not exists admin_note text;
alter table public.payout_reports add column if not exists created_at timestamptz not null default now();
alter table public.payout_reports add column if not exists resolved_at timestamptz;
create index if not exists payout_reports_payout_idx on public.payout_reports (payout_id);
create index if not exists payout_reports_user_idx on public.payout_reports (user_id);
-- One open report per payout — no report spam.
create unique index if not exists payout_reports_open_once_idx
  on public.payout_reports (payout_id) where status = 'open';

alter table public.payout_reports enable row level security;

-- Sellers read their own reports; admins read + resolve all. There is NO
-- insert policy: reports are written only by the SECURITY DEFINER
-- report_payout RPC (which verifies the payout belongs to the caller), so a
-- client can never file a report against someone else's payout by crafting
-- a raw insert.
drop policy if exists "payout_reports_read_own_or_admin" on public.payout_reports;
create policy "payout_reports_read_own_or_admin" on public.payout_reports
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "payout_reports_update_admin" on public.payout_reports;
create policy "payout_reports_update_admin" on public.payout_reports
  for update using (public.is_admin()) with check (public.is_admin());

-- File a report: only the payout's own seller may report it, and only once
-- while it's still open. SECURITY DEFINER so the ownership check can't be
-- bypassed by crafting an insert.
create or replace function public.report_payout(
  p_payout_id uuid,
  p_reason    text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_report_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- The payout must belong to the reporting user.
  if not exists (
    select 1 from public.payouts
    where id = p_payout_id and "to" = auth.uid()::text
  ) then
    raise exception 'NOT_YOUR_PAYOUT';
  end if;

  -- Idempotent: reuse an existing open report instead of stacking duplicates.
  select id into v_report_id
  from public.payout_reports
  where payout_id = p_payout_id and status = 'open'
  limit 1;

  if v_report_id is not null then
    return v_report_id;
  end if;

  insert into public.payout_reports (payout_id, user_id, reason)
  values (p_payout_id, auth.uid(), coalesce(nullif(p_reason, ''), 'Did not receive this payout'))
  returning id into v_report_id;

  return v_report_id;
end;
$$;

revoke all on function public.report_payout from public;
grant execute on function public.report_payout to authenticated;

-- Owner resolution: marks a report resolved with an optional note.
create or replace function public.admin_resolve_payout_report(
  p_report_id uuid,
  p_admin_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  update public.payout_reports
    set status = 'resolved',
        admin_note = coalesce(p_admin_note, admin_note),
        resolved_at = now()
  where id = p_report_id;
end;
$$;

revoke all on function public.admin_resolve_payout_report from public;
grant execute on function public.admin_resolve_payout_report to authenticated;

-- ====================================================================
-- 2. PAYOUT-PAID NOTIFICATION
-- ====================================================================

-- When a seller payout flips to 'paid' (auto-payout or admin-triggered),
-- ping the seller in-app: "Ksh X hit your M-Pesa." Skips non-seller roles
-- (platform:admin wallets have no user to notify).
create or replace function public.notify_payout_paid()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if new.role <> 'seller' or new.status <> 'paid' then
    return new;
  end if;

  begin
    v_user_id := new."to"::uuid;
  exception when others then
    return new; -- not a user id (e.g. platform:admin) — nothing to notify
  end;

  if v_user_id is null then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body)
  values (
    v_user_id,
    'payout_paid',
    'Payout received 💸',
    'Ksh ' || new.amount_kes::text || ' has been sent to your M-Pesa.'
  );

  return new;
end;
$$;

drop trigger if exists trg_payout_paid_notify on public.payouts;
create trigger trg_payout_paid_notify
  after update on public.payouts
  for each row
  when (new.status = 'paid' and old.status is distinct from 'paid')
  execute function public.notify_payout_paid();

-- ====================================================================
-- 3. REALTIME (payouts + payout_reports)
-- ====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payouts'
  ) then
    alter publication supabase_realtime add table public.payouts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payout_reports'
  ) then
    alter publication supabase_realtime add table public.payout_reports;
  end if;
end $$;
