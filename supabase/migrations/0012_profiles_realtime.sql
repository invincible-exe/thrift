-- 10/10 Thrifts — profiles in realtime.
-- SAFE TO RE-RUN: guarded by the same publication check every other migration uses.
--
-- WHY: the buyer's `profiles.location_id` powers the "Near you" feed section and
-- the post-sign-in area prompt. With profiles in the realtime publication, a user
-- saving their area updates the open feed instantly (no refresh needed) — the
-- same push model the products/orders/payouts tables already use.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
