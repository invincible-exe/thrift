-- 10/10 Thrifts — area drop alerts.
-- SAFE TO RE-RUN: table is `create if not exists`, policies are
-- drop-then-create, the realtime add is guarded, and notify_new_drop is
-- create-or-replace with the same signature.
--
-- WHAT THIS ADDS:
--  1. `location_alerts` — a user's opted-in county watch list (the bell in
--     the feed: "Notify me when drops land in {county}"). One row per
--     user · location, self-managed via RLS, realtime so the bell state
--     stays in sync.
--  2. `notify_new_drop` now targets the COUNTY instead of broadcasting to
--     every user: it pings users who subscribed to that county with the
--     bell, plus users whose profile area is in that county (they answered
--     the sign-in location prompt, so their county is implicitly
--     interesting). Users who set neither get no new-drop spam — the old
--     notify-everyone behavior is gone.

-- ====================================================================
-- 1. LOCATION ALERTS
-- ====================================================================
create table if not exists public.location_alerts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  location_id uuid references public.locations(id) on delete cascade not null,
  created_at  timestamptz not null default now(),
  unique (user_id, location_id)
);
create index if not exists location_alerts_user_idx on public.location_alerts (user_id);

alter table public.location_alerts enable row level security;
-- Fully private to each user (like wishlists): they manage their own rows.
drop policy if exists "location_alerts_own" on public.location_alerts;
create policy "location_alerts_own" on public.location_alerts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'location_alerts'
  ) then
    alter publication supabase_realtime add table public.location_alerts;
  end if;
end $$;

-- ====================================================================
-- 2. TARGETED NEW-DROP NOTIFICATIONS
-- ====================================================================
-- County-targeted: bell subscribers of the piece's county + users whose
-- profile area is in that county. The seller and the acting admin are
-- excluded (they already know). A piece with no location notifies nobody —
-- every listing requires one, so this is just a safety net.
create or replace function public.notify_new_drop(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_title     text;
  v_seller_id uuid;
  v_county    text;
begin
  -- Only called from the admin functions; guard anyway so a signed-in user
  -- can't spam inboxes with "new drop" rows.
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select p.title, p.seller_id, l.city into v_title, v_seller_id, v_county
  from public.products p
  left join public.locations l on l.id = p.location_id
  where p.id = p_product_id and p.status = 'active';

  if v_title is null or v_title = '' then
    return; -- not live (or gone) — nothing to announce
  end if;
  if coalesce(v_county, '') = '' then
    return; -- no county to target — safety net (listings always have one)
  end if;

  insert into public.notifications (user_id, type, title, body)
  select u.id, 'new_drop', 'New drop near you',
         '"' || v_title || '" just hit the rack in ' || v_county ||
         ' — 1-of-1, gone once sold.'
  from (
    -- Bell subscribers of this county…
    select la.user_id as id
    from public.location_alerts la
    join public.locations l on l.id = la.location_id
    where l.city = v_county
    union
    -- …and users whose profile area is in this county.
    select p.id
    from public.profiles p
    join public.locations l on l.id = p.location_id
    where l.city = v_county
  ) u
  where u.id is distinct from v_seller_id
    and (auth.uid() is null or u.id <> auth.uid());
end;
$$;

revoke all on function public.notify_new_drop from public;
grant execute on function public.notify_new_drop to authenticated;
