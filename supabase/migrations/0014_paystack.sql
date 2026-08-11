-- 10/10 Thrifts — Paystack payments (replaces direct Safaricom Daraja).
-- SAFE TO RE-RUN: every add column is guarded, every function is
-- create-or-replace, grants are revoke-then-grant.
--
-- WHAT THIS ADDS:
--  1. profiles: the seller's payout preference — M-Pesa (default, phone only)
--     or bank transfer (Paystack bank_code + account number + account name).
--  2. payouts: a snapshot of payout_method and the Paystack recipient_code so
--     a transfer can be re-verified without re-deriving the recipient.
--  3. Reference-keyed finalization: Paystack identifies payments by
--     `reference` (stored in provider_ref), not Daraja's CheckoutRequestID.
--     finalize_order_by_reference / finalize_boost_by_reference verify the
--     exact amount before completing, mirroring the fail-closed Daraja
--     functions. The Daraja functions stay for historical rows.

-- ====================================================================
-- 1. PROFILES — payout destination
-- ====================================================================
alter table public.profiles add column if not exists payout_method text not null default 'mpesa'; -- 'mpesa' | 'bank'
alter table public.profiles add column if not exists bank_code text;              -- Paystack KES bank code
alter table public.profiles add column if not exists bank_account_number text;
alter table public.profiles add column if not exists bank_account_name text;

-- ====================================================================
-- 2. PAYOUTS — transfer snapshot
-- ====================================================================
alter table public.payouts add column if not exists payout_method text;   -- 'mpesa' | 'bank' (at send time)
alter table public.payouts add column if not exists recipient_code text;  -- Paystack RCP_… code

-- ====================================================================
-- 3. ORDER FINALIZATION BY PAYSTACK REFERENCE
-- ====================================================================
-- Locate a pending order by its Paystack reference (provider_ref), verify
-- the exact amount, then finalize. FAILS CLOSED: a null/missing expected
-- amount is a mismatch, so a payment reference without the amount can never
-- complete an order.
create or replace function public.finalize_order_by_reference(
  p_reference       text,
  p_expected_amount integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where provider_ref = p_reference and status = 'pending'
  limit 1;
  if not found then return null; end if;

  if v_order.amount_kes is distinct from p_expected_amount then
    return 'mismatch';
  end if;

  return public.finalize_order(v_order.id, null, p_reference);
end;
$$;

-- Mark a pending order failed by reference (e.g. the 1-of-1 sold to someone
-- else between charge and webhook, or a rejected/cancelled payment).
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
    failure_reason = coalesce(p_reason, 'Payment failed or cancelled'),
    completed_at   = now()
  where provider_ref = p_reference and status = 'pending'
  returning id into v_order_id;
  return v_order_id;
end;
$$;

-- ====================================================================
-- 4. BOOST FINALIZATION BY PAYSTACK REFERENCE
-- ====================================================================
-- Mirror of finalize_boost for Paystack references: verify the amount, mark
-- the boost paid, record the platform fee, and pin the piece for 7 days
-- (extending any active window). Service-role only, like the Daraja version.
create or replace function public.finalize_boost_by_reference(
  p_reference       text,
  p_expected_amount integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_boost public.boosts%rowtype;
begin
  select * into v_boost
  from public.boosts
  where provider_ref = p_reference and status = 'pending'
  limit 1;
  if not found then return null; end if;

  if v_boost.amount_kes is distinct from p_expected_amount then
    return 'mismatch';
  end if;

  update public.boosts
    set status  = 'paid',
        paid_at = now()
    where id = v_boost.id and status = 'pending';
  if not found then return 'noop'; end if;

  insert into public.payouts (order_id, "to", role, amount_kes)
  values (null, 'platform:admin', 'commission', v_boost.amount_kes);

  update public.products
    set boost_expires_at =
      greatest(coalesce(boost_expires_at, now()), now()) + interval '7 days'
    where id = v_boost.product_id and status = 'active';

  update public.listings
    set boost_expires_at =
      greatest(coalesce(boost_expires_at, now()), now()) + interval '7 days'
    where product_id = v_boost.product_id and status = 'active';

  return 'completed';
end;
$$;

-- Fail a pending boost by reference (cancelled / stale).
create or replace function public.mark_boost_failed_by_reference(
  p_reference text,
  p_reason    text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_boost_id uuid;
begin
  update public.boosts
    set status         = 'failed',
        failure_reason = coalesce(p_reason, 'Boost payment failed or cancelled')
    where provider_ref = p_reference and status = 'pending'
    returning id into v_boost_id;
  return v_boost_id;
end;
$$;

-- Finalization is server-only, exactly like the Daraja functions.
revoke all on function public.finalize_order_by_reference from public;
revoke all on function public.finalize_order_by_reference from authenticated;
grant execute on function public.finalize_order_by_reference to service_role;
revoke all on function public.mark_order_failed_by_reference from public;
revoke all on function public.mark_order_failed_by_reference from authenticated;
grant execute on function public.mark_order_failed_by_reference to service_role;
revoke all on function public.finalize_boost_by_reference from public;
revoke all on function public.finalize_boost_by_reference from authenticated;
grant execute on function public.finalize_boost_by_reference to service_role;
revoke all on function public.mark_boost_failed_by_reference from public;
revoke all on function public.mark_boost_failed_by_reference from authenticated;
grant execute on function public.mark_boost_failed_by_reference to service_role;
