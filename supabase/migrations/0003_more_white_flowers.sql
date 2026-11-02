-- Birds in HK · more white flowers of remembrance.
-- Run once in the Supabase SQL editor, after 0001 and 0002.
alter table public.memorial_flowers drop constraint if exists memorial_flowers_kind_check;
alter table public.memorial_flowers add constraint memorial_flowers_kind_check
  check (kind in (
    'white-chrysanthemum', 'lily', 'white-rose', 'white-carnation', 'ginger-lily',
    'white-lotus', 'white-orchid', 'yellow-chrysanthemum', 'lantern'
  ));
