-- 10/10 Thrifts — keep sold listings alive (fixes no-show cancel + re-list).
-- SAFE TO RE-RUN: every statement below is guarded or create-or-replace.
--
-- THE BUG it fixes: listings.product_id referenced products with
-- ON DELETE CASCADE, and both purchase functions deleted the product BEFORE
-- marking the listing sold. So on EVERY sale the cascade silently deleted
-- the listing row, and the `update ... set status = 'sold'` that followed
-- matched zero rows. Consequences:
--   * cancel_order_no_show raised NOT_COMMUNITY_ORDER (the 'sold' listing
--     it looks for never existed) — a buyer could NEVER cancel a no-show,
--     so their money was stuck in escrow until the auto-release.
--   * do_cancel_order could never find the listing to re-list the piece —
--     a cancelled 1-of-1 was gone forever instead of back on the rack.
--   * admin_resolve_order_dispute's 'cancel' path refunded but never
--     re-listed.
--
-- THE FIX:
--   1. listings.product_id → ON DELETE SET NULL (the listing survives as an
--      internal sold record; product_id just goes null once the piece is
--      deleted on sale).
--   2. purchase_product / finalize_order now mark the listing 'sold' BEFORE
--      deleting the product (with SET NULL, updating afterwards would find
--      product_id already nulled).
--   3. do_cancel_order now rewires the recycled listing's product_id to the
--      re-created product, so repeated sale → cancel → re-sale cycles keep
--      working.
--   4. admin_delete_product explicitly deletes the product's listing rows
--      (previously the cascade did it), so rejecting a pending piece still
--      removes both.

-- ====================================================================
-- 1. FK: listings survive the product delete
-- ====================================================================
do $$
declare
  v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'public.listings'::regclass
    and contype = 'f'
    and confrelid = 'public.products'::regclass
  limit 1;
  if v_con is not null then
    execute format('alter table public.listings drop constraint %I', v_con);
  end if;
end $$;

alter table public.listings
  add constraint listings_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

-- ====================================================================
-- 2a. purchase_product — mark listing sold BEFORE the product delete
-- ====================================================================
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

  if v_has_seller then
    -- Mark the listing sold BEFORE deleting the product: the delete nulls
    -- listings.product_id (FK is SET NULL), so updating afterwards would
    -- find no matching rows. The sold listing is what lets the no-show
    -- cancel / dispute machinery re-list the piece.
    update public.listings
      set status = 'sold', order_id = v_order_id, sold_at = now()
      where product_id = v_product.id;
  end if;

  -- 1-of-1: remove the piece from the public catalog.
  delete from public.products where id = v_product.id;

  if v_has_seller then
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (v_order_id, v_product.seller_id::text, 'seller', v_price - v_commission);
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (v_order_id, 'platform:admin', 'commission', v_commission);
  else
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (v_order_id, 'platform:admin', 'revenue', v_price);
  end if;

  return v_order_id;
end;
$$;

-- ====================================================================
-- 2b. finalize_order — mark listing sold BEFORE the product delete
-- ====================================================================
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

  if v_has_seller then
    -- Same ordering as purchase_product: mark the listing sold before the
    -- product delete nulls listings.product_id.
    update public.listings
      set status = 'sold', order_id = p_order_id, sold_at = now()
      where product_id = v_product.id;
  end if;

  delete from public.products where id = v_product.id;

  if v_has_seller then
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (p_order_id, v_product.seller_id::text, 'seller', v_price - v_commission);
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (p_order_id, 'platform:admin', 'commission', v_commission);
  else
    insert into public.payouts (order_id, "to", role, amount_kes)
    values (p_order_id, 'platform:admin', 'revenue', v_price);
  end if;

  return 'completed';
end;
$$;

-- ====================================================================
-- 3. do_cancel_order — rewire the recycled listing to the new product
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

  -- Recreate the piece from the listing so it can be re-sold. The listing
  -- survived the sale (FK is SET NULL), so it's found here by order id.
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
    ) returning id into v_new_product_id;

    -- Recycle the same listing row for the re-created piece, so a second
    -- sale → cancel cycle keeps working end-to-end.
    update public.listings
      set status = 'active', order_id = null, sold_at = null, product_id = v_new_product_id
      where id = v_listing.id;
  end if;

  return 'cancelled';
end;
$$;

-- ====================================================================
-- 4. admin_delete_product — remove the listing rows explicitly
-- ====================================================================
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

  -- The listing used to be removed by the FK cascade; with the FK now
  -- SET NULL, delete the listing rows explicitly (rejections remove both).
  delete from public.listings where product_id = p_product_id;
  delete from public.products where id = p_product_id;
end;
$$;
