-- Crew owner controls: delete the crew, remove members.
--
-- The owner is crews.created_by. Opening a crew or lobby link joins the crew,
-- so removing someone also records a ban; otherwise they could just click the
-- invite link again. Deleting the crew cascades to its lobbies, entries,
-- members and bans.

create table public.crew_bans (
  crew_id   uuid not null references public.crews (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  banned_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

-- Only reachable through the RPCs below.
alter table public.crew_bans enable row level security;

create function public.delete_crew(p_crew uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from crews where id = p_crew and created_by = auth.uid();
  if not found then raise exception 'Only the crew owner can delete this crew'; end if;
end $$;

-- Removes the member and their entries in the crew's open lobbies. Results in
-- finished lobbies stay in the archive.
create function public.remove_crew_member(p_crew uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'Only the crew owner can remove members';
  end if;
  if p_user = auth.uid() then raise exception 'The owner can''t remove themselves'; end if;

  delete from crew_members where crew_id = p_crew and user_id = p_user;
  if not found then raise exception 'Not a member of this crew'; end if;

  delete from entries e
  using lobbies l
  where e.lobby_id = l.id and l.crew_id = p_crew and e.user_id = p_user and not lobby_closed(l);

  insert into crew_bans (crew_id, user_id) values (p_crew, p_user) on conflict do nothing;
end $$;

create or replace function public.join_crew(p_code text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from crews where invite_code = lower(trim(p_code));
  if not found then raise exception 'Crew not found'; end if;
  if exists (select 1 from crew_bans where crew_id = c.id and user_id = auth.uid()) then
    raise exception 'You were removed from this crew';
  end if;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return c;
end $$;

create or replace function public.join_lobby(p_code text) returns public.lobbies
language plpgsql security definer set search_path = public as $$
declare l lobbies;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into l from lobbies where invite_code = lower(trim(p_code));
  if not found then raise exception 'Lobby not found'; end if;
  if exists (select 1 from crew_bans where crew_id = l.crew_id and user_id = auth.uid()) then
    raise exception 'You were removed from this crew';
  end if;
  insert into crew_members (crew_id, user_id) values (l.crew_id, auth.uid()) on conflict do nothing;
  return l;
end $$;

revoke execute on function
  public.delete_crew(uuid),
  public.remove_crew_member(uuid, uuid)
from public, anon;

grant execute on function
  public.delete_crew(uuid),
  public.remove_crew_member(uuid, uuid)
to authenticated;
