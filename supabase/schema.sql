-- Legends FC: database setup.
-- Paste into the Supabase SQL editor and run once.
-- Replace CHANGE_ME with your admin code before running (see setup.local.sql for the real one).
-- Everything is prefixed "legends_" so it can live inside an existing project.

-- One generic table holds every record: players, matches, fixtures, votes.
create table if not exists public.legends_docs (
  coll       text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);

alter table public.legends_docs enable row level security;
alter table public.legends_docs replica identity full;

-- Anyone with the link can read. Nobody can write directly:
-- writes only go through the two functions below.
drop policy if exists "legends read" on public.legends_docs;
create policy "legends read" on public.legends_docs
  for select to anon, authenticated using (true);

-- Live updates in the browser.
do $$ begin
  alter publication supabase_realtime add table public.legends_docs;
exception when duplicate_object then null; end $$;

-- The hardcoded admin code.
create or replace function public.legends_is_admin(code text)
returns boolean language sql immutable as $$
  select code = 'CHANGE_ME'
$$;

-- Admin writes (players, matches, calendar, test votes).
create or replace function public.legends_admin_write(
  code text, op text, p_coll text, p_id text, p_data jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.legends_is_admin(code) then
    raise exception 'Codi d''administrador incorrecte';
  end if;
  if op = 'delete' then
    delete from legends_docs where coll = p_coll and id = p_id;
  elsif op = 'set' then
    insert into legends_docs (coll, id, data) values (p_coll, p_id, p_data)
    on conflict (coll, id) do update set data = excluded.data, updated_at = now();
  elsif op = 'update' then
    update legends_docs set data = data || p_data, updated_at = now()
    where coll = p_coll and id = p_id;
  else
    raise exception 'Unknown op %', op;
  end if;
end $$;

-- Player ratings. Adds one match to the voter's record, never overwrites,
-- and only while that match's 24 h voting window is open.
create or replace function public.legends_vote(p_uid text, p_match text, p_rec jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare created bigint;
begin
  if length(p_uid) < 8 or length(p_uid) > 64 or octet_length(p_rec::text) > 20000 then
    raise exception 'Invalid vote';
  end if;
  select (data->>'createdAt')::bigint into created
    from legends_docs where coll = 'matches' and id = p_match;
  if created is null then raise exception 'Match not found'; end if;
  if created + 86400000 < extract(epoch from now()) * 1000 then
    raise exception 'La votació d''aquest partit ja ha tancat.';
  end if;
  insert into legends_docs (coll, id, data)
  values ('votes', p_uid, jsonb_build_object('byMatch', jsonb_build_object(p_match, p_rec)))
  on conflict (coll, id) do update
    set data = jsonb_set(legends_docs.data, '{byMatch}',
               coalesce(legends_docs.data->'byMatch', '{}'::jsonb) || jsonb_build_object(p_match, p_rec)),
        updated_at = now()
    where not (coalesce(legends_docs.data->'byMatch', '{}'::jsonb) ? p_match);
end $$;

grant execute on function public.legends_is_admin(text) to anon, authenticated;
grant execute on function public.legends_admin_write(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.legends_vote(text, text, jsonb) to anon, authenticated;
