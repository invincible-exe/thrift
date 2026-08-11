-- 10/10 Thrifts — meetup check-in & live-location safety.
-- SAFE TO RE-RUN: every create is `if not exists`, every function is
-- create-or-replace, and every policy is drop-then-create.
--
-- WHAT THIS ADDS:
--  1. Jumia-style city → area catalog expansion: Mombasa, Kisumu, Nakuru,
--     Eldoret and Thika join Nairobi so sellers can pin meeting points (and
--     buyers can filter "Near me") across the country.
--  2. `meetup_checkins` — "I'm here" pings. Either party taps it when they
--     arrive; the other side sees it live. Idempotent per user per order.
--  3. `meetup_shares` — opt-in 30-minute live location share between the two
--     parties. Coordinates are validated server-side, updates throttled (max
--     one per ~3s), and every share auto-expires. RLS locks reads to the two
--     participants (the buyer + that listing's seller) — nobody else,
--     including other signed-in users, can ever see a share.

-- ====================================================================
-- 1. LOCATION CATALOG EXPANSION (Jumia-style: city → area → landmark)
-- ====================================================================
insert into public.locations (city, area, landmark) values
  -- Nairobi additions (Karen, Gigiri, Runda, Umoja, Donholm)
  ('Nairobi', 'Karen',        'Karen Hub'),
  ('Nairobi', 'Karen',        'The Hub Karen'),
  ('Nairobi', 'Gigiri',       'UN Complex Gate'),
  ('Nairobi', 'Runda',        'Runda Mall'),
  ('Nairobi', 'Umoja',        'Umoja One'),
  ('Nairobi', 'Donholm',      'Donholm Plaza'),

  -- Mombasa
  ('Mombasa', 'CBD',          'Moi Avenue'),
  ('Mombasa', 'CBD',          'Digo Road'),
  ('Mombasa', 'Nyali',        'City Mall Nyali'),
  ('Mombasa', 'Nyali',        'Nyali Centre'),
  ('Mombasa', 'Bamburi',      'Bamburi Beach'),
  ('Mombasa', 'Bamburi',      'Naivas Bamburi'),
  ('Mombasa', 'Changamwe',    'Airport Road'),
  ('Mombasa', 'Likoni',       'Likoni Ferry'),
  ('Mombasa', 'Tudor',        'Tudor Creek'),
  ('Mombasa', 'Kizingo',      'Kizingo Road'),

  -- Kisumu
  ('Kisumu', 'CBD',           'Oginga Odinga Street'),
  ('Kisumu', 'CBD',           'Clock Tower'),
  ('Kisumu', 'Milimani',      'Milimani Estate'),
  ('Kisumu', 'Nyalenda',      'Nyalenda Market'),
  ('Kisumu', 'Manyatta',      'Manyatta Estate'),
  ('Kisumu', 'Kondele',       'Kondele Market'),
  ('Kisumu', 'Kibos',         'Kibos Junction'),

  -- Nakuru
  ('Nakuru', 'CBD',           'Kenyatta Avenue'),
  ('Nakuru', 'CBD',           'Nakuru Clock Tower'),
  ('Nakuru', 'Milimani',      'Milimani Estate'),
  ('Nakuru', 'Lake View',     'Lake View Estate'),
  ('Nakuru', 'Section 58',    'Section 58 & 58A'),
  ('Nakuru', 'Kiamunyi',      'Kiamunyi Market'),
  ('Nakuru', 'Lanet',         'Lanet Center'),

  -- Eldoret
  ('Eldoret', 'CBD',          'Uganda Road'),
  ('Eldoret', 'CBD',          'Oloo Street'),
  ('Eldoret', 'Elgon View',   'Elgon View Estate'),
  ('Eldoret', 'Kapsoya',      'Kapsoya Market'),
  ('Eldoret', 'Langas',       'Langas Estate'),
  ('Eldoret', 'Pioneer',      'Pioneer Estate'),
  ('Eldoret', 'Kimumu',       'Kimumu Junction'),

  -- Thika
  ('Thika', 'CBD',            'Kenyatta Avenue'),
  ('Thika', 'CBD',            'Del Monte Roundabout'),
  ('Thika', 'Ngoingwa',       'Ngoingwa Estate'),
  ('Thika', 'Makongeni',      'Makongeni Market'),
  ('Thika', 'Majengo',        'Majengo Estate'),
  ('Thika', 'Blue Post',      'Blue Post Hotel'),
  ('Thika', 'Gatuanyaga',     'Gatuanyaga Center')
on conflict (city, area, landmark) do nothing;

-- ====================================================================
-- 2. MEETUP CHECK-INS ("I'm here")
-- ====================================================================
create table if not exists public.meetup_checkins (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id) on delete cascade not null,
  user_id       uuid references auth.users(id) on delete cascade not null,
  checked_in_at timestamptz not null default now(),
  unique (order_id, user_id)
);
alter table public.meetup_checkins enable row level security;

