-- 10/10 Thrifts — meetups, locations, disputes & no-show cancellation.
-- SAFE TO RE-RUN: every create is `if not exists`, every column is guarded
-- with `add column if not exists`, every function is create-or-replace, and
-- every policy is drop-then-create.
--
-- WHAT THIS ADDS:
--  1. `locations` — city → area → landmark picker data (seller meeting
--     points and buyer "near me" areas). Seeded with Nairobi areas.
--  2. Sellers pin each listing to a location (products + listings get
--     location_id + a denormalized location_label for snapshots/filters).
--  3. Buyers set their own area on their profile.
--  4. Per-order meetup coordination: `messages` (private buyer↔seller chat,
--     RLS-locked to the two parties) + the selling landmark shown on the
--     order.
--  5. Buyer "I didn't receive it" disputes: `order_disputes` + orders
--     .disputed_at, which PAUSE the escrow auto-release (see 0005).
--  6. No-show cancellation (buyer, after the seller's 24h window, or the
--     owner from a dispute): the seller's escrow payout is failed, a
--     `refund` payout row is created for the buyer (paid out via the same
--     B2C queue), and the piece is put back on the rack.

-- ====================================================================
-- 1. LOCATIONS (city → area → landmark)
-- ====================================================================
create table if not exists public.locations (
  id       uuid primary key default gen_random_uuid(),
  city     text not null,
  area     text not null,
  landmark text not null default '',
  unique (city, area, landmark)
);
create index if not exists locations_area_idx on public.locations (city, area);

-- The catalog must be readable by everyone (it's public meetup data — city /
-- area / landmark only, no user rows), while writes stay locked. RLS is
-- enabled with a plain public-read policy so the anon key (the browser's
-- location pickers + feed filters) can always fetch it.
alter table public.locations enable row level security;
drop policy if exists "locations_public_read" on public.locations;
create policy "locations_public_read" on public.locations
  for select to anon, authenticated using (true);

-- Seed Nairobi meeting points (the owner can add more cities/areas by
-- inserting rows — the picker reads this table).
insert into public.locations (city, area, landmark) values
  ('Nairobi', 'Westlands',  'Westlands Mall'),
  ('Nairobi', 'Westlands',  'Sarit Centre'),
  ('Nairobi', 'Westlands',  'Delta Towers'),
  ('Nairobi', 'Kilimani',   'Yaya Centre'),
  ('Nairobi', 'Kilimani',   'Adams Arcade'),
  ('Nairobi', 'Kilimani',   'Valley Arcade'),
  ('Nairobi', 'CBD',        'Kenyatta Avenue'),
  ('Nairobi', 'CBD',        'Moi Avenue'),
  ('Nairobi', 'CBD',        'Nairobi Archives'),
  ('Nairobi', 'Lavington',  'Lavington Mall'),
  ('Nairobi', 'Kileleshwa', 'Kileleshwa Posta'),
  ('Nairobi', 'Kasarani',   'TRM (Thika Road Mall)'),
  ('Nairobi', 'Eastleigh',  'Eastleigh Mall'),
  ('Nairobi', 'South B',    'South B Shops'),
  ('Nairobi', 'Ngong Road', 'The Junction'),
  ('Nairobi', 'Langata',    'Galleria Mall')
on conflict (city, area, landmark) do nothing;

-- ====================================================================
-- 2. COLUMNS
-- ====================================================================
-- Buyer's home area (for the "Near me" filter).
alter table public.profiles add column if not exists location_id uuid
  references public.locations(id) on delete set null;

-- Seller's meeting point for a piece. location_label is the denormalized
-- "Area · Landmark" string, stored so purchase snapshots and client filters
-- never need a join.
alter table public.products add column if not exists location_id uuid
  references public.locations(id) on delete set null;
alter table public.products add column if not exists location_label text not null default '';
alter table public.listings add column if not exists location_id uuid
  references public.locations(id) on delete set null;
alter table public.listings add column if not exists location_label text not null default '';
-- Listings historically only snapshot title/brand/category/size/price/photos;
-- the no-show re-list recreates the product from the listing, so it also
-- needs condition/era/description to restore the piece faithfully.
alter table public.listings add column if not exists condition text not null default 'Very good';
alter table public.listings add column if not exists era text;
alter table public.listings add column if not exists description text;

-- Order lifecycle flags for the meetup flow.
alter table public.orders add column if not exists disputed_at timestamptz;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancelled_by text;  -- 'buyer' | 'admin'

-- Target M-Pesa number for a `refund` payout (the buyer's payment phone,
-- captured on the order — not the profile phone, which may be unset).
alter table public.payouts add column if not exists refund_phone text;

