-- Birds in HK · show what is said over the bird that said it.
-- Run once in the Supabase SQL editor, after 0001.
-- The id is the visitor's per-browser presence id, not an identity.
alter table public.memorial_chat
  add column if not exists speaker text not null default ''
  check (char_length(speaker) <= 40);