-- Both participants (and the owner) can see check-ins. Inserts happen only
-- through the SECURITY DEFINER check_in_order RPC — no direct insert policy.
drop policy if exists "meetup_checkins_participant_read" on public.meetup_checkins;
create policy "meetup_checkins_participant_read" on public.meetup_checkins
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid())
    or exists (select 1 from public.listings l where l.order_id = order_id and l.seller_id = auth.uid())
    or public.is_admin()
  );

-- ====================================================================
-- 3. LIVE LOCATION SHARES (opt-in, 30 min, participant-only)
-- ====================================================================
create table if not exists public.meetup_shares (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references public.orders(id) on delete cascade not null,
  user_id    uuid references auth.users(id) on delete cascade not null,
  lat        double precision not null,
  lng        double precision not null,
  accuracy   double precision not null default 0,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (order_id, user_id)
);
create index if not exists meetup_shares_order_idx on public.meetup_shares (order_id);
alter table public.meetup_shares enable row level security;

-- Same participant-only read rule. Writes go through the SECURITY DEFINER
-- RPCs only (coordinate validation + throttle + expiry live in SQL, so the
-- browser can't spam or poison the table).
drop policy if exists "meetup_shares_participant_read" on public.meetup_shares;
create policy "meetup_shares_participant_read" on public.meetup_shares
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid())
    or exists (select 1 from public.listings l where l.order_id = order_id and l.seller_id = auth.uid())
    or public.is_admin()
  );

-- ====================================================================
-- 4. RPCs
-- ====================================================================

