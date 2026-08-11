-- 10/10 Thrifts — initial schema, RLS, RPCs, realtime.
-- Run in the Supabase SQL editor, or `supabase db push`.
-- SAFE TO RE-RUN: every create is `if not exists`, every column is guarded
-- with `add column if not exists`, and every function/policy/trigger is
-- create-or-replace. Re-pasting this file on an older database upgrades it
-- in place (adds image_urls, pending status, B2C payout fields, phone, etc.)
-- without touching existing data.
-- Covers: public catalog (1-of-1), orders, payouts ledger, seller listings,
-- wishlists, profiles. Purchase finalization lives in SECURITY
-- DEFINER functions so the 1-of-1 delete + payout routing stay atomic.

-- ====================================================================
-- OVERLOAD CLEANUP (re-run safety)
-- ====================================================================
-- An older paste may have left an overloaded copy of an RPC (same name,
-- different signature — e.g. `finalize_by_checkout_request` before the
-- amount/phone verification params were added). CREATE OR REPLACE only
-- replaces the exact signature you name, so the stale copy survives and the
-- bare-name REVOKE/GRANT statements below then throw 42725 "function name is
-- not unique". This block drops EVERY overload of each function the app
-- defines before they are re-created, so re-pasting this file (or the full
-- APPLY file) is exact on any database state.
--
-- Excluded on purpose: is_admin (RLS policies reference it) and the
-- trigger-callback functions (prevent_role_self_change, hold_seller_payout_escrow,
-- notify_payout_paid) — DROP ... CASCADE would silently remove the policies / triggers that
-- reference them. Those functions have stable signatures, so create-or-replace is enough.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'finalize_order', 'finalize_by_checkout_request', 'mark_order_failed',
        'purchase_product', 'finalize_boost', 'mark_boost_failed',
        'confirm_receipt', 'release_expired_escrow',
        'dispute_order', 'do_cancel_order', 'cancel_order_no_show',
        'admin_resolve_order_dispute',
        'report_payout', 'admin_resolve_payout_report',
        'create_listing', 'admin_delete_product', 'admin_set_product_status',
        'admin_create_product', 'admin_reset_payout',
        'check_in_order', 'meetup_share_start', 'meetup_share_update',
        'meetup_share_stop', 'is_meetup_participant', 'valid_share_coords',
        'notify_new_drop', 'notify_listing_decision_email'
      )
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

-- ====================================================================
-- TABLES
-- ====================================================================

-- User profiles (mirrors auth.users).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  email      text,
  photo_url  text,
  phone      text,                                -- M-Pesa number for B2C payouts
  role       text not null default 'user',        -- 'user' | 'admin'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.profiles add column if not exists id uuid;
alter table public.profiles add column if not exists name text not null default '';
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists photo_url text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Public catalog. Sold pieces are DELETED on purchase (1-of-1 rule).
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  brand       text not null default '',
  category    text not null default 'Tops',
  size        text not null default 'M',
  condition   text not null default 'Very good',
  era         text,
  price_kes   integer not null default 0 check (price_kes >= 0),
  image_url   text not null default '',     -- cover photo
  image_urls  text[] not null default '{}', -- full photo gallery
  description text,
  source      text not null default 'platform',   -- 'platform' | 'community'
  seller_id   uuid references auth.users(id) on delete set null,
  seller_name text,
  status      text not null default 'active',     -- 'active' | 'sold'
  created_at  timestamptz not null default now()
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.products add column if not exists id uuid;
alter table public.products add column if not exists title text not null;
alter table public.products add column if not exists brand text not null default '';
alter table public.products add column if not exists category text not null default 'Tops';
alter table public.products add column if not exists size text not null default 'M';
alter table public.products add column if not exists condition text not null default 'Very good';
alter table public.products add column if not exists era text;
alter table public.products add column if not exists price_kes integer not null default 0 check (price_kes >= 0);
alter table public.products add column if not exists image_url text not null default '';
alter table public.products add column if not exists image_urls text[] not null default '{}';
alter table public.products add column if not exists description text;
alter table public.products add column if not exists source text not null default 'platform';
alter table public.products add column if not exists seller_id uuid;
alter table public.products add column if not exists seller_name text;
alter table public.products add column if not exists status text not null default 'active';
alter table public.products add column if not exists created_at timestamptz not null default now();
create index if not exists products_created_at_idx on public.products (created_at desc);

