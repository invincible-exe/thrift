-- 10/10 Thrifts — seller payout escrow.
-- SAFE TO RE-RUN: every column/function/trigger is guarded or
-- create-or-replace.
--
-- THE PROBLEM it solves: when a community piece sells, the seller's 90% was
-- paid out the moment the order completed. If the seller never ships (or
-- ships a damaged piece), the buyer has no leverage — the money is already
-- gone.
--
-- THE FIX: a temporary escrow state. The seller payout is created as
-- 'escrow' and held (it never reaches the B2C queue) until EITHER:
--   1. the buyer confirms they received the item (confirm_receipt), or
--   2. a 24-hour auto-resolve window passes (release_expired_escrow) — the
--      buyer's silence is treated as "received".
-- Only then does the payout flip to 'pending', where the existing
-- admin/auto B2C flow pays it out. The platform commission is NEVER held —
-- it stays 'pending' as before.
--
-- Implementation is a BEFORE INSERT trigger on payouts, so EVERY seller
-- payout — no matter which SQL function creates it (purchase_product,
-- finalize_order, finalize_by_checkout_request) — is escrowed automatically
-- without rewriting those functions.
--
-- Run in the Supabase SQL editor (after 0001-0004).

-- ====================================================================
-- 1. SCHEMA
-- ====================================================================
-- When the escrow is set to auto-release (now + 24h), and when the buyer
-- confirmed receipt. NULL escrow_release_at = not held.
alter table public.payouts add column if not exists escrow_release_at timestamptz;
alter table public.orders add column if not exists receipt_confirmed_at timestamptz;
alter table public.orders add column if not exists escrow_held_at timestamptz;

-- ====================================================================
-- 2. ESCROW HOLD (trigger)
-- ====================================================================
-- Any seller payout inserted as 'pending' becomes 'escrow' with a 24h
-- release window, and the order is flagged so the buyer's account page can
-- show "Confirm I received it".
create or replace function public.hold_seller_payout_escrow()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'seller' and new.status = 'pending' then
    new.status := 'escrow';
    -- 48h hold: the seller has 24h to show up for the meetup, then the
    -- buyer gets a 24h no-show cancel window before the money auto-releases.
    new.escrow_release_at := now() + interval '48 hours';
    update public.orders
      set escrow_held_at = coalesce(escrow_held_at, now())
      where id = new.order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payout_escrow_hold on public.payouts;
create trigger trg_payout_escrow_hold
  before insert on public.payouts
  for each row execute function public.hold_seller_payout_escrow();

-- ====================================================================
-- 3. BUYER CONFIRMS RECEIPT
-- ====================================================================
-- Buyer-only: stamps orders.receipt_confirmed_at and releases THIS order's
-- held seller payout(s) to 'pending'. Returns how many were released.
-- SECURITY DEFINER so the ownership check can't be bypassed by crafting a
-- raw update; the caller must be the order's buyer.
create or replace function public.confirm_receipt(p_order_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_buyer    uuid;
  v_released integer := 0;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select buyer_id into v_buyer from public.orders where id = p_order_id;
  if v_buyer is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_buyer <> auth.uid() then
    raise exception 'NOT_YOUR_ORDER';
  end if;

  update public.orders
    set receipt_confirmed_at = coalesce(receipt_confirmed_at, now()),
        escrow_held_at       = null
    where id = p_order_id;

  update public.payouts
    set status            = 'pending',
        escrow_release_at = null
    where order_id = p_order_id
      and role = 'seller'
      and status = 'escrow';
  get diagnostics v_released = row_count;

  return v_released;
end;
$$;

revoke all on function public.confirm_receipt from public;
grant execute on function public.confirm_receipt to authenticated;

-- ====================================================================
-- 4. AUTO-RESOLVE (24h window)
-- ====================================================================
-- Releases every seller payout whose 24h escrow window has elapsed — the
-- buyer's silence is treated as "received". Safe for any signed-in user to
-- call: it only ever releases payouts past their deadline. Returns how many
-- were released. The app sweeps this on page load (no cron needed).
create or replace function public.release_expired_escrow()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_released integer := 0;
begin
  update public.payouts p
    set status            = 'pending',
        escrow_release_at = null
    where p.role = 'seller'
      and p.status = 'escrow'
      and p.escrow_release_at is not null
      and p.escrow_release_at <= now()
      -- Disputed or cancelled orders never auto-release — the money stays
      -- held until the dispute is resolved or the cancellation is processed.
      and not exists (
        select 1 from public.orders o
        where o.id = p.order_id
          and (o.disputed_at is not null or o.cancelled_at is not null)
      );
  get diagnostics v_released = row_count;

  -- Clear the order flags for fully-resolved escrows so stale confirm
  -- buttons don't linger.
  update public.orders o
    set escrow_held_at = null
    where o.escrow_held_at is not null
      and not exists (
        select 1 from public.payouts p
        where p.order_id = o.id and p.status = 'escrow'
      );

  return v_released;
end;
$$;

revoke all on function public.release_expired_escrow from public;
grant execute on function public.release_expired_escrow to authenticated;
