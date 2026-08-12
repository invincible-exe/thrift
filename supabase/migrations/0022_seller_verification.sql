-- 10/10 Thrifts — seller verification, verified badge, dispute delivery proof.
-- SAFE TO RE-RUN: columns are add-if-not-exists, policies drop-then-create,
-- triggers drop-then-create, functions create-or-replace (get_seller_profile
-- is drop-then-create because its return type changes).
--
-- WHY:
--   1. Anyone can list a piece, so before a seller's FIRST payout goes out
--      the owner wants to eyeball who they're paying. profiles gains
--      seller_verified (owner decision) + verification_requested_at (the
--      seller's request). The automatic payout dispatch skips unverified
--      sellers; the owner approves them in the admin dashboard.
--   2. The "✓ verified seller" badge on product cards / the seller page
--      needs the flag on products (denormalized, kept in sync by trigger).
--   3. Dispute resolution is evidence-based: buyer or seller can attach a
--      delivery-proof photo to an open dispute for the owner to review.

-- ====================================================================
-- 1. PROFILES — verification state
-- ====================================================================
alter table public.profiles add column if not exists seller_verified boolean not null default false;
alter table public.profiles add column if not exists verification_requested_at timestamptz;

-- ====================================================================
-- 2. PRODUCTS — denormalized badge flag (kept in sync by trigger below)
-- ====================================================================
alter table public.products add column if not exists seller_verified boolean not null default false;

-- Backfill existing rows from their seller's profile.
update public.products p
  set seller_verified = coalesce(
    (select pr.seller_verified from public.profiles pr where pr.id = p.seller_id),
    false
  )
  where p.seller_id is not null;

-- Keep the badge honest: when the owner verifies (or un-verifies) a seller,
-- every one of their live pieces reflects it immediately.
create or replace function public.sync_seller_verified()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.products
    set seller_verified = new.seller_verified
    where seller_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_profiles_sync_seller_verified on public.profiles;
create trigger trg_profiles_sync_seller_verified
  after update of seller_verified on public.profiles
  for each row execute function public.sync_seller_verified();

-- ====================================================================
-- 3. create_listing — stamp the badge at listing time
-- ====================================================================
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
  v_verified     boolean;
  v_location     public.locations%rowtype;
  v_label        text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_location_id is null then
    raise exception 'LOCATION_REQUIRED';
  end if;
  select * into v_location from public.locations where id = p_location_id;
  if not found then
    raise exception 'LOCATION_NOT_FOUND';
  end if;
  v_label := v_location.city || ' · ' || v_location.area;

  select name, seller_verified into v_seller_name, v_verified
  from public.profiles where id = auth.uid();

  insert into public.products (
    title, brand, category, size, condition, era, price_kes,
    image_url, image_urls, description, source, seller_id, seller_name, status,
    seller_verified, location_id, location_label
  ) values (
    p_title, p_brand, p_category, p_size, p_condition, p_era, p_price_kes,
    p_image_url, coalesce(p_image_urls, array[p_image_url]), p_description,
    'community', auth.uid(), coalesce(v_seller_name, ''), 'pending',
    coalesce(v_verified, false), p_location_id, v_label
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

-- ====================================================================
-- 4. do_cancel_order — re-created pieces carry the badge too
-- ====================================================================
create or replace function public.do_cancel_order(
  p_order_id     uuid,
  p_cancelled_by text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order          public.orders%rowtype;
  v_listing        public.listings%rowtype;
  v_found          boolean;
  v_new_product_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return 'noop'; end if;
  if v_order.cancelled_at is not null then return 'noop'; end if;

  update public.orders
    set cancelled_at = coalesce(cancelled_at, now()), cancelled_by = p_cancelled_by
    where id = p_order_id;

  update public.payouts
    set status = 'failed',
        failure_reason = 'Cancelled — seller did not deliver',
        escrow_release_at = null
    where order_id = p_order_id and role = 'seller' and status = 'escrow';

  insert into public.payouts (order_id, "to", role, amount_kes, refund_phone)
  values (p_order_id, v_order.buyer_id::text, 'refund', v_order.amount_kes, v_order.mpesa_phone);

  select * into v_listing from public.listings
  where order_id = p_order_id and status = 'sold' limit 1;
  v_found := found;
  if v_found then
    insert into public.products (
      title, brand, category, size, condition, era, price_kes, image_url, image_urls,
      description, source, seller_id, seller_name, status, seller_verified,
      location_id, location_label
    ) values (
      v_listing.title, v_listing.brand, v_listing.category, v_listing.size, v_listing.condition,
      v_listing.era, v_listing.price_kes, v_listing.image_url, v_listing.image_urls,
      v_listing.description, 'community', v_listing.seller_id,
      (select name from public.profiles where id = v_listing.seller_id),
      'active',
      coalesce((select seller_verified from public.profiles where id = v_listing.seller_id), false),
      v_listing.location_id, v_listing.location_label
    ) returning id into v_new_product_id;

    update public.listings
      set status = 'active', order_id = null, sold_at = null, product_id = v_new_product_id
      where id = v_listing.id;
  end if;

  return 'cancelled';
end;
$$;

-- ====================================================================
-- 5. ORDER DISPUTES — delivery proof
-- ====================================================================
alter table public.order_disputes add column if not exists proof_url text;
alter table public.order_disputes add column if not exists proof_uploaded_by text;

-- The seller needs to SEE an open dispute on their sold listing (to answer
-- it with proof) — previously only the filer (buyer) and admins could read.
drop policy if exists "order_disputes_read_owner_or_admin" on public.order_disputes;
create policy "order_disputes_read_owner_or_admin" on public.order_disputes
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.orders o
      join public.listings l on l.order_id = o.id
      where o.id = order_disputes.order_id
        and l.seller_id = auth.uid()
    )
  );

-- ====================================================================
-- 6. RPCs
-- ====================================================================

-- Seller asks the owner to verify them. Requires a payout destination on
-- file (phone or bank), because verification is about who gets paid.
create or replace function public.request_seller_verification()
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text;
  v_bank  text;
  v_at    timestamptz;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select phone, bank_account_number into v_phone, v_bank
  from public.profiles where id = auth.uid();

  if coalesce(v_phone, '') = '' and coalesce(v_bank, '') = '' then
    raise exception 'PAYOUT_DETAILS_REQUIRED';
  end if;

  update public.profiles
    set verification_requested_at = now()
    where id = auth.uid()
    returning verification_requested_at into v_at;

  return v_at;
end;
$$;

-- Owner approves (or revokes) a seller's verification. Clearing the request
-- flag removes them from the review queue; the trigger syncs the badge.
create or replace function public.admin_set_seller_verified(
  p_user_id  uuid,
  p_verified boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  update public.profiles
    set seller_verified = p_verified,
        verification_requested_at = null
    where id = p_user_id;
end;
$$;

-- Buyer or seller attaches a delivery-proof photo to an open dispute.
-- Upload happens via the normal /api/storage/upload route (product-images
-- bucket, unguessable path); this RPC just validates participation + state
-- and records the URL.
create or replace function public.add_dispute_proof(
  p_dispute_id uuid,
  p_url        text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_dispute public.order_disputes%rowtype;
  v_order   public.orders%rowtype;
  v_seller  uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_url is null or p_url = '' then
    raise exception 'URL_REQUIRED';
  end if;

  select * into v_dispute from public.order_disputes where id = p_dispute_id and status = 'open';
  if not found then raise exception 'DISPUTE_NOT_FOUND'; end if;

  select * into v_order from public.orders where id = v_dispute.order_id;
  select seller_id into v_seller from public.listings where order_id = v_order.id limit 1;

  -- Only the order's buyer or seller can attach evidence.
  if auth.uid() <> v_order.buyer_id and (v_seller is null or auth.uid() <> v_seller) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  update public.order_disputes
    set proof_url = p_url, proof_uploaded_by = auth.uid()
    where id = p_dispute_id;
end;
$$;

revoke all on function public.request_seller_verification() from public;
grant execute on function public.request_seller_verification() to authenticated;
revoke all on function public.admin_set_seller_verified(uuid, boolean) from public;
grant execute on function public.admin_set_seller_verified(uuid, boolean) to authenticated;
revoke all on function public.add_dispute_proof(uuid, text) from public;
grant execute on function public.add_dispute_proof(uuid, text) to authenticated;

-- ====================================================================
-- 7. get_seller_profile — expose the badge publicly (return type changes,
--    so drop-then-create; grants restored below).
-- ====================================================================
drop function if exists public.get_seller_profile(uuid);
create or replace function public.get_seller_profile(p_seller_id uuid)
returns table (
  name           text,
  member_since   timestamptz,
  location_label text,
  avg_score      numeric,
  rating_count   bigint,
  sales          bigint,
  seller_verified boolean
)
language sql stable security definer set search_path = public
as $$
  select
    coalesce(pr.name, ''),
    pr.created_at,
    case when pr.location_id is not null then l.city || ' · ' || l.area end,
    round(avg(r.score), 1)::numeric,
    count(r.id)::bigint,
    (select count(*) from public.payouts py
      where py."to" = p_seller_id::text and py.role = 'seller')::bigint,
    pr.seller_verified
  from public.profiles pr
  left join public.locations l on l.id = pr.location_id
  left join public.ratings r on r.order_id in (
    select o.id from public.orders o
    join public.products p on p.id = o.product_id
    where p.seller_id = p_seller_id
  )
  where pr.id = p_seller_id
  group by pr.id, pr.name, pr.created_at, l.city, l.area, pr.seller_verified
$$;

revoke all on function public.get_seller_profile(uuid) from public;
grant execute on function public.get_seller_profile(uuid) to anon, authenticated;