-- Shared participant gate for the safety features: the order's buyer, the
-- linked listing's seller, or the owner. Internal — not granted to clients.
create or replace function public.is_meetup_participant(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    exists (select 1 from public.orders o where o.id = p_order_id and o.buyer_id = auth.uid())
    or exists (select 1 from public.listings l where l.order_id = p_order_id and l.seller_id = auth.uid())
    or public.is_admin();
$$;

-- Coordinate sanity check: non-null, in-range lat/lng and a sane accuracy.
-- NaN can't slip through (every comparison against NaN is false), and the
-- explicit `is not null` guards keep NULL from silently passing via
-- SQL's three-valued logic.
create or replace function public.valid_share_coords(
  p_lat      double precision,
  p_lng      double precision,
  p_accuracy double precision
) returns boolean
language sql immutable
as $$
  select
    p_lat is not null and p_lat between -90 and 90
    and p_lng is not null and p_lng between -180 and 180
    and coalesce(p_accuracy, 0) >= 0
    and coalesce(p_accuracy, 0) <= 10000;
$$;

-- "I'm here" — idempotent per participant per order. Only meaningful once
-- the payment completed and the order wasn't cancelled.
create or replace function public.check_in_order(p_order_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'completed' then raise exception 'ORDER_NOT_COMPLETED'; end if;
  if v_order.cancelled_at is not null then raise exception 'ORDER_CANCELLED'; end if;
  if not public.is_meetup_participant(p_order_id) then raise exception 'NOT_A_PARTICIPANT'; end if;

  insert into public.meetup_checkins (order_id, user_id)
  values (p_order_id, auth.uid())
  on conflict (order_id, user_id) do nothing;

  return 'checked_in';
end;
$$;

-- Opt in to sharing live location. Validates the coordinates, stamps a fresh
-- 30-minute window (extending an already-active share), and throttles so the
-- browser can't hammer the table. Returns the new expiry.
create or replace function public.meetup_share_start(
  p_order_id uuid,
  p_lat      double precision,
  p_lng      double precision,
  p_accuracy double precision default 0
) returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_order  public.orders%rowtype;
  v_expiry timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'completed' then raise exception 'ORDER_NOT_COMPLETED'; end if;
  if v_order.cancelled_at is not null then raise exception 'ORDER_CANCELLED'; end if;
  if not public.is_meetup_participant(p_order_id) then raise exception 'NOT_A_PARTICIPANT'; end if;
  if not public.valid_share_coords(p_lat, p_lng, p_accuracy) then
    raise exception 'INVALID_COORDS';
  end if;
  -- Same write-throttle as update: without this, `start` could be used to
  -- hammer the table AND silently re-arm the 30-minute window far more
  -- often than the privacy promise intends. A genuine re-share (after the
  -- window lapses) is unaffected — it's never within 3s of the last write.
  if exists (
    select 1 from public.meetup_shares
    where order_id = p_order_id and user_id = auth.uid()
      and updated_at > now() - interval '3 seconds'
  ) then
    raise exception 'SHARE_THROTTLED';
  end if;

  v_expiry := now() + interval '30 minutes';
  insert into public.meetup_shares (order_id, user_id, lat, lng, accuracy, expires_at, updated_at)
  values (p_order_id, auth.uid(), p_lat, p_lng, p_accuracy, v_expiry, now())
  on conflict (order_id, user_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
        expires_at = v_expiry, updated_at = now();

  return v_expiry;
end;
$$;

-- Push a fresh position while sharing. Throttled to one update per 3s so a
-- chatty GPS can't spam writes; the expiry is NOT extended (the 30-minute
-- window is set by start).
create or replace function public.meetup_share_update(
  p_order_id uuid,
  p_lat      double precision,
  p_lng      double precision,
  p_accuracy double precision default 0
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_meetup_participant(p_order_id) then raise exception 'NOT_A_PARTICIPANT'; end if;
  if not public.valid_share_coords(p_lat, p_lng, p_accuracy) then
    raise exception 'INVALID_COORDS';
  end if;
  if exists (
    select 1 from public.meetup_shares
    where order_id = p_order_id and user_id = auth.uid()
      and updated_at > now() - interval '3 seconds'
  ) then
    raise exception 'SHARE_THROTTLED';
  end if;

  update public.meetup_shares
    set lat = p_lat, lng = p_lng, accuracy = p_accuracy, updated_at = now()
    where order_id = p_order_id and user_id = auth.uid();
end;
$$;

-- Opt out: expire the share immediately.
create or replace function public.meetup_share_stop(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_meetup_participant(p_order_id) then raise exception 'NOT_A_PARTICIPANT'; end if;

  update public.meetup_shares
    set expires_at = now(), updated_at = now()
    where order_id = p_order_id and user_id = auth.uid();
end;
$$;

revoke all on function public.check_in_order from public;
grant execute on function public.check_in_order to authenticated;
revoke all on function public.meetup_share_start from public;
grant execute on function public.meetup_share_start to authenticated;
revoke all on function public.meetup_share_update from public;
grant execute on function public.meetup_share_update to authenticated;
revoke all on function public.meetup_share_stop from public;
grant execute on function public.meetup_share_stop to authenticated;
-- Internal helpers stay server-only.
revoke all on function public.is_meetup_participant from public;
revoke all on function public.is_meetup_participant from authenticated;
revoke all on function public.valid_share_coords from public;
revoke all on function public.valid_share_coords from authenticated;

-- ====================================================================
-- 5. REALTIME (check-ins + live positions update without a refresh)
-- ====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meetup_checkins'
  ) then
    alter publication supabase_realtime add table public.meetup_checkins;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meetup_shares'
  ) then
    alter publication supabase_realtime add table public.meetup_shares;
  end if;
end $$;
