-- No more lobbies. A crew picks the games it tracks, and each tracked game
-- gets one round per daily puzzle. Nobody creates a round: the first result
-- anyone in the crew submits for that puzzle starts it. A round closes at the
-- midnight that ends the puzzle's day in the crew's time zone (Krillion has a
-- single worldwide dive, so it always uses New York time).
--
-- Results come from the Chrome extension, or from pasting the game's share
-- text as a fallback; scores can't be typed in. Spoiler protection moves from
-- each lobby to the crew.
--
-- New crews take the creator's time zone. Existing crews start with none, and
-- the site fills in the owner's the next time they open the crew page (until
-- then, UTC).
--
-- Also here: rankings for the extension popup, and an optional contact email
-- on game suggestions.
--
-- This erases every lobby and entry.

-- ---------------------------------------------------------------------------
-- Out with the lobbies
-- ---------------------------------------------------------------------------

drop function public.extension_submit(text, text, jsonb, text);
drop function public.join_lobby(text);
drop function public.create_lobby(uuid, text, text, timestamptz, boolean, boolean);
drop function public.submit_entry(uuid, jsonb, text, text);
drop function public.get_lobby_board(uuid);
drop function public.close_lobby(uuid);
drop function public.void_entry(uuid);
drop function public.remove_crew_member(uuid, uuid);
drop function public.create_crew(text);

drop table public.entries; -- takes its RLS policy with it
drop function public.can_see_entry(uuid, uuid);
drop function public.lobby_closed(public.lobbies);
drop table public.lobbies;

-- ---------------------------------------------------------------------------
-- Crew settings and tracked games
-- ---------------------------------------------------------------------------

alter table public.crews
  add column timezone             text,
  add column hide_until_submitted boolean not null default true;

create table public.crew_games (
  crew_id  uuid not null references public.crews (id) on delete cascade,
  game     text not null,
  added_at timestamptz not null default now(),
  primary key (crew_id, game)
);

create table public.rounds (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null references public.crews (id) on delete cascade,
  game       text not null,
  puzzle_id  text not null,
  closes_at  timestamptz not null,
  created_at timestamptz not null default now(),
  unique (crew_id, game, puzzle_id)
);

