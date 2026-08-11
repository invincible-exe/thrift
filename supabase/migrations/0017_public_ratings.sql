-- 10/10 Thrifts — public rating summaries (trust signals).
--
-- ratings rows are RLS-private (buyers see only their own), so public star
-- displays need an aggregate that can read across buyers. get_rating_summary
-- is security definer (like the other read-only helpers in this repo) and
-- returns the average score + count for:
--   - one seller (p_seller_id set)  → ratings on orders of that seller's pieces
--   - the shop    (p_seller_id null) → every rating (platform pieces)
-- anon is granted execute so logged-out browsers still see the stars.

create or replace function public.get_rating_summary(p_seller_id uuid default null)
returns table (avg_score numeric, total bigint)
language sql stable security definer set search_path = public
as $$
  select round(avg(r.score), 1)::numeric as avg_score, count(*)::bigint as total
  from public.ratings r
  where p_seller_id is null
     or r.order_id in (
          select o.id
          from public.orders o
          join public.products p on p.id = o.product_id
          where p.seller_id = p_seller_id
        )
$$;

revoke all on function public.get_rating_summary(uuid) from public;
grant execute on function public.get_rating_summary(uuid) to anon, authenticated;

-- ====================================================================
-- 2. SELLER PROFILE (public) — the persistent home for ratings.
-- ====================================================================
-- Pieces are 1-of-1 and DELETED when sold, so a seller's reputation can't
-- live on a product page — it lives on their profile. profiles/payouts are
-- RLS-private, so this security-definer function exposes only the public
-- subset: display name, member-since date, meetup area, rating summary, and
-- completed sales count (one 'seller' payout row per sale).
create or replace function public.get_seller_profile(p_seller_id uuid)
returns table (
  name           text,
  member_since   timestamptz,
  location_label text,
  avg_score      numeric,
  rating_count   bigint,
  sales          bigint
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
      where py."to" = p_seller_id::text and py.role = 'seller')::bigint
  from public.profiles pr
  left join public.locations l on l.id = pr.location_id
  left join public.ratings r on r.order_id in (
    select o.id from public.orders o
    join public.products p on p.id = o.product_id
    where p.seller_id = p_seller_id
  )
  where pr.id = p_seller_id
  group by pr.id, pr.name, pr.created_at, l.city, l.area
$$;

revoke all on function public.get_seller_profile(uuid) from public;
grant execute on function public.get_seller_profile(uuid) to anon, authenticated;
