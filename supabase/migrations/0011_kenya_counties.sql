-- 10/10 Thrifts — full Kenya county catalog (Jumia-style: County → Town).
-- SAFE TO RE-RUN: the renames are guarded UPDATEs (idempotent — a second run
-- finds no rows to move) and the seed is `on conflict (city, area, landmark)
-- do nothing`, so re-pasting never duplicates rows.
--
-- WHAT THIS ADDS:
--  1. Re-aligns the two town-as-city rows to their real counties so the first
--     dropdown lists EXACTLY the 47 counties (like Jumia's county selector):
--        'Eldoret' → 'Uasin Gishu'   (Eldoret is a town in Uasin Gishu)
--        'Thika'   → 'Kiambu'        (Thika is a town in Kiambu)
--     Existing listings keep their stored location_label; only new picks see
--     the county name.
--  2. Seeds every remaining county with its major towns (2–6 per county).
--     Nairobi / Mombasa / Kisumu / Nakuru already have rows; this adds their
--     out-of-town areas (Naivasha, Gilgil, Ahero, Maseno…) alongside.
--
-- The `city` column now holds county names (Nairobi, Kiambu, Uasin Gishu…)
-- and `area` holds the town/neighbourhood (Westlands, Thika, Ruiru…). The
-- label derivation ("County · Town") is unchanged and the UI copy reads
-- "County" for the first dropdown.

-- ====================================================================
-- 1. RENAME TOWN-AS-CITY ROWS TO THEIR COUNTIES
-- ====================================================================
update public.locations set city = 'Uasin Gishu' where city = 'Eldoret';
update public.locations set city = 'Kiambu'      where city = 'Thika';

-- ====================================================================
-- 2. SEED ALL 47 COUNTIES (missing ones + extra towns in existing ones)
-- ====================================================================
insert into public.locations (city, area, landmark) values
  -- Baringo
  ('Baringo',        'Kabarnet',        ''),
  ('Baringo',        'Eldama Ravine',   ''),
  ('Baringo',        'Marigat',         ''),
  -- Bomet
  ('Bomet',          'Bomet',           ''),
  ('Bomet',          'Sotik',           ''),
  -- Bungoma
  ('Bungoma',        'Bungoma',         ''),
  ('Bungoma',        'Kimilili',        ''),
  ('Bungoma',        'Webuye',          ''),
  ('Bungoma',        'Chwele',          ''),
  -- Busia
  ('Busia',          'Busia',           ''),
  ('Busia',          'Malaba',          ''),
  ('Busia',          'Nambale',         ''),
  ('Busia',          'Port Victoria',   ''),
  -- Elgeyo-Marakwet
  ('Elgeyo-Marakwet','Iten',            ''),
  ('Elgeyo-Marakwet','Kapsowar',        ''),
  ('Elgeyo-Marakwet','Chesoi',          ''),
  -- Embu
  ('Embu',           'Embu',            ''),
  ('Embu',           'Runyenjes',       ''),
  ('Embu',           'Manyatta',        ''),
  -- Garissa
  ('Garissa',        'Garissa',         ''),
  ('Garissa',        'Dadaab',          ''),
  ('Garissa',        'Masalani',        ''),
  -- Homa Bay
  ('Homa Bay',       'Homa Bay',        ''),
  ('Homa Bay',       'Mbita',           ''),
  ('Homa Bay',       'Kendu Bay',       ''),
  ('Homa Bay',       'Oyugis',          ''),
  -- Isiolo
  ('Isiolo',         'Isiolo',          ''),
  ('Isiolo',         'Merti',           ''),
  ('Isiolo',         'Garbatulla',      ''),
  -- Kajiado
  ('Kajiado',        'Kajiado',         ''),
  ('Kajiado',        'Ngong',           ''),
  ('Kajiado',        'Ongata Rongai',   ''),
  ('Kajiado',        'Kitengela',       ''),
  ('Kajiado',        'Loitokitok',      ''),
  -- Kakamega
  ('Kakamega',       'Kakamega',        ''),
  ('Kakamega',       'Mumias',          ''),
  ('Kakamega',       'Malava',          ''),
  ('Kakamega',       'Butere',          ''),
  -- Kericho
  ('Kericho',        'Kericho',         ''),
  ('Kericho',        'Londiani',        ''),
  ('Kericho',        'Litein',          ''),
  -- Kiambu (Thika rows renamed above; extra county towns below)
  ('Kiambu',         'Ruiru',           ''),
  ('Kiambu',         'Kiambu',          ''),
  ('Kiambu',         'Limuru',          ''),
  ('Kiambu',         'Kikuyu',          ''),
  ('Kiambu',         'Juja',            ''),
  ('Kiambu',         'Githunguri',      ''),
  -- Kilifi
  ('Kilifi',         'Kilifi',          ''),
  ('Kilifi',         'Malindi',         ''),
  ('Kilifi',         'Watamu',          ''),
  ('Kilifi',         'Mariakani',       ''),
  ('Kilifi',         'Mtwapa',          ''),
  -- Kirinyaga
  ('Kirinyaga',      'Kerugoya',        ''),
  ('Kirinyaga',      'Wanguru',         ''),
  ('Kirinyaga',      'Sagana',          ''),
  -- Kisii
  ('Kisii',          'Kisii',           ''),
  ('Kisii',          'Keroka',          ''),
  ('Kisii',          'Ogembo',          ''),
  -- Kisumu (city rows exist; add the lake-side towns)
  ('Kisumu',         'Ahero',           ''),
  ('Kisumu',         'Maseno',          ''),
  ('Kisumu',         'Muhoroni',        ''),
  -- Kitui
  ('Kitui',          'Kitui',           ''),
  ('Kitui',          'Mwingi',          ''),
  ('Kitui',          'Mutomo',          ''),
  -- Kwale
  ('Kwale',          'Diani',           ''),
  ('Kwale',          'Ukunda',          ''),
  ('Kwale',          'Msambweni',       ''),
  ('Kwale',          'Lunga Lunga',     ''),
  -- Laikipia
  ('Laikipia',       'Nanyuki',         ''),
  ('Laikipia',       'Nyahururu',       ''),
  ('Laikipia',       'Rumuruti',        ''),
  -- Lamu
  ('Lamu',           'Lamu',            ''),
  ('Lamu',           'Mpeketoni',       ''),
  ('Lamu',           'Faza',            ''),
  -- Machakos
  ('Machakos',       'Machakos',        ''),
  ('Machakos',       'Athi River',      ''),
  ('Machakos',       'Kangundo',        ''),
  ('Machakos',       'Mwala',           ''),
  ('Machakos',       'Kathiani',        ''),
  -- Makueni
  ('Makueni',        'Wote',            ''),
  ('Makueni',        'Kibwezi',         ''),
  ('Makueni',        'Makindu',         ''),
  -- Mandera
  ('Mandera',        'Mandera',         ''),
  ('Mandera',        'El Wak',          ''),
  ('Mandera',        'Rhamu',           ''),
  -- Marsabit
  ('Marsabit',       'Marsabit',        ''),
  ('Marsabit',       'Moyale',          ''),
  ('Marsabit',       'Loiyangalani',    ''),
  -- Meru
  ('Meru',           'Meru',            ''),
  ('Meru',           'Maua',            ''),
  ('Meru',           'Nkubu',           ''),
  ('Meru',           'Timau',           ''),
  -- Migori
  ('Migori',         'Migori',          ''),
  ('Migori',         'Rongo',           ''),
  ('Migori',         'Kehancha',        ''),
  ('Migori',         'Isebania',        ''),
  -- Murang'a
  ('Murang''a',      'Murang''a',       ''),
  ('Murang''a',      'Kenol',           ''),
  ('Murang''a',      'Kangari',         ''),
  ('Murang''a',      'Gatanga',         ''),
  -- Nakuru (city rows exist; add the rift-valley towns)
  ('Nakuru',         'Naivasha',        ''),
  ('Nakuru',         'Gilgil',          ''),
  ('Nakuru',         'Molo',            ''),
  ('Nakuru',         'Njoro',           ''),
  -- Nandi
  ('Nandi',          'Kapsabet',        ''),
  ('Nandi',          'Nandi Hills',     ''),
  ('Nandi',          'Kipkaren',        ''),
  -- Narok
  ('Narok',          'Narok',           ''),
  ('Narok',          'Kilgoris',        ''),
  ('Narok',          'Mai Mahiu',       ''),
  -- Nyamira
  ('Nyamira',        'Nyamira',         ''),
  ('Nyamira',        'Keroka',          ''),
  ('Nyamira',        'Nyansiongo',      ''),
  -- Nyandarua
  ('Nyandarua',      'Ol Kalou',        ''),
  ('Nyandarua',      'Njabini',         ''),
  ('Nyandarua',      'Engineer',        ''),
  ('Nyandarua',      'Mairo Inya',      ''),
  -- Nyeri
  ('Nyeri',          'Nyeri',           ''),
  ('Nyeri',          'Karatina',        ''),
  ('Nyeri',          'Othaya',          ''),
  ('Nyeri',          'Mukurwe-ini',     ''),
  -- Samburu
  ('Samburu',        'Maralal',         ''),
  ('Samburu',        'Wamba',           ''),
  ('Samburu',        'Baragoi',         ''),
  -- Siaya
  ('Siaya',          'Siaya',           ''),
  ('Siaya',          'Bondo',           ''),
  ('Siaya',          'Ugunja',          ''),
  ('Siaya',          'Ukwala',          ''),
  -- Taita-Taveta
  ('Taita-Taveta',   'Voi',             ''),
  ('Taita-Taveta',   'Taveta',          ''),
  ('Taita-Taveta',   'Wundanyi',        ''),
  -- Tana River
  ('Tana River',     'Hola',            ''),
  ('Tana River',     'Garsen',          ''),
  -- Tharaka-Nithi
  ('Tharaka-Nithi',  'Chuka',           ''),
  ('Tharaka-Nithi',  'Marimanti',       ''),
  ('Tharaka-Nithi',  'Kathwana',        ''),
  -- Trans Nzoia
  ('Trans Nzoia',    'Kitale',          ''),
  ('Trans Nzoia',    'Kiminini',        ''),
  ('Trans Nzoia',    'Kwanza',          ''),
  -- Turkana
  ('Turkana',        'Lodwar',          ''),
  ('Turkana',        'Kakuma',          ''),
  ('Turkana',        'Lokichar',        ''),
  ('Turkana',        'Lokitaung',       ''),
  -- Uasin Gishu (Eldoret rows renamed above; extra towns below)
  ('Uasin Gishu',    'Ziwa',            ''),
  ('Uasin Gishu',    'Turbo',           ''),
  ('Uasin Gishu',    'Kesses',          ''),
  -- Vihiga
  ('Vihiga',         'Vihiga',          ''),
  ('Vihiga',         'Mbale',           ''),
  ('Vihiga',         'Maragoli',        ''),
  ('Vihiga',         'Luanda',          ''),
  -- Wajir
  ('Wajir',          'Wajir',           ''),
  ('Wajir',          'Habaswein',       ''),
  ('Wajir',          'Griftu',          ''),
  -- West Pokot
  ('West Pokot',     'Kapenguria',      ''),
  ('West Pokot',     'Chepareria',      ''),
  ('West Pokot',     'Sigor',           '')
on conflict (city, area, landmark) do nothing;

-- ====================================================================
-- 3. REFRESH LABELS AFTER THE RENAME
-- ====================================================================
-- Existing products/listings whose location_id pointed at the old
-- 'Eldoret'/'Thika' catalog rows pick up the renamed county in their stored
-- location_label ("Uasin Gishu · CBD" instead of stale "Eldoret · CBD").
-- Rows without a catalog match are left untouched, and `is distinct from`
-- makes this a cheap no-op on re-run.
update public.products p
  set location_label = loc.city || ' · ' || loc.area
  from public.locations loc
  where p.location_id = loc.id
    and p.location_label is distinct from loc.city || ' · ' || loc.area;
update public.listings li
  set location_label = loc.city || ' · ' || loc.area
  from public.locations loc
  where li.location_id = loc.id
    and li.location_label is distinct from loc.city || ' · ' || loc.area;
