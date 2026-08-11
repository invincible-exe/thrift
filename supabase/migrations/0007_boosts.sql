-- 10/10 Thrifts — boosted listings (self-serve, M-Pesa STK).
-- SAFE TO RE-RUN: every create is `if not exists`, every column is guarded
-- with `add column if not exists`, every function is create-or-replace, and
-- every policy is drop-then-create.
--
-- THE IDEA: sellers pay a flat fee (KES 50 — BOOST_PRICE_KES in the app)
-- with the same M-Pesa STK push used at checkout to pin a live piece to the
-- top of the feed for 7 days. The boost only activates when the payment
-- actually lands: the STK callback webhook finalizes a `boosts` row
-- (service-role RPC, verified against the callback's amount + phone) and
-- THAT sets products.boost_expires_at / listings.boost_expires_at. There is
-- no client-callable "make this boosted" — no payment, no boost. The feed
-- sorts live pieces by boost_expires_at (newest expiry first), so paid
-- boosts float to the top until they lapse.

-- ====================================================================
-- 1. SCHEMA
-- ====================================================================
alter table public.products add column if not exists boost_expires_at timestamptz;
alter table public.listings add column if not exists boost_expires_at timestamptz;
create index if not exists products_boost_expires_at_idx
  on public.products (boost_expires_at desc);

-- Pending/paid/failed boost payments, matched to the callback by
-- checkout_request_id (the mirror of `orders` for purchases).
create table if not exists public.boosts (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid references public.products(id) on delete cascade,
  seller_id           uuid references auth.users(id) on delete cascade not null,
  amount_kes          integer not null default 50,
  status              text not null default 'pending',  -- 'pending' | 'paid' | 'failed'
  failure_reason      text,
  checkout_request_id text,
  mpesa_phone         text,
  mpesa_receipt       text,
  provider_ref        text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index if not exists boosts_checkout_request_id_idx
  on public.boosts (checkout_request_id);
create index if not exists boosts_seller_id_idx on public.boosts (seller_id);
create index if not exists boosts_product_id_idx on public.boosts (product_id);

-- ====================================================================
-- 2. RLS
-- ====================================================================
-- Seller reads their own boosts; admins read all. Writes happen only via the
-- server route (service role) and the callback RPCs — clients get no direct
-- insert/update on this table.
alter table public.boosts enable row level security;
drop policy if exists "boosts_read_owner_or_admin" on public.boosts;
create policy "boosts_read_owner_or_admin" on public.boosts
  for select using (seller_id = auth.uid() or public.is_admin());

-- ====================================================================
-- 3. FINALIZATION (callback, service-role only)
-- ====================================================================
-- Verify the callback's amount + phone against the pending boost, mark it
-- paid, and pin the piece for 7 days. FAILS CLOSED exactly like
-- finalize_by_checkout_request: a null/missing expected value is treated as
-- a mismatch, so a callback that omits the amount or phone can never
-- activate a boost. Extends from the later of now / the current expiry so
-- stacked boosts add time instead of being wasted.
create or replace function public.finalize_boost(
  p_checkout_request_id text,
  p_mpesa_receipt       text default null,
  p_expected_amount     integer default null,
  p_expected_phone      text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_boost public.boosts%rowtype;
begin
  select * into v_boost
  from public.boosts
  where checkout_request_id = p_checkout_request_id and status = 'pending'
  limit 1;
  if not found then return null; end if;

  if v_boost.amount_kes is distinct from p_expected_amount then
    return 'mismatch';
  end if;
  if v_boost.mpesa_phone is distinct from p_expected_phone then
    return 'mismatch';
  end if;

  update public.boosts
    set status         = 'paid',
        mpesa_receipt  = coalesce(p_mpesa_receipt, mpesa_receipt),
        paid_at        = now()
    where id = v_boost.id and status = 'pending';
  -- Race guard: a duplicate/re-delivered callback that lost the status race
  -- updates 0 rows — bail so the window is never extended twice.
  if not found then return 'noop'; end if;

  -- Record the platform's boost fee in the payouts ledger (role
  -- 'commission', to the platform wallet) so the admin wallet total — which
  -- sums payouts where "to" = 'platform:admin' — reflects boost revenue the
  -- same way it tracks purchase commissions. order_id is null (boosts aren't
  -- purchases); the escrow trigger only holds 'seller' rows, so this stays
  -- 'pending' and simply counts toward the wallet.
  insert into public.payouts (order_id, "to", role, amount_kes)
  values (null, 'platform:admin', 'commission', v_boost.amount_kes);

  -- Pin the piece for 7 days (extending any active boost). Only touches live
  -- pieces — a piece that sold mid-payment never gets a pointless pin.
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

-- Fail a pending boost (user declined / STK timeout / stale). Returns the
-- boost id, or null when there was no pending boost to fail.
create or replace function public.mark_boost_failed(
  p_checkout_request_id text,
  p_reason              text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_boost_id uuid;
begin
  update public.boosts
    set status         = 'failed',
        failure_reason = coalesce(p_reason, 'M-Pesa boost payment failed or cancelled')
    where checkout_request_id = p_checkout_request_id and status = 'pending'
    returning id into v_boost_id;
  return v_boost_id;
end;
$$;

-- Boost finalization is server-only (the STK webhook), like purchases — a
-- client can never mark its own boost paid.
revoke all on function public.finalize_boost from public;
revoke all on function public.finalize_boost from authenticated;
grant execute on function public.finalize_boost to service_role;
revoke all on function public.mark_boost_failed from public;
revoke all on function public.mark_boost_failed from authenticated;
grant execute on function public.mark_boost_failed to service_role;

-- ====================================================================
-- 4. REALTIME
-- ====================================================================
-- The boost watcher (account page) needs boosts; the seller's listing list
-- needs listings so a paid boost flips to "Boosted" without a refresh.
-- Guarded with pg_publication_tables so re-running never errors.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'boosts'
  ) then
    alter publication supabase_realtime add table public.boosts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'listings'
  ) then
    alter publication supabase_realtime add table public.listings;
  end if;
end $$;