-- ====================================================================
-- 3. ORDER DISPUTES ("I didn't receive it")
-- ====================================================================
-- One open dispute per order at a time; buyer-only creation via the RPC.
create table if not exists public.order_disputes (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references public.orders(id) on delete cascade not null,
  user_id    uuid references auth.users(id) on delete cascade not null,
  reason     text not null default '',
  status     text not null default 'open',  -- 'open' | 'resolved'
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists order_disputes_order_idx on public.order_disputes (order_id, status);
alter table public.order_disputes enable row level security;
drop policy if exists "order_disputes_read_owner_or_admin" on public.order_disputes;
create policy "order_disputes_read_owner_or_admin" on public.order_disputes
  for select using (user_id = auth.uid() or public.is_admin());

-- ====================================================================
-- 4. MEETUP CHAT (private buyer↔seller thread per order)
-- ====================================================================
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references public.orders(id) on delete cascade not null,
  sender_id  uuid references auth.users(id) on delete cascade not null,
  body       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists messages_order_idx on public.messages (order_id, created_at);
alter table public.messages enable row level security;

-- Only the buyer, the linked listing's seller, or an admin can read a
-- thread. The seller is resolved via the listing that carries order_id.
drop policy if exists "messages_participant_read" on public.messages;
create policy "messages_participant_read" on public.messages
  for select using (
    auth.uid() = sender_id
    or exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid())
    or exists (select 1 from public.listings l where l.order_id = order_id and l.seller_id = auth.uid())
    or public.is_admin()
  );
drop policy if exists "messages_participant_insert" on public.messages;
create policy "messages_participant_insert" on public.messages
  for insert to authenticated with check (
    auth.uid() = sender_id
    and (
      exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid())
      or exists (select 1 from public.listings l where l.order_id = order_id and l.seller_id = auth.uid())
      or public.is_admin()
    )
  );

-- ====================================================================
-- 5. RPCs
-- ====================================================================