create table public.entries (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references public.rounds (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  result       jsonb not null,
  raw          text,
  source       text not null check (source in ('paste', 'extension')),
  submitted_at timestamptz not null default now(),
  unique (round_id, user_id)
);

create index on public.rounds (crew_id, closes_at desc);
create index on public.entries (user_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.is_valid_timezone(p_zone text) returns boolean
language sql stable as $$ select exists (select 1 from pg_timezone_names where name = p_zone) $$;

-- The calendar date a puzzle belongs to (mirrors the epochs in src/games/*).
create function public.puzzle_date(p_game text, p_puzzle text) returns date
language sql immutable as $$
  select case p_game
    when 'wordle'      then date '2021-06-19'
    when 'connections' then date '2023-06-11'
    when 'krillion'    then date '2026-07-15'
  end + p_puzzle::int
$$;

-- Midnight at the end of the puzzle's day, in the crew's time zone.
create function public.round_closes_at(p_crew uuid, p_game text, p_puzzle text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select ((puzzle_date(p_game, p_puzzle) + 1)::timestamp)
         at time zone case when p_game = 'krillion' then 'America/New_York' else coalesce(c.timezone, 'UTC') end
  from crews c where c.id = p_crew
$$;

-- Spoiler protection: while a round is open and the crew hides scores, you
-- only see other players' results after submitting your own.
create function public.can_see_entry(p_round uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rounds r
    join crews c on c.id = r.crew_id
    where r.id = p_round
      and is_crew_member(r.crew_id)
      and (
        p_owner = auth.uid()
        or not c.hide_until_submitted
        or r.closes_at <= now()
        or exists (select 1 from entries e where e.round_id = r.id and e.user_id = auth.uid())
      )
  )
$$;

-- Adds one player's result to a crew's round for that puzzle, starting the
-- round if it's the first. Returns what happened instead of raising, so the
-- extension can report per crew: submitted, already, closed or not-tracked.
-- Invalid results still raise.
create function public.record_entry(
  p_user uuid, p_crew uuid, p_game text, p_result jsonb, p_raw text, p_source text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_puzzle text := p_result ->> 'puzzle';
  v_closes timestamptz;
  r        rounds;
begin
  if not is_supported_game(p_game) then raise exception 'Unsupported game: %', p_game; end if;
  if v_puzzle is null or v_puzzle !~ '^[0-9]{1,6}$' then raise exception 'Invalid puzzle number'; end if;

  if not exists (select 1 from crew_games where crew_id = p_crew and game = p_game) then
    return 'not-tracked';
  end if;
  if not is_todays_puzzle(p_game, v_puzzle) then return 'closed'; end if;

  -- A round that already exists keeps its deadline, even if the crew's time
  -- zone changed since it started.
  select * into r from rounds where crew_id = p_crew and game = p_game and puzzle_id = v_puzzle;
  if not found then
    v_closes := round_closes_at(p_crew, p_game, v_puzzle);
    if v_closes <= now() then return 'closed'; end if;
    insert into rounds (crew_id, game, puzzle_id, closes_at)
    values (p_crew, p_game, v_puzzle, v_closes)
    on conflict (crew_id, game, puzzle_id) do nothing;
    select * into r from rounds where crew_id = p_crew and game = p_game and puzzle_id = v_puzzle;
  end if;
  if r.closes_at <= now() then return 'closed'; end if;

  if exists (select 1 from entries where round_id = r.id and user_id = p_user) then return 'already'; end if;

  insert into entries (round_id, user_id, result, raw, source)
  values (r.id, p_user, normalize_result(p_game, v_puzzle, p_result), left(p_raw, 2000), p_source);
  return 'submitted';
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.crew_games enable row level security;
alter table public.rounds     enable row level security;
alter table public.entries    enable row level security;

create policy "members read crew games" on public.crew_games
  for select to authenticated using (is_crew_member(crew_id));
create policy "members read rounds" on public.rounds
  for select to authenticated using (is_crew_member(crew_id));
create policy "read visible entries" on public.entries
  for select to authenticated using (can_see_entry(round_id, user_id));

grant select on public.crew_games, public.rounds, public.entries to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create function public.create_crew(p_name text, p_timezone text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_timezone is null or not is_valid_timezone(p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone;
  end if;
  insert into crews (name, created_by, timezone) values (trim(p_name), auth.uid(), p_timezone) returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return c;
end $$;

-- Owner only: rename, time zone, spoilers. Settings left null stay as they
-- are. Changing the time zone
-- only affects rounds that haven't started yet.
create function public.update_crew_settings(
  p_crew uuid,
  p_timezone text default null,
  p_hide_until_submitted boolean default null,
  p_name text default null
) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c      crews;
  v_name text := trim(p_name);
begin
  if p_timezone is not null and not is_valid_timezone(p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone;
  end if;
  if p_name is not null and (v_name = '' or char_length(v_name) > 40) then
    raise exception 'Crew names are 1 to 40 characters';
  end if;
  update crews
  set timezone             = coalesce(p_timezone, timezone),
      hide_until_submitted = coalesce(p_hide_until_submitted, hide_until_submitted),
      name                 = coalesce(v_name, name)
  where id = p_crew and created_by = auth.uid()
  returning * into c;
  if not found then raise exception 'Only the crew owner can change crew settings'; end if;
  return c;
end $$;

-- Owner only. Untracking a game keeps its past rounds and rankings.
create function public.set_crew_game(p_crew uuid, p_game text, p_tracked boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'Only the crew owner can choose games';
  end if;
  if not is_supported_game(p_game) then raise exception 'Unsupported game: %', p_game; end if;
  if p_tracked then
    insert into crew_games (crew_id, game) values (p_crew, p_game) on conflict do nothing;
  else
    delete from crew_games where crew_id = p_crew and game = p_game;
  end if;
end $$;

-- Pasted share text from the site. The puzzle comes from the result.
create function public.submit_entry(p_crew uuid, p_game text, p_result jsonb, p_raw text, p_source text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_outcome text;
begin
  if not is_crew_member(p_crew) then raise exception 'Crew not found'; end if;
  if p_source is distinct from 'paste' then raise exception 'Invalid source'; end if;
  if nullif(trim(p_raw), '') is null then raise exception 'Paste the game''s share text'; end if;
  -- A paste always has its grid (or Krillion's answers), so a score can't be
  -- claimed without one. The site's parser checks the grid in detail;
  -- normalize_result checks it matches the score.
  if (p_game in ('wordle', 'connections') and jsonb_typeof(p_result -> 'grid') is distinct from 'array')
     or (p_game = 'krillion' and nullif(p_result ->> 'tiers', '') is null) then
    raise exception 'Paste the whole share text, including the coloured grid';
  end if;
  v_outcome := record_entry(auth.uid(), p_crew, p_game, p_result, p_raw, p_source);
  case v_outcome
    when 'not-tracked' then raise exception 'This crew doesn''t play %', p_game;
    when 'closed'      then raise exception 'That puzzle''s day is over for this crew';
    when 'already'     then raise exception 'You already submitted a result for this puzzle';
    else null;
  end case;
end $$;

-- Every crew you're in that plays this game gets the result.
create function public.extension_submit(p_token text, p_game text, p_result jsonb, p_raw text default null)
returns table (crew_code text, crew_name text, outcome text)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  c      crews;
begin
  select user_id into v_user from extension_tokens where token_hash = hash_token(p_token);
  if v_user is null then raise exception 'Extension is not connected to a Scrim account'; end if;
  update extension_tokens set last_used_at = now() where token_hash = hash_token(p_token);

  if not is_supported_game(p_game) then raise exception 'Unsupported game: %', p_game; end if;

  for c in
    select cr.* from crews cr
    join crew_members m on m.crew_id = cr.id and m.user_id = v_user
    join crew_games g on g.crew_id = cr.id and g.game = p_game
    order by cr.created_at
  loop
    crew_code := c.invite_code;
    crew_name := c.name;
    outcome := record_entry(v_user, c.id, p_game, p_result, p_raw, 'extension');
    return next;
  end loop;
end $$;

-- A crew's scoreboard for one puzzle (empty if nobody has played it yet),
-- with spoiler masking: hidden entries show who submitted, not what.
create function public.get_round_board(p_crew uuid, p_game text, p_puzzle text)
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
         case when can_see_entry(e.round_id, e.user_id) then e.result end,
         not can_see_entry(e.round_id, e.user_id)
  from rounds r
  join entries e on e.round_id = r.id
  join profiles p on p.id = e.user_id
  where r.crew_id = p_crew and r.game = p_game and r.puzzle_id = p_puzzle and is_crew_member(r.crew_id)
  order by e.submitted_at
$$;

-- Crew owner can void an entry (e.g. obvious cheating or a mistaken paste).
create function public.void_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from entries e
  using rounds r, crews c
  where e.id = p_entry and r.id = e.round_id and c.id = r.crew_id and c.created_by = auth.uid();
  if not found then raise exception 'Only the crew owner can void entries'; end if;
end $$;

-- Removes the member and their entries in open rounds. Results in finished
-- rounds stay in the history.
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
  using rounds r
  where e.round_id = r.id and r.crew_id = p_crew and e.user_id = p_user and r.closes_at > now();

  insert into crew_bans (crew_id, user_id) values (p_crew, p_user) on conflict do nothing;
end $$;

-- Members can leave a crew. The owner deletes it instead.
create function public.leave_crew(p_crew uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'The owner can''t leave. Delete the crew instead';
  end if;
  delete from crew_members where crew_id = p_crew and user_id = auth.uid();
  if not found then raise exception 'Not a member of this crew'; end if;
  delete from entries e
  using rounds r
  where e.round_id = r.id and r.crew_id = p_crew and e.user_id = auth.uid() and r.closes_at > now();
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.is_valid_timezone(text),
  public.puzzle_date(text, text),
  public.round_closes_at(uuid, text, text),
  public.can_see_entry(uuid, uuid),
  public.record_entry(uuid, uuid, text, jsonb, text, text),
  public.create_crew(text, text),
  public.update_crew_settings(uuid, text, boolean, text),
  public.set_crew_game(uuid, text, boolean),
  public.submit_entry(uuid, text, jsonb, text, text),
  public.extension_submit(text, text, jsonb, text),
  public.get_round_board(uuid, text, text),
  public.void_entry(uuid),
  public.remove_crew_member(uuid, uuid),
  public.leave_crew(uuid)
from public, anon;

-- can_see_entry is used in an RLS policy, so the querying role needs it.
grant execute on function
  public.can_see_entry(uuid, uuid),
  public.create_crew(text, text),
  public.update_crew_settings(uuid, text, boolean, text),
  public.set_crew_game(uuid, text, boolean),
  public.submit_entry(uuid, text, jsonb, text, text),
  public.get_round_board(uuid, text, text),
  public.void_entry(uuid),
  public.remove_crew_member(uuid, uuid),
  public.leave_crew(uuid)
to authenticated;

-- The extension calls with the publishable key only; the token is the auth.
grant execute on function public.extension_submit(text, text, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rankings for the extension popup, authorised by the extension's token.
--
-- The site ranks in src/lib/stats.ts with each game's compare() and
-- canWin(); result_points and result_can_win mirror those (lower points rank
-- higher). Keep them in sync when adding a game (a schema test checks).
-- ---------------------------------------------------------------------------

create function public.result_points(p_game text, p_result jsonb) returns numeric
language sql immutable as $$
  select case p_game
    when 'wordle' then
      case when coalesce((p_result ->> 'solved')::boolean, false) and p_result ->> 'guesses' is not null
        then (p_result ->> 'guesses')::numeric else 7 end
    when 'connections' then
      case when coalesce((p_result ->> 'solved')::boolean, false)
        then (p_result ->> 'mistakes')::numeric else 8 - (p_result ->> 'groups')::numeric end
    when 'krillion' then -(p_result ->> 'points')::numeric
  end
$$;

create function public.result_can_win(p_game text, p_result jsonb) returns boolean
language sql immutable as $$
  select case p_game
    when 'krillion' then (p_result ->> 'points')::numeric > 0
    else coalesce((p_result ->> 'solved')::boolean, false)
  end
$$;

-- One row per current member who has played, per crew and game, over
-- finished rounds. Ordered like the site: wins, then win rate, then played.
create function public.extension_rankings(p_token text)
returns table (
  crew_code    text,
  crew_name    text,
  game         text,
  user_id      uuid,
  display_name text,
  is_me        boolean,
  played       int,
  wins         int,
  streak       int
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_user uuid;
begin
  select t.user_id into v_user from extension_tokens t where t.token_hash = hash_token(p_token);
  if v_user is null then raise exception 'Extension is not connected to a Scrim account'; end if;

  return query
  with my_crews as (
    select c.* from crews c join crew_members m on m.crew_id = c.id and m.user_id = v_user
  ),
  scored as (
    select r.crew_id, r.game, r.id as round_id, r.closes_at, e.user_id,
           result_points(r.game, e.result) as pts,
           result_can_win(r.game, e.result) as can_win
    from rounds r
    join my_crews c on c.id = r.crew_id
    join entries e on e.round_id = r.id
    where r.closes_at <= now()
  ),
  judged as (
    -- Ties share the win, as long as the result can win at all.
    select s.*,
           s.can_win and s.pts = min(s.pts) over (partition by s.round_id) as won,
           row_number() over (partition by s.crew_id, s.game, s.user_id order by s.closes_at desc) as rn
    from scored s
  ),
  per_player as (
    select j.crew_id, j.game, j.user_id,
           count(*)::int as played,
           (count(*) filter (where j.won))::int as wins,
           -- Wins in a row, counting back from their latest round.
           coalesce(min(j.rn) filter (where not j.won) - 1, count(*))::int as streak
    from judged j
    join crew_members m on m.crew_id = j.crew_id and m.user_id = j.user_id
    group by j.crew_id, j.game, j.user_id
  )
  select c.invite_code, c.name, p.game, p.user_id, pr.display_name, p.user_id = v_user,
         p.played, p.wins, p.streak
  from per_player p
  join my_crews c on c.id = p.crew_id
  join profiles pr on pr.id = p.user_id
  order by c.created_at, p.game, p.wins desc, p.wins::numeric / p.played desc, p.played desc;
end $$;

revoke execute on function
  public.result_points(text, jsonb),
  public.result_can_win(text, jsonb),
  public.extension_rankings(text)
from public, anon;

-- The extension calls with the publishable key only; the token is the auth.
grant execute on function public.extension_rankings(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Game suggestions: optional contact email, so the owner can reply.
--
-- Not verified: it's only ever used to reply about that one suggestion, and
-- verifying would mean sending mail. The site pre-fills it with the Google
-- account's address (already verified by Google) when there is one. Like the
-- rest of game_suggestions, only the owner can read it, in the dashboard.
-- ---------------------------------------------------------------------------

alter table public.game_suggestions
  add column email text check (email is null or char_length(email) <= 254);

drop function public.suggest_game(text, text, text);

create function public.suggest_game(
  p_name text,
  p_url text default null,
  p_notes text default null,
  p_email text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := nullif(trim(p_name), '');
  v_url   text := nullif(trim(p_url), '');
  v_notes text := nullif(trim(p_notes), '');
  v_email text := lower(nullif(trim(p_email), ''));
begin
  if auth.uid() is null then raise exception 'Sign in to suggest a game'; end if;
  if v_name is null then raise exception 'Give the game a name'; end if;
  if char_length(v_name) > 80 then raise exception 'Name is too long (80 characters max)'; end if;
  if v_url is not null and (char_length(v_url) > 300 or v_url !~* '^https?://[^\s]+$') then
    raise exception 'Link must be a web address starting with http:// or https://';
  end if;
  if char_length(v_notes) > 1000 then raise exception 'Notes are too long (1000 characters max)'; end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'That email address doesn''t look right';
  end if;
  if exists (select 1 from game_suggestions
             where user_id = auth.uid() and created_at > now() - interval '1 hour') then
    raise exception 'You just sent a suggestion. Try again in an hour!';
  end if;
  if (select count(*) from game_suggestions
      where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s plenty of suggestions for today. Try again tomorrow!';
  end if;

  insert into game_suggestions (user_id, name, url, notes, email)
  values (auth.uid(), v_name, v_url, v_notes, v_email);
end $$;

revoke execute on function public.suggest_game(text, text, text, text) from public, anon;
grant execute on function public.suggest_game(text, text, text, text) to authenticated;
