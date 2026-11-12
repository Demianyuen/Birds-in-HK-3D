-- Birds in HK · tidy up (optional). Run after 0003, once the SQL editor works again.
-- Flowers of the later white kinds were stored as a white chrysanthemum with the
-- real kind kept after the sender hash ("<hash>~white-rose"). This writes the real
-- kind into its own column. The website reads both forms, before and after.
update public.memorial_flowers
   set kind = split_part(sender_hash, '~', 2),
       sender_hash = split_part(sender_hash, '~', 1)
 where sender_hash like '%~%'
   and split_part(sender_hash, '~', 2) in (
     'white-rose', 'white-carnation', 'ginger-lily', 'white-lotus', 'white-orchid'
   );
