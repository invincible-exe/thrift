-- 10/10 Thrifts — sellers can't buy their own pieces + admin-delete cleanup.
-- SAFE TO RE-RUN: functions are create-or-replace; the backfill only touches
-- rows that are provably orphaned (never-paid orders whose product is gone).

-- ====================================================================
-- 1. No self-purchase (defense in depth)
--
--    The checkout route (POST /api/payments/initiate) already rejects a
--    seller buying their own piece, but the purchase SQL is the last line
--    of defense and must enforce it too:
--
--    a. purchase_product — compares auth.uid() (the buyer) to the product's
--       seller_id. Only meaningful when called with a user JWT; under the
--       service role auth.uid() is null so this is inert, but it protects
--       the RPC path if it is ever granted to authenticated again.
--
--    b. finalize_order — the webhook path runs under the service role where
--       auth.uid() is ALWAYS null, so it compares the ORDER's buyer_id to
--       the product's seller_id instead. A self-purchase order can never be
--       finalized (no product deleted, no payout routed) even if one was
--       somehow created.
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

  -- A seller can't buy their own piece.
  if v_product.seller_id is not null and v_product.seller_id = auth.uid() then
    raise exception 'CANNOT_BUY_OWN';
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
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return 'noop'; end if;
  if v_order.status = 'completed' then return 'completed'; end if;
  if v_order.product_id is null then return 'noop'; end if;

  select * into v_product from public.products where id = v_order.product_id;
  if not found then return 'missing-product'; end if;

  -- No self-purchase: a seller can never buy (and thus get paid for) their
  -- own piece. auth.uid() is null under the service role, so compare the
  -- order's buyer to the product's seller directly.
  if v_product.seller_id is not null and v_product.seller_id = v_order.buyer_id then
    raise exception 'CANNOT_BUY_OWN';
  end if;

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
-- 2. admin_delete_product — fail never-paid pending orders
--
--    Removing a piece from the app used to leave any in-flight `pending`
--    orders behind. The order's product_id goes null (FK is SET NULL) but
--    the row stayed 'pending', so the buyer's account page showed a dead
--    order with a meetup/chat prompt for a piece that no longer exists —
--    and it could never be finalized ('noop' on null product_id), so it
--    wedged forever. These orders were never paid, so failing them (not
--    cancelling/refunding) is exactly right. The realtime feed then flips
--    the buyer's checkout modal to "Payment failed" if they're mid-flow.
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

  -- Fail any in-flight (never-paid) checkouts for this piece BEFORE the
  -- delete nulls orders.product_id. Never charged, so no refund needed —
  -- this just keeps the buyer's account page honest.
  update public.orders
    set status         = 'failed',
        failure_reason = 'Listing removed by the shop — you were not charged'
    where product_id = p_product_id and status = 'pending';

  -- The listing used to be removed by the FK cascade; with the FK now
  -- SET NULL, delete the listing rows explicitly (rejections remove both).
  delete from public.listings where product_id = p_product_id;
  delete from public.products where id = p_product_id;
end;
$$;

-- ====================================================================
-- 3. Backfill: fail orphaned pending orders
--
--    Pending orders created before this migration whose product was deleted
--    by admin_delete_product (or any path) have product_id = null. A
--    pending order NEVER legitimately has a null product_id — orders are
--    created with the product attached, and the FK only nulls on delete.
--    So: pending + product_id null = orphaned. Fail them all.
-- ====================================================================
update public.orders
  set status         = 'failed',
      failure_reason = 'Listing removed by the shop — you were not charged'
  where status = 'pending' and product_id is null;
