-- Scrim v0.1 schema
--
-- Model:
--   crews         persistent friend groups (rankings, h2h, archive live here)
--   lobbies       one game + one puzzle, belongs to a crew, closes at a deadline
--   entries       one result per player per lobby
--
-- All writes go through the security-definer RPCs at the bottom of this file so
-- the rules (membership, deadlines, one entry per player, result validation)
-- are enforced server-side. Tables only expose SELECT via row-level security.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  created_at   timestamptz not null default now()
);

create table public.crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table public.crew_members (
  crew_id   uuid not null references public.crews (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create table public.lobbies (
  id                   uuid primary key default gen_random_uuid(),
  crew_id              uuid not null references public.crews (id) on delete cascade,
  game                 text not null,
  puzzle_id            text not null,
  invite_code          text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_by           uuid not null references public.profiles (id),
  created_at           timestamptz not null default now(),
  closes_at            timestamptz not null,
  closed_at            timestamptz,
  hide_until_submitted boolean not null default true,
  allow_manual         boolean not null default true,
  unique (crew_id, game, puzzle_id)
);

create table public.entries (
  id           uuid primary key default gen_random_uuid(),
  lobby_id     uuid not null references public.lobbies (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  result       jsonb not null,
  raw          text,
  source       text not null check (source in ('paste', 'manual', 'extension')),
  submitted_at timestamptz not null default now(),
  unique (lobby_id, user_id)
);

create index on public.crew_members (user_id);
create index on public.lobbies (crew_id);
create index on public.entries (lobby_id);

-- ---------------------------------------------------------------------------
-- Profile bootstrap: every auth user (guest or Google) gets a profile row
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      'Player'
    ), 24)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.is_crew_member(p_crew uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from crew_members where crew_id = p_crew and user_id = auth.uid()
  )
$$;

create function public.lobby_closed(l public.lobbies) returns boolean
language sql stable as $$
  select l.closed_at is not null or l.closes_at <= now()
$$;

-- Spoiler protection: while a lobby is open and hide_until_submitted is on,
-- you can only see other players' results after submitting your own.
create function public.can_see_entry(p_lobby uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from lobbies l
    where l.id = p_lobby
      and is_crew_member(l.crew_id)
      and (
        p_owner = auth.uid()
        or not l.hide_until_submitted
        or lobby_closed(l)
        or exists (select 1 from entries e where e.lobby_id = l.id and e.user_id = auth.uid())
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Row-level security (read-only; writes go through RPCs)
-- ---------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.crews        enable row level security;
alter table public.crew_members enable row level security;
alter table public.lobbies      enable row level security;
alter table public.entries      enable row level security;

create policy "profiles readable" on public.profiles
  for select to authenticated using (true);
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members read crew" on public.crews
  for select to authenticated using (is_crew_member(id));
create policy "members read members" on public.crew_members
  for select to authenticated using (is_crew_member(crew_id));
create policy "members read lobbies" on public.lobbies
  for select to authenticated using (is_crew_member(crew_id));
create policy "read visible entries" on public.entries
  for select to authenticated using (can_see_entry(lobby_id, user_id));

-- ---------------------------------------------------------------------------
-- Game validation (mirrors src/games/*; keep in sync when adding games)
-- ---------------------------------------------------------------------------

create function public.normalize_result(p_game text, p_puzzle text, p_result jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_solved  boolean;
  v_guesses int;
  v_grid    jsonb;
  v_rows    int;
  v_row     text;
  i         int;
begin
  if p_game = 'wordle' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Wordle #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_solved := coalesce((p_result ->> 'solved')::boolean, false);
    v_guesses := case when v_solved then (p_result ->> 'guesses')::int else null end;
    if v_solved and (v_guesses is null or v_guesses not between 1 and 6) then
      raise exception 'Guesses must be between 1 and 6';
    end if;

    v_grid := p_result -> 'grid';
    if v_grid is not null and jsonb_typeof(v_grid) <> 'null' then
      if jsonb_typeof(v_grid) <> 'array' then
        raise exception 'Invalid grid';
      end if;
      v_rows := jsonb_array_length(v_grid);
      if v_rows <> coalesce(v_guesses, 6) then
        raise exception 'Grid does not match score';
      end if;
      for i in 0 .. v_rows - 1 loop
        v_row := v_grid ->> i;
        if v_row is null or v_row !~ '^[gy.]{5}$' then
          raise exception 'Invalid grid row';
        end if;
        if (v_row = 'ggggg') <> (v_solved and i = v_rows - 1) then
          raise exception 'Grid does not match score';
        end if;
      end loop;
    else
      v_grid := null;
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'puzzle',  p_puzzle,
      'solved',  v_solved,
      'guesses', v_guesses,
      'hard',    coalesce((p_result ->> 'hard')::boolean, false),
      'grid',    v_grid
    ));
  end if;

  raise exception 'Unsupported game: %', p_game;
end $$;

create function public.is_supported_game(p_game text) returns boolean
language sql immutable as $$ select p_game in ('wordle') $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create function public.create_crew(p_name text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into crews (name, created_by) values (trim(p_name), auth.uid()) returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return c;
end $$;

-- Visiting a crew invite link joins the crew.
create function public.join_crew(p_code text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from crews where invite_code = lower(trim(p_code));
  if not found then raise exception 'Crew not found'; end if;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return c;
end $$;

-- Visiting a lobby invite link joins the lobby's crew.
create function public.join_lobby(p_code text) returns public.lobbies
language plpgsql security definer set search_path = public as $$
declare l lobbies;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into l from lobbies where invite_code = lower(trim(p_code));
  if not found then raise exception 'Lobby not found'; end if;
  insert into crew_members (crew_id, user_id) values (l.crew_id, auth.uid()) on conflict do nothing;
  return l;
end $$;

-- Returns the existing lobby if the crew already has one for this puzzle.
create function public.create_lobby(
  p_crew uuid,
  p_game text,
  p_puzzle text,
  p_closes_at timestamptz,
  p_hide_until_submitted boolean default true,
  p_allow_manual boolean default true
) returns public.lobbies
language plpgsql security definer set search_path = public as $$
declare l lobbies;
begin
  if not is_crew_member(p_crew) then raise exception 'Not a member of this crew'; end if;
  if not is_supported_game(p_game) then raise exception 'Unsupported game: %', p_game; end if;
  if p_puzzle !~ '^[0-9]{1,6}$' then raise exception 'Invalid puzzle number'; end if;
  if p_closes_at <= now() then raise exception 'Deadline must be in the future'; end if;

  select * into l from lobbies where crew_id = p_crew and game = p_game and puzzle_id = p_puzzle;
  if found then return l; end if;

  insert into lobbies (crew_id, game, puzzle_id, created_by, closes_at, hide_until_submitted, allow_manual)
  values (p_crew, p_game, p_puzzle, auth.uid(), p_closes_at, p_hide_until_submitted, p_allow_manual)
  returning * into l;
  return l;
end $$;

-- One shot per player per lobby; results are validated and normalized here.
create function public.submit_entry(p_lobby uuid, p_result jsonb, p_raw text, p_source text)
returns public.entries
language plpgsql security definer set search_path = public as $$
declare
  l lobbies;
  e entries;
begin
  select * into l from lobbies where id = p_lobby;
  if not found or not is_crew_member(l.crew_id) then raise exception 'Lobby not found'; end if;
  if lobby_closed(l) then raise exception 'This lobby is closed'; end if;
  if p_source not in ('paste', 'manual') then raise exception 'Invalid source'; end if;
  if p_source = 'manual' and not l.allow_manual then
    raise exception 'This lobby requires pasting your share text';
  end if;
  if exists (select 1 from entries where lobby_id = l.id and user_id = auth.uid()) then
    raise exception 'You already submitted a result for this lobby';
  end if;

  insert into entries (lobby_id, user_id, result, raw, source)
  values (l.id, auth.uid(), normalize_result(l.game, l.puzzle_id, p_result), left(p_raw, 2000), p_source)
  returning * into e;
  return e;
end $$;

-- Scoreboard with spoiler masking: hidden entries show who submitted, not what.
create function public.get_lobby_board(p_lobby uuid)
returns table (
  entry_id     uuid,
  user_id      uuid,
  display_name text,
  submitted_at timestamptz,
  source       text,
  result       jsonb,
  hidden       boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.user_id, p.display_name, e.submitted_at, e.source,
         case when can_see_entry(e.lobby_id, e.user_id) then e.result end,
         not can_see_entry(e.lobby_id, e.user_id)
  from entries e
  join profiles p on p.id = e.user_id
  join lobbies l on l.id = e.lobby_id
  where e.lobby_id = p_lobby and is_crew_member(l.crew_id)
  order by e.submitted_at
$$;

create function public.close_lobby(p_lobby uuid) returns public.lobbies
language plpgsql security definer set search_path = public as $$
declare l lobbies;
begin
  update lobbies set closed_at = now()
  where id = p_lobby and created_by = auth.uid() and closed_at is null
  returning * into l;
  if not found then raise exception 'Only the host can close an open lobby'; end if;
  return l;
end $$;

-- Host can void an entry (e.g. obvious cheating or a mistaken paste).
create function public.void_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from entries e
  using lobbies l
  where e.id = p_entry and l.id = e.lobby_id and l.created_by = auth.uid();
  if not found then raise exception 'Only the host can void entries'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Guests are signed in too (Supabase anonymous auth uses the `authenticated`
-- role), so nothing needs to be callable by `anon`.
revoke execute on function
  public.is_crew_member(uuid),
  public.lobby_closed(public.lobbies),
  public.can_see_entry(uuid, uuid),
  public.normalize_result(text, text, jsonb),
  public.is_supported_game(text),
  public.create_crew(text),
  public.join_crew(text),
  public.join_lobby(text),
  public.create_lobby(uuid, text, text, timestamptz, boolean, boolean),
  public.submit_entry(uuid, jsonb, text, text),
  public.get_lobby_board(uuid),
  public.close_lobby(uuid),
  public.void_entry(uuid)
from public, anon;

-- Helpers used inside RLS policies must be executable by the querying role.
grant execute on function
  public.is_crew_member(uuid),
  public.lobby_closed(public.lobbies),
  public.can_see_entry(uuid, uuid),
  public.create_crew(text),
  public.join_crew(text),
  public.join_lobby(text),
  public.create_lobby(uuid, text, text, timestamptz, boolean, boolean),
  public.submit_entry(uuid, jsonb, text, text),
  public.get_lobby_board(uuid),
  public.close_lobby(uuid),
  public.void_entry(uuid)
to authenticated;
