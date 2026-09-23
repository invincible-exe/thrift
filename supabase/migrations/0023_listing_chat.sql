-- ====================================================================
-- 0023 · PRE-PURCHASE LISTING CHAT
--
-- Buyers can message the uploader of a piece before buying ("still
-- available?", "does it fit?"). Mirrors the per-order chat from
-- 0008_meetups_locations.sql, but keyed on the listing instead of an
-- order so it works before checkout exists.
--
-- Design notes (Supabase best practices):
--   * Conversations are created ONLY by the SECURITY DEFINER RPC below —
--     clients get read-only access, so nobody can forge a thread they're
--     not part of. Messages use a plain RLS insert policy that pins
--     sender_id = auth.uid() and requires participant status.
--   * Denormalized snapshot columns (listing/buyer/seller names+images)
--     keep the inbox query to a single table — no joins, no embeds, and
--     RLS stays a single predicate per table.
--   * unique(listing_id, buyer_id) dedupes: one thread per buyer per
--     piece. The RPC's ON CONFLICT makes double-clicks idempotent.
-- ====================================================================

create table if not exists public.listing_conversations (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.products(id) on delete cascade,
  buyer_id      uuid not null references auth.users(id) on delete cascade,
  seller_id     uuid not null references auth.users(id) on delete cascade,
  -- Snapshot of the piece + parties at conversation start (inbox display).
  listing_title text not null default '',
  listing_image text not null default '',
  buyer_name    text not null default '',
  seller_name   text not null default '',
  created_at    timestamptz not null default now(),
  unique (listing_id, buyer_id),
  check (buyer_id <> seller_id)
);

-- Inbox lookups: my threads as buyer / as seller, newest first.
create index if not exists listing_conversations_buyer_idx
  on public.listing_conversations (buyer_id, created_at desc);
create index if not exists listing_conversations_seller_idx
  on public.listing_conversations (seller_id, created_at desc);

alter table public.listing_conversations enable row level security;

-- Participants (and admins) can read; nobody inserts from the client —
-- rows only come into existence through open_listing_chat().
drop policy if exists "listing_conversations_participant_read" on public.listing_conversations;
create policy "listing_conversations_participant_read" on public.listing_conversations
  for select using (
    auth.uid() = buyer_id
    or auth.uid() = seller_id
    or public.is_admin()
  );

create table if not exists public.listing_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.listing_conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);

create index if not exists listing_messages_conversation_idx
  on public.listing_messages (conversation_id, created_at);

alter table public.listing_messages enable row level security;

-- Only the buyer or seller in the thread (resolved through the parent
-- conversation), plus admins, can read it.
drop policy if exists "listing_messages_participant_read" on public.listing_messages;
create policy "listing_messages_participant_read" on public.listing_messages
  for select using (
    exists (
      select 1 from public.listing_conversations c
      where c.id = conversation_id
        and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
    or public.is_admin()
  );

-- You may only write messages as yourself into a thread you're in.
drop policy if exists "listing_messages_participant_insert" on public.listing_messages;
create policy "listing_messages_participant_insert" on public.listing_messages
  for insert to authenticated with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.listing_conversations c
      where c.id = conversation_id
        and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
  );

-- No UPDATE/DELETE policies on purpose: chat history is append-only and
-- immutable from the client side.

-- ====================================================================
-- RPC: open (or find) the caller's conversation on a piece
-- ====================================================================

create or replace function public.open_listing_chat(p_listing_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_listing     public.products%rowtype;
  v_conv_id     uuid;
  v_buyer_name  text := '';
  v_seller_name text := '';
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_listing from public.products where id = p_listing_id;
  if not found then
    raise exception 'PIECE_NOT_FOUND';
  end if;
  -- Platform-owned pieces (no uploader) can't be chatted with, and you
  -- can't message yourself.
  if v_listing.seller_id is null then
    raise exception 'NO_SELLER';
  end if;
  if v_listing.seller_id = auth.uid() then
    raise exception 'OWN_PIECE';
  end if;

  select coalesce(name, '') into v_buyer_name
    from public.profiles where id = auth.uid();
  select coalesce(name, '') into v_seller_name
    from public.profiles where id = v_listing.seller_id;

  insert into public.listing_conversations
    (listing_id, buyer_id, seller_id, listing_title, listing_image, buyer_name, seller_name)
  values
    (v_listing.id,
     auth.uid(),
     v_listing.seller_id,
     coalesce(v_listing.title, ''),
     coalesce(v_listing.image_url, ''),
     v_buyer_name,
     v_seller_name)
  on conflict (listing_id, buyer_id)
    do update set listing_id = excluded.listing_id  -- no-op; gets RETURNING id
  returning id into v_conv_id;

  return v_conv_id;
end;
$$;

revoke all on function public.open_listing_chat from public;
revoke all on function public.open_listing_chat from anon;
grant execute on function public.open_listing_chat to authenticated;

-- ====================================================================
-- REALTIME (threads update without a refresh)
-- ====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'listing_conversations'
  ) then
    alter publication supabase_realtime add table public.listing_conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'listing_messages'
  ) then
    alter publication supabase_realtime add table public.listing_messages;
  end if;
end $$;