-- Buyer flags an order as "I didn't receive it". Pauses the escrow
-- auto-release (release_expired_escrow skips disputed orders). Idempotent:
-- an already-open dispute returns the same id instead of duplicating.
create or replace function public.dispute_order(
  p_order_id uuid,
  p_reason   text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_order      public.orders%rowtype;
  v_dispute_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'NOT_YOUR_ORDER'; end if;
  if v_order.status <> 'completed' then raise exception 'ORDER_NOT_COMPLETED'; end if;
  if v_order.receipt_confirmed_at is not null then raise exception 'ALREADY_CONFIRMED'; end if;
  if v_order.cancelled_at is not null then raise exception 'ORDER_CANCELLED'; end if;
  -- Only while the seller payout is still held. A dispute filed after the
  -- 48h auto-release would let the admin 'cancel' path refund a buyer whose
  -- money already went to the seller — the platform would pay twice.
  if not exists (
    select 1 from public.payouts
    where order_id = p_order_id and role = 'seller' and status = 'escrow'
  ) then
    raise exception 'ESCROW_RELEASED';
  end if;

  if v_order.disputed_at is not null then
    select id into v_dispute_id
    from public.order_disputes
    where order_id = p_order_id and status = 'open'
    limit 1;
    if v_dispute_id is not null then return v_dispute_id; end if;
    raise exception 'DISPUTE_RESOLVED';
  end if;

  update public.orders set disputed_at = coalesce(disputed_at, now()) where id = p_order_id;
  insert into public.order_disputes (order_id, user_id, reason)
  values (p_order_id, auth.uid(), coalesce(p_reason, ''))
  returning id into v_dispute_id;
  return v_dispute_id;
end;
$$;

-- Shared cancellation engine used by BOTH the buyer's no-show cancel and the
-- owner's dispute resolution: fail the held seller payout, create a refund
-- payout to the buyer (paid via the B2C queue), and put the piece back on
-- the rack. Internal only — never granted to clients; callers enforce their
-- own guards and deadlines.
create or replace function public.do_cancel_order(
  p_order_id     uuid,
  p_cancelled_by text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order   public.orders%rowtype;
  v_listing public.listings%rowtype;
  v_found   boolean;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return 'noop'; end if;
  -- Idempotency guard: never refund twice / re-list twice. Callers (buyer
  -- cancel, admin resolution) also guard, but this is the single choke
  -- point for every cancellation path.
  if v_order.cancelled_at is not null then return 'noop'; end if;

  update public.orders
    set cancelled_at = coalesce(cancelled_at, now()), cancelled_by = p_cancelled_by
    where id = p_order_id;

  update public.payouts
    set status = 'failed',
        failure_reason = 'Cancelled — seller did not deliver',
        escrow_release_at = null
    where order_id = p_order_id and role = 'seller' and status = 'escrow';

  -- Refund the buyer's full payment (role 'refund', to their wallet row,
  -- paid to the phone they paid with). The escrow trigger only holds
  -- 'seller' rows, so this stays 'pending' and lands in the refunds queue.
  insert into public.payouts (order_id, "to", role, amount_kes, refund_phone)
  values (p_order_id, v_order.buyer_id::text, 'refund', v_order.amount_kes, v_order.mpesa_phone);

  -- Recreate the piece from the listing so it can be re-sold.
  select * into v_listing from public.listings
  where order_id = p_order_id and status = 'sold' limit 1;
  v_found := found;
  if v_found then
    insert into public.products (
      title, brand, category, size, condition, era, price_kes, image_url, image_urls,
      description, source, seller_id, seller_name, status, location_id, location_label
    ) values (
      v_listing.title, v_listing.brand, v_listing.category, v_listing.size, v_listing.condition,
      v_listing.era, v_listing.price_kes, v_listing.image_url, v_listing.image_urls,
      v_listing.description, 'community', v_listing.seller_id,
      (select name from public.profiles where id = v_listing.seller_id),
      'active', v_listing.location_id, v_listing.location_label
    );
    update public.listings
      set status = 'active', order_id = null, sold_at = null
      where id = v_listing.id;
  end if;

  return 'cancelled';
end;
$$;

-- Buyer cancels after the seller's 24h no-show window. The escrow
-- auto-release sits at 48h, so the seller payout is still held here.
create or replace function public.cancel_order_no_show(p_order_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'NOT_YOUR_ORDER'; end if;
  if v_order.status <> 'completed' then raise exception 'ORDER_NOT_COMPLETED'; end if;
  if v_order.receipt_confirmed_at is not null then raise exception 'ALREADY_CONFIRMED'; end if;
  if v_order.cancelled_at is not null then raise exception 'ORDER_CANCELLED'; end if;
  if v_order.disputed_at is not null then raise exception 'ORDER_DISPUTED'; end if;
  -- The seller gets 24 hours from payment to show up; only then can the
  -- buyer cancel.
  if v_order.completed_at is null or v_order.completed_at + interval '24 hours' > now() then
    raise exception 'TOO_EARLY';
  end if;
  if not exists (
    select 1 from public.payouts
    where order_id = p_order_id and role = 'seller' and status = 'escrow'
  ) then
    raise exception 'ESCROW_RELEASED';
  end if;
  -- Community orders only — a platform piece has no seller to no-show.
  if not exists (
    select 1 from public.listings where order_id = p_order_id and status = 'sold'
  ) then
    raise exception 'NOT_COMMUNITY_ORDER';
  end if;

  return public.do_cancel_order(p_order_id, 'buyer');
end;
$$;

-- Owner resolves a dispute: release the held seller payout (the piece was
-- actually delivered), fail it (buyer never got it, no refund — e.g. fraud),
-- or cancel the order outright (fail seller + refund buyer + re-list).
-- Clears the order's disputed flag so the escrow sweep can resume if it was
-- released.
create or replace function public.admin_resolve_order_dispute(
  p_dispute_id uuid,
  p_admin_note text default null,
  p_outcome    text default 'release'   -- 'release' | 'fail' | 'cancel'
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_dispute public.order_disputes%rowtype;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;

  select * into v_dispute from public.order_disputes where id = p_dispute_id and status = 'open';
  if not found then raise exception 'DISPUTE_NOT_FOUND'; end if;

  if p_outcome = 'cancel' then
    perform public.do_cancel_order(v_dispute.order_id, 'admin');
  elsif p_outcome = 'fail' then
    update public.payouts
      set status = 'failed',
          failure_reason = 'Dispute resolved — seller not paid',
          escrow_release_at = null
      where order_id = v_dispute.order_id and role = 'seller' and status = 'escrow';
  else
    update public.payouts
      set status = 'pending', escrow_release_at = null
      where order_id = v_dispute.order_id and role = 'seller' and status = 'escrow';
  end if;

  update public.order_disputes
    set status = 'resolved', admin_note = coalesce(p_admin_note, admin_note), resolved_at = now()
    where id = p_dispute_id;
  update public.orders set disputed_at = null where id = v_dispute.order_id;
  return 'resolved';
end;
$$;

revoke all on function public.dispute_order from public;
grant execute on function public.dispute_order to authenticated;
revoke all on function public.do_cancel_order from public;
revoke all on function public.do_cancel_order from authenticated;
revoke all on function public.cancel_order_no_show from public;
grant execute on function public.cancel_order_no_show to authenticated;
revoke all on function public.admin_resolve_order_dispute from public;
revoke all on function public.admin_resolve_order_dispute from authenticated;
grant execute on function public.admin_resolve_order_dispute to authenticated;

-- ====================================================================
-- 6. REALTIME (chat + disputes update without a refresh)
-- ====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_disputes'
  ) then
    alter publication supabase_realtime add table public.order_disputes;
  end if;
end $$;
