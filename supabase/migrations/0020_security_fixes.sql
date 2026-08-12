-- 10/10 Thrifts — security fixes from the money-flow + RLS audit.
-- SAFE TO RE-RUN: every policy is drop-then-create; functions are
-- create-or-replace; triggers are drop-then-create; grants are
-- revoke-then-grant.

-- ====================================================================
-- 1. CRITICAL: profiles RLS allowed ANY signed-in user to insert their own
--    profile row with role='admin' — the insert policy only checked
--    id = auth.uid(), and the role-change trigger only fires on UPDATE.
--    Combined with is_admin() reading the DB role, that was full admin
--    escalation: read every order/payout, approve/delete listings, run
--    every admin RPC. The insert policy now forces role='user'; the SQL
--    editor / service role (which bypass RLS) can still create real admins.
-- ====================================================================
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid() and role = 'user');

-- Defense in depth: even if the policy ever drifts again, a signed-in user
-- can't create a profile row with any role other than 'user'.
create or replace function public.prevent_role_self_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role <> 'user' and auth.uid() is not null then
    raise exception 'You cannot create an account with a role';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_role_insert on public.profiles;
create trigger trg_profiles_prevent_role_insert
  before insert on public.profiles
  for each row execute function public.prevent_role_self_insert();

-- ====================================================================
-- 2. CRITICAL: finalize_order could DOUBLE-PAY on concurrent webhook
--    retries. Both finalize_order and finalize_order_by_reference read the
--    order row WITHOUT a lock, then inserted payouts unconditionally —
--    under READ COMMITTED, two simultaneous charge.success deliveries
--    (Paystack retries webhooks; serverless can run lambdas concurrently)
--    would both snapshot status='pending', both "complete" the order, and
--    both insert the seller + commission payouts.
--    Fix: `for update` on the order row at read time. The second
--    transaction now blocks, re-reads status='completed', and no-ops.
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
  select * into v_order from public.orders where id = p_order_id for update;
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

create or replace function public.finalize_order_by_reference(
  p_reference       text,
  p_expected_amount integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  -- for update: lock the row at lookup time so two concurrent webhook
  -- deliveries can't both reach finalize_order with a 'pending' snapshot.
  select * into v_order
  from public.orders
  where provider_ref = p_reference and status = 'pending'
  limit 1
  for update;
  if not found then return null; end if;

  if v_order.amount_kes is distinct from p_expected_amount then
    return 'mismatch';
  end if;

  return public.finalize_order(v_order.id, null, p_reference);
end;
$$;

revoke all on function public.finalize_order from public;
revoke all on function public.finalize_order from authenticated;
grant execute on function public.finalize_order to service_role;
revoke all on function public.finalize_order_by_reference from public;
revoke all on function public.finalize_order_by_reference from authenticated;
grant execute on function public.finalize_order_by_reference to service_role;

-- ====================================================================
-- 3. DATA HYGIENE: failed orders were stamped completed_at = now() — a
--    failed payment looked "completed" to any report/reconciler. Failure
--    no longer touches the completion timestamp. The backfill clears the
--    wrong timestamps left on historical failed rows.
-- ====================================================================
update public.orders
  set completed_at = null
  where status = 'failed' and completed_at is not null;
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
    failure_reason = coalesce(p_reason, 'M-Pesa transaction declined')
  where checkout_request_id = p_checkout_request_id and status = 'pending'
  returning id into v_order_id;
  return v_order_id;
end;
$$;

create or replace function public.mark_order_failed_by_reference(
  p_reference text,
  p_reason    text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id uuid;
begin
  update public.orders set
    status         = 'failed',
    failure_reason = coalesce(p_reason, 'Payment failed or cancelled')
  where provider_ref = p_reference and status = 'pending'
  returning id into v_order_id;
  return v_order_id;
end;
$$;

revoke all on function public.mark_order_failed from public;
revoke all on function public.mark_order_failed from authenticated;
grant execute on function public.mark_order_failed to service_role;
revoke all on function public.mark_order_failed_by_reference from public;
revoke all on function public.mark_order_failed_by_reference from authenticated;
grant execute on function public.mark_order_failed_by_reference to service_role;

-- ====================================================================
-- 4. RATINGS: the RLS insert/update policies only checked user_id, so a raw
--    client could attach a rating to an order they never bought (reputation
--    gaming — the API route checks ownership, but RLS is the last line of
--    defense and must too). Policies now require the linked order to be one
--    the caller actually bought. Ratings without an order_id stay allowed.
-- ====================================================================
drop policy if exists "ratings_insert_own" on public.ratings;
create policy "ratings_insert_own" on public.ratings
  for insert to authenticated with check (
    user_id = auth.uid()
    and (
      order_id is null
      or exists (
        select 1 from public.orders o
        where o.id = order_id and o.buyer_id = auth.uid()
      )
    )
  );

drop policy if exists "ratings_update_own" on public.ratings;
create policy "ratings_update_own" on public.ratings
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      order_id is null
      or exists (
        select 1 from public.orders o
        where o.id = order_id and o.buyer_id = auth.uid()
      )
    )
  );
