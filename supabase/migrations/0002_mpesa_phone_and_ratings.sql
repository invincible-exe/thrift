-- 10/10 Thrifts — post-launch fixes.
-- SAFE TO RE-RUN: every column/table/policy is guarded (add column if not
-- exists / create table if not exists / drop policy if exists).
--
-- 1) orders.mpesa_phone — the live DB predates this column in 0001_init.sql,
--    which silently broke STK checkout (the pending-order insert threw
--    "column orders.mpesa_phone does not exist" AFTER the push went out).
-- 2) ratings — post-purchase experience ratings (1–5), collected in the
--    checkout success screen.
--
-- Run in the Supabase SQL editor, or `supabase db push`.

-- ====================================================================
-- 1. MISSING COLUMN FIX
-- ====================================================================
alter table public.orders add column if not exists mpesa_phone text;

-- ====================================================================
-- 2. RATINGS
-- ====================================================================
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  order_id   uuid references public.orders(id) on delete set null,
  score      integer not null check (score between 1 and 5),
  created_at timestamptz not null default now()
);
-- Catch-up: ensure every column exists even on older installs.
alter table public.ratings add column if not exists id uuid;
alter table public.ratings add column if not exists user_id uuid;
alter table public.ratings add column if not exists order_id uuid;
alter table public.ratings add column if not exists score integer;
alter table public.ratings add column if not exists created_at timestamptz not null default now();
create index if not exists ratings_user_idx on public.ratings (user_id);
create index if not exists ratings_order_idx on public.ratings (order_id);
-- One rating per order (order_id is null for ratings without an order).
create unique index if not exists ratings_order_once_idx
  on public.ratings (order_id) where order_id is not null;

alter table public.ratings enable row level security;

-- Buyers insert their own ratings; everyone reads their own, admins read all.
drop policy if exists "ratings_insert_own" on public.ratings;
create policy "ratings_insert_own" on public.ratings
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "ratings_read_own_or_admin" on public.ratings;
create policy "ratings_read_own_or_admin" on public.ratings
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "ratings_update_own" on public.ratings;
create policy "ratings_update_own" on public.ratings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
