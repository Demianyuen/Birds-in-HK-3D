-- Birds in HK · open-world memorial: flowers, messages and live chat.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Security model
-- * Visitors never write to these tables directly. The Vercel API inserts with
--   the service-role key after filtering and rate limiting.
-- * Visitors (anon key) can only READ through the public views / policies:
--   flowers with their name, the message only once a moderator approved it,
--   and recent chat lines that have not been hidden.

create extension if not exists pgcrypto;

create table if not exists public.memorial_flowers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null default '' check (char_length(name) <= 24),
  message text not null default '' check (char_length(message) <= 200),
  message_status text not null default 'none'
    check (message_status in ('none', 'pending', 'approved', 'rejected')),
  kind text not null default 'white-chrysanthemum'
    check (kind in ('white-chrysanthemum', 'yellow-chrysanthemum', 'lily', 'lantern')),
  -- Local Tai Po frame, metres (+x east, +z south), on the memorial ground.
  x real not null check (x between -400 and 400),
  z real not null check (z between -400 and 400),
  -- Height of the ground where the bird stood (a podium, a pavement, a garden).
  y real not null default 0 check (y between -20 and 300),
  hidden boolean not null default false,
  -- Salted hash of the sender's IP, for rate limiting only.
  sender_hash text not null default ''
);

create index if not exists memorial_flowers_created on public.memorial_flowers (created_at desc);
create index if not exists memorial_flowers_pending on public.memorial_flowers (message_status) where message_status = 'pending';
create index if not exists memorial_flowers_sender on public.memorial_flowers (sender_hash, created_at desc);

create table if not exists public.memorial_chat (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null default '' check (char_length(name) <= 24),
  body text not null check (char_length(body) between 1 and 120),
  -- Speaker's position when they spoke, for "nearby" chat bubbles.
  x real not null default 0,
  z real not null default 0,
  hidden boolean not null default false,
  sender_hash text not null default ''
);

create index if not exists memorial_chat_created on public.memorial_chat (created_at desc);
create index if not exists memorial_chat_sender on public.memorial_chat (sender_hash, created_at desc);

alter table public.memorial_flowers enable row level security;
alter table public.memorial_chat enable row level security;

-- No insert/update/delete policies: only the service role (Vercel API) writes.
-- Chat is read live through Realtime, so anon may read visible, recent lines.
drop policy if exists "read visible chat" on public.memorial_chat;
create policy "read visible chat" on public.memorial_chat
  for select to anon, authenticated
  using (hidden = false and created_at > now() - interval '1 day');

-- Flowers are read through this view, which never exposes unapproved messages
-- or the sender hash.
create or replace view public.memorial_flowers_public
  with (security_invoker = false) as
  select id, created_at, name,
         case when message_status = 'approved' then message else '' end as message,
         kind, x, y, z
  from public.memorial_flowers
  where hidden = false;

grant select on public.memorial_flowers_public to anon, authenticated;
revoke all on public.memorial_flowers from anon, authenticated;
revoke insert, update, delete on public.memorial_chat from anon, authenticated;
grant select on public.memorial_chat to anon, authenticated;

-- Live chat delivery: stream new chat rows to subscribed clients.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'memorial_chat'
  ) then
    alter publication supabase_realtime add table public.memorial_chat;
  end if;
end $$;
