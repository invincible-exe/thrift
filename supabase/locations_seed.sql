-- 10/10 Thrifts — LOCATIONS CATALOG (standalone seed)
-- ============================================================
-- Paste this whole file into the Supabase SQL editor and run it.
-- It is fully idempotent: if the `locations` table already exists it just
-- adds the rows that are missing, and re-running is always safe.
--
-- This is the data that powers:
--   • "Where will you hand over the piece?" (Sell + admin Add a piece)
--   • "Your area" on the account page
--   • The feed's 📍 Location filter and the "Near me" filter
-- If the dropdowns look empty, your database is missing these rows.

create table if not exists public.locations (
  id       uuid primary key default gen_random_uuid(),
  city     text not null,
  area     text not null,
  landmark text not null default '',
  unique (city, area, landmark)
);

-- The catalog must be readable by everyone (public meetup data — no user
-- rows), while writes stay locked. This fixes the case where the table was
-- created with RLS on but no read policy, which made every location dropdown
-- empty even after seeding.
alter table public.locations enable row level security;
drop policy if exists "locations_public_read" on public.locations;
create policy "locations_public_read" on public.locations
  for select to anon, authenticated using (true);

-- Nairobi
insert into public.locations (city, area, landmark) values
  ('Nairobi', 'Westlands',  'Westlands Mall'),
  ('Nairobi', 'Westlands',  'Sarit Centre'),
  ('Nairobi', 'Westlands',  'Delta Towers'),
  ('Nairobi', 'Kilimani',   'Yaya Centre'),
  ('Nairobi', 'Kilimani',   'Adams Arcade'),
  ('Nairobi', 'Kilimani',   'Valley Arcade'),
  ('Nairobi', 'CBD',        'Kenyatta Avenue'),
  ('Nairobi', 'CBD',        'Moi Avenue'),
  ('Nairobi', 'CBD',        'Nairobi Archives'),
  ('Nairobi', 'Lavington',  'Lavington Mall'),
  ('Nairobi', 'Kileleshwa', 'Kileleshwa Posta'),
  ('Nairobi', 'Kasarani',   'TRM (Thika Road Mall)'),
  ('Nairobi', 'Eastleigh',  'Eastleigh Mall'),
  ('Nairobi', 'South B',    'South B Shops'),
  ('Nairobi', 'Ngong Road', 'The Junction'),
  ('Nairobi', 'Langata',    'Galleria Mall'),
  ('Nairobi', 'Karen',      'Karen Hub'),
  ('Nairobi', 'Karen',      'The Hub Karen'),
  ('Nairobi', 'Gigiri',     'UN Complex Gate'),
  ('Nairobi', 'Runda',      'Runda Mall'),
  ('Nairobi', 'Umoja',      'Umoja One'),
  ('Nairobi', 'Donholm',    'Donholm Plaza')
on conflict (city, area, landmark) do nothing;

-- Mombasa
insert into public.locations (city, area, landmark) values
  ('Mombasa', 'CBD',       'Moi Avenue'),
  ('Mombasa', 'CBD',       'Digo Road'),
  ('Mombasa', 'Nyali',     'City Mall Nyali'),
  ('Mombasa', 'Nyali',     'Nyali Centre'),
  ('Mombasa', 'Bamburi',   'Bamburi Beach'),
  ('Mombasa', 'Bamburi',   'Naivas Bamburi'),
  ('Mombasa', 'Changamwe', 'Airport Road'),
  ('Mombasa', 'Likoni',    'Likoni Ferry'),
  ('Mombasa', 'Tudor',     'Tudor Creek'),
  ('Mombasa', 'Kizingo',   'Kizingo Road')
on conflict (city, area, landmark) do nothing;

-- Kisumu
insert into public.locations (city, area, landmark) values
  ('Kisumu', 'CBD',      'Oginga Odinga Street'),
  ('Kisumu', 'CBD',      'Clock Tower'),
  ('Kisumu', 'Milimani', 'Milimani Estate'),
  ('Kisumu', 'Nyalenda', 'Nyalenda Market'),
  ('Kisumu', 'Manyatta', 'Manyatta Estate'),
  ('Kisumu', 'Kondele',  'Kondele Market'),
  ('Kisumu', 'Kibos',    'Kibos Junction')
on conflict (city, area, landmark) do nothing;

-- Nakuru
insert into public.locations (city, area, landmark) values
  ('Nakuru', 'CBD',         'Kenyatta Avenue'),
  ('Nakuru', 'CBD',         'Nakuru Clock Tower'),
  ('Nakuru', 'Milimani',    'Milimani Estate'),
  ('Nakuru', 'Lake View',   'Lake View Estate'),
  ('Nakuru', 'Section 58',  'Section 58 & 58A'),
  ('Nakuru', 'Kiamunyi',    'Kiamunyi Market'),
  ('Nakuru', 'Lanet',       'Lanet Center')
on conflict (city, area, landmark) do nothing;

-- Eldoret
insert into public.locations (city, area, landmark) values
  ('Eldoret', 'CBD',        'Uganda Road'),
  ('Eldoret', 'CBD',        'Oloo Street'),
  ('Eldoret', 'Elgon View', 'Elgon View Estate'),
  ('Eldoret', 'Kapsoya',    'Kapsoya Market'),
  ('Eldoret', 'Langas',     'Langas Estate'),
  ('Eldoret', 'Pioneer',    'Pioneer Estate'),
  ('Eldoret', 'Kimumu',     'Kimumu Junction')
on conflict (city, area, landmark) do nothing;

-- Thika
insert into public.locations (city, area, landmark) values
  ('Thika', 'CBD',        'Kenyatta Avenue'),
  ('Thika', 'CBD',        'Del Monte Roundabout'),
  ('Thika', 'Ngoingwa',   'Ngoingwa Estate'),
  ('Thika', 'Makongeni',  'Makongeni Market'),
  ('Thika', 'Majengo',    'Majengo Estate'),
  ('Thika', 'Blue Post',  'Blue Post Hotel'),
  ('Thika', 'Gatuanyaga', 'Gatuanyaga Center')
on conflict (city, area, landmark) do nothing;