-- Orders (buyers see their own; the checkout modal tracks live M-Pesa orders).
create table if not exists public.orders (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid references public.products(id) on delete set null,
  product_snapshot     jsonb not null default '{}'::jsonb,
  buyer_id             uuid references auth.users(id) on delete set null,
  buyer_name           text not null default '',
  buyer_email          text not null default '',
  method               text not null default 'mpesa',  -- 'mpesa' | 'bank'
  amount_kes           integer not null default 0,
  status               text not null default 'pending', -- 'pending' | 'completed' | 'failed'
  provider_ref         text,
  mpesa_receipt        text,
  checkout_request_id  text,
  mpesa_phone          text,                -- phone the STK push was sent to (webhook verification)
  failure_reason       text,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.orders add column if not exists id uuid;
alter table public.orders add column if not exists product_id uuid;
alter table public.orders add column if not exists product_snapshot jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists buyer_id uuid;
alter table public.orders add column if not exists buyer_name text not null default '';
alter table public.orders add column if not exists buyer_email text not null default '';
alter table public.orders add column if not exists method text not null default 'mpesa';
alter table public.orders add column if not exists amount_kes integer not null default 0;
alter table public.orders add column if not exists status text not null default 'pending';
alter table public.orders add column if not exists provider_ref text;
alter table public.orders add column if not exists mpesa_receipt text;
alter table public.orders add column if not exists checkout_request_id text;
alter table public.orders add column if not exists mpesa_phone text;
alter table public.orders add column if not exists failure_reason text;
alter table public.orders add column if not exists created_at timestamptz not null default now();
alter table public.orders add column if not exists completed_at timestamptz;
create index if not exists orders_buyer_id_idx on public.orders (buyer_id);
create index if not exists orders_checkout_request_id_idx on public.orders (checkout_request_id);

-- Payout ledger: platform pieces → platform:admin (revenue); community
-- pieces → seller 90% + platform:admin 10% (commission).
create table if not exists public.payouts (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references public.orders(id) on delete cascade,
  "to"       text not null,                          -- user id or 'platform:admin'
  role       text not null default 'seller',         -- 'revenue' | 'commission' | 'seller'
  amount_kes integer not null default 0,
  status       text not null default 'pending',      -- 'pending' | 'processing' | 'paid' | 'failed'
  provider_ref text,                                 -- B2C OriginatorConversationID / receipt
  failure_reason text,
  paid_at      timestamptz,
  created_at timestamptz not null default now()
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.payouts add column if not exists id uuid;
alter table public.payouts add column if not exists order_id uuid;
alter table public.payouts add column if not exists "to" text not null;
alter table public.payouts add column if not exists role text not null default 'seller';
alter table public.payouts add column if not exists amount_kes integer not null default 0;
alter table public.payouts add column if not exists status text not null default 'pending';
alter table public.payouts add column if not exists provider_ref text;
alter table public.payouts add column if not exists failure_reason text;
alter table public.payouts add column if not exists paid_at timestamptz;
alter table public.payouts add column if not exists created_at timestamptz not null default now();
create index if not exists payouts_to_idx on public.payouts ("to");
create unique index if not exists payouts_provider_ref_idx
  on public.payouts (provider_ref) where provider_ref is not null;

-- Seller listing history records (kept after a sale flips them to 'sold').
create table if not exists public.listings (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  seller_id  uuid references auth.users(id) on delete cascade,
  title      text not null default '',
  brand      text not null default '',
  category   text not null default 'Tops',
  size       text not null default '',
  price_kes  integer not null default 0,
  image_url  text not null default '',     -- cover photo
  image_urls text[] not null default '{}', -- full photo gallery
  status     text not null default 'active',         -- 'active' | 'sold'
  order_id   uuid,
  sold_at    timestamptz,
  created_at timestamptz not null default now()
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.listings add column if not exists id uuid;
alter table public.listings add column if not exists product_id uuid;
alter table public.listings add column if not exists seller_id uuid;
alter table public.listings add column if not exists title text not null default '';
alter table public.listings add column if not exists brand text not null default '';
alter table public.listings add column if not exists category text not null default 'Tops';
alter table public.listings add column if not exists size text not null default '';
alter table public.listings add column if not exists price_kes integer not null default 0;
alter table public.listings add column if not exists image_url text not null default '';
alter table public.listings add column if not exists image_urls text[] not null default '{}';
alter table public.listings add column if not exists status text not null default 'active';
alter table public.listings add column if not exists order_id uuid;
alter table public.listings add column if not exists sold_at timestamptz;
alter table public.listings add column if not exists created_at timestamptz not null default now();
create index if not exists listings_seller_id_idx on public.listings (seller_id);

-- Wishlists: one row per saved piece.
create table if not exists public.wishlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  product_id uuid references public.products(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.wishlists add column if not exists id uuid;
alter table public.wishlists add column if not exists user_id uuid;
alter table public.wishlists add column if not exists product_id uuid;
alter table public.wishlists add column if not exists created_at timestamptz not null default now();

-- In-app notifications: sellers are pinged when their piece is approved
-- for the feed or rejected by the owner, and every user is pinged when a
-- new piece drops on the feed.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  type       text not null default 'listing',   -- 'listing_approved' | 'listing_rejected' | 'new_drop'
  title      text not null default '',
  body       text not null default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.notifications add column if not exists id uuid;
alter table public.notifications add column if not exists user_id uuid;
alter table public.notifications add column if not exists type text not null default 'listing';
alter table public.notifications add column if not exists title text not null default '';
alter table public.notifications add column if not exists body text not null default '';
alter table public.notifications add column if not exists read boolean not null default false;
alter table public.notifications add column if not exists created_at timestamptz not null default now();
create index if not exists notifications_user_id_idx
  on public.notifications (user_id, created_at desc);

-- Owner-only app settings (webhook URL + secret for listing emails).
-- Locked down: RLS enabled with no policies, so only SECURITY DEFINER
-- functions (which run as the owner) can read these — clients never see
-- the secret. Configure with:
--   insert into public.app_settings (key, value) values
--     ('email_webhook_url',   'https://your-domain.com/api/notifications/email'),
--     ('email_webhook_secret', 'matching-EMAIL_WEBHOOK_SECRET')
--   on conflict (key) do update set value = excluded.value;
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.app_settings add column if not exists key text;
alter table public.app_settings add column if not exists value text not null default '';
alter table public.app_settings add column if not exists updated_at timestamptz not null default now();
alter table public.app_settings enable row level security;
-- Placeholder rows so the keys exist; the owner overwrites them with the
-- real values (see the comment above and README).
insert into public.app_settings (key, value) values
  ('email_webhook_url', ''),
  ('email_webhook_secret', '')
on conflict (key) do nothing;

-- ====================================================================
-- HELPERS
-- ====================================================================

-- Admin check used by RLS policies and admin RPCs. SECURITY DEFINER so
-- policies can call it without recursion.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Enable pg_net (async HTTP from Postgres) for the listing-decision email
-- webhook. If the platform doesn't ship it, emails are silently skipped —
-- the in-app bell still notifies the seller.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension pg_net;
    exception when others then
      raise notice 'pg_net not available — listing emails disabled: %', sqlerrm;
    end;
  end if;
end $$;

-- Fire the seller-notification email webhook (pg_net → the app's
-- /api/notifications/email route). No-op when pg_net or the webhook
-- settings are missing, so moderation never breaks because of email. The
-- webhook URL + secret live in app_settings and must match
-- EMAIL_WEBHOOK_SECRET in the app's .env.local.
create or replace function public.notify_listing_decision_email(
  p_seller_id  uuid,
  p_item_title text,
  p_status     text,
  p_note       text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_url     text;
  v_secret  text;
  v_headers jsonb;
begin
  if p_seller_id is null or p_item_title is null or p_item_title = '' then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  select value into v_url    from public.app_settings where key = 'email_webhook_url';
  select value into v_secret from public.app_settings where key = 'email_webhook_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return; -- webhook not configured yet
  end if;

  v_headers := jsonb_build_object(
    'Content-Type',     'application/json',
    'x-webhook-secret', v_secret
  );

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
      'sellerId',  p_seller_id::text,
      'itemTitle', p_item_title,
      'status',    p_status,
      'note',      coalesce(p_note, '')
    ),
    headers := v_headers
  );
end;
$$;

-- Users can never change their own role through the API (console/SQL can).
create or replace function public.prevent_role_self_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'You cannot change your own role';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_role_change on public.profiles;
create trigger trg_profiles_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_self_change();

-- ====================================================================
-- ATOMIC PURCHASE (the 1-of-1 inventory rule lives here)
-- ====================================================================

-- Client purchase (simulated M-Pesa/bank, or any completed client flow).
-- Validates the caller, locks the product row, writes the completed order,
-- DELETES the piece from the public catalog, routes payouts, flips the
-- seller's listing. Throws 'PIECE_SOLD' if the piece is already gone.
create or replace function public.purchase_product(
  p_product_id   uuid,
  p_buyer_name   text,
  p_buyer_email  text,
  p_method       text,
  p_provider_ref text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_product      public.products%rowtype;
  v_order_id     uuid;
  v_price        integer;
  v_has_seller   boolean;
  v_commission   integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and status = 'active'                   -- only approved live pieces can be bought
  for update;                               -- lock: no double-selling

  if not found then
    raise exception 'PIECE_SOLD';
  end if;

  v_price      := v_product.price_kes;
  v_has_seller := v_product.seller_id is not null;
  -- 10% commission, but never less than KES 50 (and never more than the
  -- price itself, so a sub-50 KES piece can't produce a negative payout).
  v_commission := case
    when v_has_seller then least(v_price, greatest(50, round(v_price * 0.1)))
    else 0
  end;

  insert into public.orders (
    product_id, product_snapshot, buyer_id, buyer_name, buyer_email,
    method, amount_kes, status, provider_ref, completed_at
  ) values (
    v_product.id,
    jsonb_build_object(
      'title',       v_product.title,
      'imageUrl',    v_product.image_url,
      'brand',       v_product.brand,
      'priceKes',    v_price,
      'meetupPoint', coalesce(v_product.location_label, ''),
      'sellerName',  coalesce(v_product.seller_name, '')
    ),
    auth.uid(), p_buyer_name, p_buyer_email,
    p_method, v_price, 'completed', p_provider_ref, now()
  ) returning id into v_order_id;

  -- 1-of-1: remove the piece from the public catalog.
  delete from public.products where id = v_product.id;

  if v_has_seller then
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (v_order_id, v_product.seller_id::text, 'seller', v_price - v_commission);
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (v_order_id, 'platform:admin', 'commission', v_commission);
    update public.listings
      set status = 'sold', order_id = v_order_id, sold_at = now()
      where product_id = v_product.id;
  else
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (v_order_id, 'platform:admin', 'revenue', v_price);
  end if;

  return v_order_id;
end;
$$;

-- ====================================================================
-- SERVER-SIDE FINALIZATION (M-Pesa callback webhook)
-- ====================================================================

-- Idempotent: completes a pending order, deletes the product, routes
-- payouts, flips the listing. Returns 'completed' | 'noop' | 'missing-product'.
create or replace function public.finalize_order(
  p_order_id      uuid,
  p_mpesa_receipt text default null,
  p_provider_ref  text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order       public.orders%rowtype;
  v_product     public.products%rowtype;
  v_price       integer;
  v_has_seller  boolean;
  v_commission  integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return 'noop'; end if;
  if v_order.status = 'completed' then return 'completed'; end if;
  if v_order.product_id is null then return 'noop'; end if;

  select * into v_product from public.products where id = v_order.product_id;
  if not found then return 'missing-product'; end if;

  v_price      := v_product.price_kes;
  v_has_seller := v_product.seller_id is not null;
  -- 10% commission, but never less than KES 50 (and never more than the
  -- price itself, so a sub-50 KES piece can't produce a negative payout).
  v_commission := case
    when v_has_seller then least(v_price, greatest(50, round(v_price * 0.1)))
    else 0
  end;

  update public.orders set
    status           = 'completed',
    mpesa_receipt    = coalesce(p_mpesa_receipt, mpesa_receipt),
    provider_ref     = coalesce(p_provider_ref, provider_ref),
    completed_at     = now(),
    product_snapshot = jsonb_build_object(
      'title',   v_product.title,
      'imageUrl', v_product.image_url,
      'brand',   v_product.brand,
      'priceKes', v_price,
      'meetupPoint', coalesce(v_product.location_label, ''),
      'sellerName',  coalesce(v_product.seller_name, '')
    )
  where id = p_order_id;

  delete from public.products where id = v_product.id;

  if v_has_seller then
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (p_order_id, v_product.seller_id::text, 'seller', v_price - v_commission);
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (p_order_id, 'platform:admin', 'commission', v_commission);
    update public.listings
      set status = 'sold', order_id = p_order_id, sold_at = now()
      where product_id = v_product.id;
  else
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (p_order_id, 'platform:admin', 'revenue', v_price);
  end if;

  return 'completed';
end;
$$;

-- Locate a pending order by Daraja CheckoutRequestID and finalize it.
-- Hardened: the webhook is publicly reachable, so finalization only happens
-- when the callback's Amount + PhoneNumber match the pending order exactly
-- (p_expected_* params, taken from the Safaricom callback metadata).
-- FAILS CLOSED: a null/missing expected value is treated as a mismatch, so a
-- callback that omits the amount or phone can never finalize an order.
create or replace function public.finalize_by_checkout_request(
  p_checkout_request_id text,
  p_mpesa_receipt       text default null,
  p_expected_amount     integer default null,
  p_expected_phone      text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where checkout_request_id = p_checkout_request_id and status = 'pending'
  limit 1;
  if not found then return null; end if;

  if v_order.amount_kes is distinct from p_expected_amount then
    return 'mismatch';
  end if;
  if v_order.mpesa_phone is distinct from p_expected_phone then
    return 'mismatch';
  end if;

  return public.finalize_order(v_order.id, p_mpesa_receipt);
end;
$$;

-- Mark a pending order failed (user declined / STK timeout).
create or replace function public.mark_order_failed(
  p_checkout_request_id text,
  p_reason              text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id uuid;
begin
  update public.orders set
    status         = 'failed',
    failure_reason = coalesce(p_reason, 'M-Pesa transaction declined'),
    completed_at   = now()
  where checkout_request_id = p_checkout_request_id and status = 'pending'
  returning id into v_order_id;
  return v_order_id;
end;
$$;

-- Client-triggered finalization is dangerous (a buyer could skip paying) —
-- only the service role may call these.
revoke all on function public.finalize_order from public;
revoke all on function public.finalize_by_checkout_request from public;
revoke all on function public.mark_order_failed from public;
grant execute on function public.finalize_order to service_role;
grant execute on function public.finalize_by_checkout_request to service_role;
grant execute on function public.mark_order_failed to service_role;

-- ====================================================================
-- P2P LISTING + ADMIN
-- ====================================================================

-- List a piece for sale: creates the public product + seller listing atomically.
create or replace function public.create_listing(
  p_title          text,
  p_brand          text,
  p_category       text,
  p_size           text,
  p_condition      text,
  p_price_kes      integer,
  p_image_url      text,
  p_image_urls     text[] default null,
  p_description    text default null,
  p_era            text default null,
  p_location_id    uuid default null,
  p_location_label text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_product_id   uuid;
  v_seller_name  text;
  v_location     public.locations%rowtype;
  v_label        text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Sellers MUST pin a meetup location: the whole marketplace runs on
  -- location-based meetups, so a piece with no location can't be listed.
  -- Enforced here in SQL (not just the form) so no client can bypass it.
  if p_location_id is null then
    raise exception 'LOCATION_REQUIRED';
  end if;
  select * into v_location from public.locations where id = p_location_id;
  if not found then
    raise exception 'LOCATION_NOT_FOUND';
  end if;
  -- The label is derived from the catalog so a listing always carries a
  -- meaningful "City · Area" string (Jumia-style, deliberately ambiguous —
  -- buyer + seller agree on the exact spot in the order chat). p_location_label
  -- is accepted for backward compat but deliberately ignored — the label is
  -- always derived here, never trusted from the client.
  v_label := v_location.city || ' · ' || v_location.area;

  select name into v_seller_name from public.profiles where id = auth.uid();

  insert into public.products (
    title, brand, category, size, condition, era, price_kes,
    image_url, image_urls, description, source, seller_id, seller_name, status,
    location_id, location_label
  ) values (
    p_title, p_brand, p_category, p_size, p_condition, p_era, p_price_kes,
    p_image_url, coalesce(p_image_urls, array[p_image_url]), p_description,
    'community', auth.uid(), coalesce(v_seller_name, ''), 'pending',
    p_location_id, v_label -- await owner approval
  ) returning id into v_product_id;

  insert into public.listings (
    product_id, seller_id, title, brand, category, size, price_kes,
    image_url, image_urls, status, condition, era, description, location_id, location_label
  ) values (
    v_product_id, auth.uid(), p_title, p_brand, p_category, p_size,
    p_price_kes, p_image_url, coalesce(p_image_urls, array[p_image_url]), 'pending',
    p_condition, p_era, p_description, p_location_id, v_label
  );

  return v_product_id;
end;
$$;

-- Broadcast a "new drop" notification to every user when a piece goes live
-- on the feed (platform piece created, or community piece approved).
-- SECURITY DEFINER so it can write notifications for all users; skips the
-- acting admin and the piece's own seller (they already know).
create or replace function public.notify_new_drop(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_title     text;
  v_seller_id uuid;
begin
  -- Only called from the admin functions; guard anyway so a signed-in user
  -- can't spam every inbox with "new drop" rows.
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select title, seller_id into v_title, v_seller_id
  from public.products
  where id = p_product_id and status = 'active';

  if v_title is null or v_title = '' then
    return; -- not live (or gone) — nothing to announce
  end if;

  insert into public.notifications (user_id, type, title, body)
  select
    p.id,
    'new_drop',
    'New drop',
    '"' || v_title || '" just hit the rack — 1-of-1, gone once sold.'
  from public.profiles p
  where (auth.uid() is null or p.id <> auth.uid())
    and p.id is distinct from v_seller_id;
end;
$$;

revoke all on function public.notify_new_drop from public;
grant execute on function public.notify_new_drop to authenticated;

-- Admin-only product removal (dashboard). Blocks non-admins. When the piece
-- is a pending community listing, the seller gets a rejection notification
-- (in-app bell + email webhook) BEFORE the row is deleted — with the admin's
-- optional `p_note` as the reason.
create or replace function public.admin_delete_product(
  p_product_id uuid,
  p_note       text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_seller_id uuid;
  v_title     text;
  v_note      text; -- capped copy of p_note used for the insert + email
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  -- The UI caps the note at 300 chars; this belt-and-braces cap protects the
  -- notification body + webhook payload from an oversized direct RPC call.
  v_note := left(coalesce(p_note, ''), 500);

  -- Notify the seller when their pending community piece is rejected
  -- (before the row is deleted): in-app bell + email webhook.
  select seller_id, title into v_seller_id, v_title
  from public.products
  where id = p_product_id
    and source = 'community'
    and status = 'pending'
    and seller_id is not null;

  if v_seller_id is not null then
    insert into public.notifications (user_id, type, title, body)
    values (
      v_seller_id,
      'listing_rejected',
      'Piece not approved',
      'Your "' || v_title || '" was not approved.'
        || case
             when v_note = '' then ' You can re-list it with better photos.'
             else ' Reason: ' || v_note
           end
    );
    perform public.notify_listing_decision_email(v_seller_id, v_title, 'rejected', v_note);
  end if;

  delete from public.products where id = p_product_id;
end;
$$;

revoke all on function public.create_listing from public;
grant execute on function public.create_listing to authenticated;
revoke all on function public.admin_delete_product from public;
grant execute on function public.admin_delete_product to authenticated;

-- Owner moderation: promote a pending community piece to the live feed
-- (also flips the seller's listing row so it reads "Live" for them).
create or replace function public.admin_set_product_status(
  p_product_id uuid,
  p_status     text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_status not in ('active', 'sold') then
    raise exception 'INVALID_STATUS';
  end if;

  update public.products set status = p_status where id = p_product_id;
  update public.listings set status = p_status
    where product_id = p_product_id and status = 'pending';

  -- Notify the seller when their community piece is approved for the feed
  -- (in-app bell + email webhook).
  if p_status = 'active' then
    declare
      v_seller_id uuid;
      v_title     text;
    begin
      select seller_id, title into v_seller_id, v_title
      from public.products
      where id = p_product_id
        and source = 'community'
        and seller_id is not null;

      if v_seller_id is not null then
        insert into public.notifications (user_id, type, title, body)
        values (
          v_seller_id,
          'listing_approved',
          'Piece approved',
          'Your "' || v_title || '" is live on the feed.'
        );
        perform public.notify_listing_decision_email(v_seller_id, v_title, 'approved');
      end if;
    end;

    -- Tell every user a fresh drop is live.
    perform public.notify_new_drop(p_product_id);
  end if;
end;
$$;

-- Owner adds a platform piece straight to the live feed (no seller, 100%
-- of the sale goes to the platform wallet). Admin-only.
create or replace function public.admin_create_product(
  p_title          text,
  p_brand          text,
  p_category       text,
  p_size           text,
  p_condition      text,
  p_price_kes      integer,
  p_image_url      text,
  p_image_urls     text[] default null,
  p_description    text default null,
  p_era            text default null,
  p_location_id    uuid default null,
  p_location_label text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_product_id  uuid;
  v_location    public.locations%rowtype;
  v_label       text;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  -- Platform pieces carry a meetup location too, so they surface in the
  -- Near-me / location filters like community pieces. Same rule as
  -- create_listing: location is required and verified against the catalog.
  if p_location_id is null then
    raise exception 'LOCATION_REQUIRED';
  end if;
  select * into v_location from public.locations where id = p_location_id;
  if not found then
    raise exception 'LOCATION_NOT_FOUND';
  end if;
  -- p_location_label is accepted for backward compat but deliberately
  -- ignored — the label is always derived from the catalog here.
  v_label := v_location.city || ' · ' || v_location.area;
  insert into public.products (
    title, brand, category, size, condition, era, price_kes,
    image_url, image_urls, description, source, status, location_id, location_label
  ) values (
    p_title, p_brand, p_category, p_size, p_condition, p_era, p_price_kes,
    p_image_url, coalesce(p_image_urls, array[p_image_url]), p_description,
    'platform', 'active', p_location_id, v_label
  ) returning id into v_product_id;

  -- Tell every user a fresh drop is live.
  perform public.notify_new_drop(v_product_id);

  return v_product_id;
end;
$$;

revoke all on function public.admin_set_product_status from public;
grant execute on function public.admin_set_product_status to authenticated;
revoke all on function public.admin_create_product from public;
grant execute on function public.admin_create_product to authenticated;

-- Admin recovery: a payout stuck in 'processing' (Daraja accepted but the
-- ResultURL callback never arrived) can be manually marked failed so it stops
-- blocking the settlements queue. Admin-only, and guarded by status =
-- 'processing' so it can never flip a paid or pending payout.
create or replace function public.admin_reset_payout(p_payout_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  update public.payouts
    set status = 'failed',
        failure_reason = 'Reset by admin. Verify with Safaricom before re-sending'
  where id = p_payout_id and status = 'processing';
end;
$$;

revoke all on function public.admin_reset_payout from public;
grant execute on function public.admin_reset_payout to authenticated;

-- purchase_product: SERVER-ONLY. Checkouts are initiated by the server route
-- (POST /api/payments/mpesa) and finalized by the callback webhook — the
-- browser can never mark a purchase as complete by calling this directly.
revoke all on function public.purchase_product from public;
revoke all on function public.purchase_product from authenticated;
grant execute on function public.purchase_product to service_role;

-- ====================================================================
-- ROW LEVEL SECURITY
-- ====================================================================

alter table public.profiles  enable row level security;
alter table public.products  enable row level security;
alter table public.orders    enable row level security;
alter table public.payouts   enable row level security;
alter table public.listings  enable row level security;
alter table public.wishlists enable row level security;

-- Profiles: self-managed, admins can read all.
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Products: fully public read (homepage is open). Writes happen only via
-- SECURITY DEFINER RPCs (purchase / listing / admin) — no direct client
-- insert/update/delete, so a user can never tamper with the catalog.
-- Public feed shows only approved pieces; admins can read everything.
drop policy if exists "products_public_read" on public.products;
create policy "products_public_read" on public.products
  for select using (status = 'active' or public.is_admin());

-- Orders: buyer reads own, admins read all.
drop policy if exists "orders_read_owner_or_admin" on public.orders;
create policy "orders_read_owner_or_admin" on public.orders
  for select using (buyer_id = auth.uid() or public.is_admin());

-- Payouts: wallet owner reads own, admins read all.
drop policy if exists "payouts_read_owner_or_admin" on public.payouts;
create policy "payouts_read_owner_or_admin" on public.payouts
  for select using ("to" = auth.uid()::text or public.is_admin());

-- Listings: seller reads own, admins read all.
drop policy if exists "listings_read_owner_or_admin" on public.listings;
create policy "listings_read_owner_or_admin" on public.listings
  for select using (seller_id = auth.uid() or public.is_admin());

-- Wishlists: fully private to each user.
drop policy if exists "wishlists_own" on public.wishlists;
create policy "wishlists_own" on public.wishlists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Notifications: fully private to each user. Reads + mark-as-read only —
-- real notifications are written by the SECURITY DEFINER admin functions
-- (which bypass RLS), so authenticated users get no insert/delete on the
-- table and can't spam their own notification feed.
alter table public.notifications enable row level security;
drop policy if exists "notifications_read_own" on public.notifications;
create policy "notifications_read_own" on public.notifications
  for select using (user_id = auth.uid());
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ====================================================================
-- REALTIME
-- ====================================================================

-- The feed, live order tracking, and wishlists update without a refresh.
-- Guarded with pg_publication so re-running the file on a database where
-- the tables are already members (or the publication is missing entirely,
-- e.g. a restored DB) doesn't error out.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'wishlists'
  ) then
    alter publication supabase_realtime add table public.wishlists;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ====================================================================
-- PRODUCT IMAGE STORAGE (device uploads)
-- ====================================================================

-- Public bucket for listing photos — sellers upload from their device and
-- the public feed renders the resulting URL (no signed links needed).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Anyone can view product photos (they appear on the public feed).
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read" on storage.objects
  for select using (bucket_id = 'product-images');

-- Signed-in users can upload photos for their own listings.
drop policy if exists "product_images_authenticated_upload" on storage.objects;
create policy "product_images_authenticated_upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images');
