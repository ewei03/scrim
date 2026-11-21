-- Custom games: daily games Scrim doesn't integrate, set up by a crew's owner.
--
-- Each belongs to one crew and is played under the id 'custom:<uuid>'. There
-- is no puzzle number, so a day's "puzzle" is the crew's calendar date, as days
-- since 2020-01-01. Scrim can't read these games, so scores are typed in by
-- hand (source 'manual'): an honour system. Built-in games still only take
-- pasted or extension results.
--
-- A score is { puzzle, value } or, if the game allows it, { puzzle, failed }
-- ("didn't finish"; can't win). How it's checked, shown and ranked comes from
-- the game's settings. Once anyone has entered a score, the scoring settings
-- are locked so past days stay comparable; name, link, instructions and colour
-- can always change.

create table public.custom_games (
  id               uuid primary key default gen_random_uuid(),
  crew_id          uuid not null references public.crews (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 40),
  url              text check (url is null or char_length(url) <= 300),
  instructions     text check (instructions is null or char_length(instructions) <= 200),
  color            text not null check (color ~ '^#[0-9a-f]{6}$'),
  -- points: a number; time: seconds; attempts: a whole number of tries.
  score_type       text not null check (score_type in ('points', 'time', 'attempts')),
  higher_is_better boolean not null,
  decimals         int not null default 0 check (decimals between 0 and 2),
  unit             text check (unit is null or char_length(unit) <= 12),
  time_format      text check (time_format is null or time_format in ('m:ss', 'h:mm:ss', 'm:ss.s')),
  max_attempts     int check (max_attempts is null or max_attempts between 1 and 100),
  allow_fail       boolean not null default false,
  created_at       timestamptz not null default now()
);

create index on public.custom_games (crew_id);

alter table public.custom_games enable row level security;
create policy "members read custom games" on public.custom_games
  for select to authenticated using (is_crew_member(crew_id));
grant select on public.custom_games to authenticated;

-- Hand-entered scores come back, for custom games only.
alter table public.entries drop constraint entries_source_check;
alter table public.entries add constraint entries_source_check check (source in ('paste', 'manual', 'extension'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The crew's custom game for an id like 'custom:<uuid>', if it has one.
create function public.crew_custom_game(p_crew uuid, p_game text) returns public.custom_games
language sql stable security definer set search_path = public as $$
  select g.* from custom_games g where g.crew_id = p_crew and 'custom:' || g.id = p_game
$$;

-- Built-in games, plus the crew's own custom games.
create function public.crew_can_play(p_crew uuid, p_game text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_supported_game(p_game) or (crew_custom_game(p_crew, p_game)).id is not null
$$;

create or replace function public.puzzle_date(p_game text, p_puzzle text) returns date
language sql immutable as $$
  select case
    when p_game = 'wordle'         then date '2021-06-19'
    when p_game = 'connections'    then date '2023-06-11'
    when p_game = 'krillion'       then date '2026-07-15'
    when p_game like 'custom:%'    then date '2020-01-01'
  end + p_puzzle::int
$$;

-- Wordle, Connections and custom games are numbered by local date, so accept
-- any day that is "today" somewhere on Earth (UTC-12 to UTC+14). Krillion has a
-- single worldwide dive by New York date.
create or replace function public.is_todays_puzzle(p_game text, p_puzzle text) returns boolean
language sql stable as $$
  select case
    when p_game = 'krillion' then
      p_puzzle::int = ((now() at time zone 'America/New_York')::date - date '2026-07-15')
    when p_game in ('wordle', 'connections') or p_game like 'custom:%' then
      puzzle_date(p_game, p_puzzle)
        between ((now() at time zone 'UTC') - interval '12 hours')::date
        and ((now() at time zone 'UTC') + interval '14 hours')::date
    else false
  end
$$;

-- Validates a custom game's settings (from the site's form) into a row.
create function public.custom_settings(p jsonb) returns public.custom_games
language plpgsql stable as $$
declare g custom_games;
begin
  g.name := nullif(trim(p ->> 'name'), '');
  if g.name is null or char_length(g.name) > 40 then
    raise exception 'Give the game a name (up to 40 characters)';
  end if;

  g.url := nullif(trim(p ->> 'url'), '');
  if g.url is not null and (char_length(g.url) > 300 or g.url !~* '^https?://[^\s]+$') then
    raise exception 'The link must be a web address starting with http:// or https://';
  end if;

  g.instructions := nullif(trim(p ->> 'instructions'), '');
  if char_length(g.instructions) > 200 then raise exception 'Instructions are too long (200 characters max)'; end if;

  g.color := lower(coalesce(p ->> 'color', ''));
  if g.color !~ '^#[0-9a-f]{6}$' then raise exception 'Pick a colour'; end if;

  g.score_type := p ->> 'score_type';
  if g.score_type is null or g.score_type not in ('points', 'time', 'attempts') then
    raise exception 'Pick a score type';
  end if;

  g.higher_is_better := coalesce((p ->> 'higher_is_better')::boolean, g.score_type = 'points');
  g.allow_fail := coalesce((p ->> 'allow_fail')::boolean, false);
  g.decimals := 0;

  if g.score_type = 'points' then
    g.decimals := coalesce((p ->> 'decimals')::int, 0);
    if g.decimals not between 0 and 2 then raise exception 'Decimals must be 0, 1 or 2'; end if;
    g.unit := nullif(trim(p ->> 'unit'), '');
    if char_length(g.unit) > 12 then raise exception 'The unit is too long (12 characters max)'; end if;
  elsif g.score_type = 'time' then
    g.time_format := coalesce(p ->> 'time_format', 'm:ss');
    if g.time_format not in ('m:ss', 'h:mm:ss', 'm:ss.s') then raise exception 'Pick a time format'; end if;
  else
    g.max_attempts := nullif(p ->> 'max_attempts', '')::int;
    if g.max_attempts is not null and g.max_attempts not between 1 and 100 then
      raise exception 'Max attempts must be between 1 and 100';
    end if;
  end if;
  return g;
end $$;

-- Checks and tidies a hand-entered score for a custom game.
-- Stable, not immutable: it raises on bad input, and Postgres may run
-- immutable functions early (even inside a CASE branch that isn't taken).
create function public.normalize_custom(g public.custom_games, p_puzzle text, p_result jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_value numeric;
  v_max   numeric;
begin
  if p_result ->> 'puzzle' is distinct from p_puzzle then raise exception 'That score is for a different day'; end if;

  if coalesce((p_result ->> 'failed')::boolean, false) then
    if not g.allow_fail then raise exception '% doesn''t take "didn''t finish" results', g.name; end if;
    return jsonb_build_object('puzzle', p_puzzle, 'failed', true);
  end if;

  begin
    v_value := (p_result ->> 'value')::numeric;
  exception when others then
    raise exception 'Enter a score';
  end;
  if v_value is null then raise exception 'Enter a score'; end if;

  if g.score_type = 'points' then
    if v_value not between -1000000000 and 1000000000 then raise exception 'That score is out of range'; end if;
    v_value := round(v_value, g.decimals);
  elsif g.score_type = 'time' then
    v_max := 359999; -- 99:59:59
    if v_value <= 0 or v_value > v_max then raise exception 'Enter a time between 0:01 and 99:59:59'; end if;
    v_value := round(v_value, case when g.time_format = 'm:ss.s' then 1 else 0 end);
  else
    v_max := coalesce(g.max_attempts, 1000);
    if v_value <> trunc(v_value) or v_value not between 1 and v_max then
      raise exception 'Attempts must be a whole number from 1 to %', v_max;
    end if;
  end if;
  return jsonb_build_object('puzzle', p_puzzle, 'failed', false, 'value', v_value);
end $$;

-- Lower ranks higher, like result_points. "Didn't finish" goes last.
create function public.custom_points(g public.custom_games, p_result jsonb) returns numeric
language sql immutable as $$
  select case
    when coalesce((p_result ->> 'failed')::boolean, false) then 1e18
    when g.higher_is_better then -(p_result ->> 'value')::numeric
    else (p_result ->> 'value')::numeric
  end
$$;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------

-- Creates a custom game and starts playing it in the crew straight away.
create function public.create_custom_game(p_crew uuid, p_settings jsonb) returns public.custom_games
language plpgsql security definer set search_path = public as $$
declare g custom_games;
begin
  if not exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'Only the crew owner can add custom games';
  end if;
  if (select count(*) from custom_games where crew_id = p_crew) >= 10 then
    raise exception 'A crew can have up to 10 custom games';
  end if;

  g := custom_settings(p_settings);
  insert into custom_games (
    crew_id, name, url, instructions, color, score_type, higher_is_better,
    decimals, unit, time_format, max_attempts, allow_fail
  ) values (
    p_crew, g.name, g.url, g.instructions, g.color, g.score_type, g.higher_is_better,
    g.decimals, g.unit, g.time_format, g.max_attempts, g.allow_fail
  ) returning * into g;

  insert into crew_games (crew_id, game) values (p_crew, 'custom:' || g.id);
  return g;
end $$;

-- Edits a custom game. Scoring is locked once anyone has entered a score.
create function public.update_custom_game(p_game uuid, p_settings jsonb) returns public.custom_games
language plpgsql security definer set search_path = public as $$
declare
  old custom_games;
  g   custom_games;
begin
  select cg.* into old from custom_games cg
  join crews c on c.id = cg.crew_id
  where cg.id = p_game and c.created_by = auth.uid();
  if not found then raise exception 'Only the crew owner can edit custom games'; end if;

  g := custom_settings(p_settings);
  if (g.score_type, g.higher_is_better, g.decimals, g.time_format, g.max_attempts, g.allow_fail)
       is distinct from
     (old.score_type, old.higher_is_better, old.decimals, old.time_format, old.max_attempts, old.allow_fail)
     and exists (
       select 1 from rounds r join entries e on e.round_id = r.id
       where r.crew_id = old.crew_id and r.game = 'custom:' || old.id
     ) then
    raise exception 'Scoring can''t change once someone has entered a score. You can still change the name, link, instructions and colour.';
  end if;

  update custom_games
  set name = g.name, url = g.url, instructions = g.instructions, color = g.color, unit = g.unit,
      score_type = g.score_type, higher_is_better = g.higher_is_better, decimals = g.decimals,
      time_format = g.time_format, max_attempts = g.max_attempts, allow_fail = g.allow_fail
  where id = p_game
  returning * into g;
  return g;
end $$;

-- ---------------------------------------------------------------------------
-- Existing RPCs, now aware of custom games
-- ---------------------------------------------------------------------------

create or replace function public.set_crew_game(p_crew uuid, p_game text, p_tracked boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'Only the crew owner can choose games';
  end if;
  if not crew_can_play(p_crew, p_game) then raise exception 'Unsupported game: %', p_game; end if;
  if p_tracked then
    insert into crew_games (crew_id, game) values (p_crew, p_game) on conflict do nothing;
  else
    delete from crew_games where crew_id = p_crew and game = p_game;
  end if;
end $$;

create or replace function public.record_entry(
  p_user uuid, p_crew uuid, p_game text, p_result jsonb, p_raw text, p_source text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_puzzle text := p_result ->> 'puzzle';
  v_closes timestamptz;
  v_custom custom_games;
  v_result jsonb;
  r        rounds;
begin
  v_custom := crew_custom_game(p_crew, p_game);
  if not is_supported_game(p_game) and v_custom.id is null then
    raise exception 'Unsupported game: %', p_game;
  end if;
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

  if v_custom.id is not null then
    v_result := normalize_custom(v_custom, v_puzzle, p_result);
  else
    v_result := normalize_result(p_game, v_puzzle, p_result);
  end if;
  insert into entries (round_id, user_id, result, raw, source)
  values (r.id, p_user, v_result, left(p_raw, 2000), p_source);
  return 'submitted';
end $$;

-- From the site: pasted share text for built-in games, a typed-in score for
-- custom games.
create or replace function public.submit_entry(p_crew uuid, p_game text, p_result jsonb, p_raw text, p_source text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_outcome text;
begin
  if not is_crew_member(p_crew) then raise exception 'Crew not found'; end if;

  if p_game like 'custom:%' then
    if p_source is distinct from 'manual' then raise exception 'Invalid source'; end if;
  else
    if p_source is distinct from 'paste' then raise exception 'Invalid source'; end if;
    if nullif(trim(p_raw), '') is null then raise exception 'Paste the game''s share text'; end if;
    -- A paste always has its grid (or Krillion's answers), so a score can't be
    -- claimed without one.
    if (p_game in ('wordle', 'connections') and jsonb_typeof(p_result -> 'grid') is distinct from 'array')
       or (p_game = 'krillion' and nullif(p_result ->> 'tiers', '') is null) then
      raise exception 'Paste the whole share text, including the coloured grid';
    end if;
  end if;

  v_outcome := record_entry(auth.uid(), p_crew, p_game, p_result, p_raw, p_source);
  case v_outcome
    when 'not-tracked' then raise exception 'This crew doesn''t play %', p_game;
    when 'closed'      then raise exception 'That puzzle''s day is over for this crew';
    when 'already'     then raise exception 'You already submitted a result for this puzzle';
    else null;
  end case;
end $$;

-- Rankings for the extension popup, now with custom games and each game's
-- display name.
drop function public.extension_rankings(text);

create function public.extension_rankings(p_token text)
returns table (
  crew_code    text,
  crew_name    text,
  game         text,
  game_name    text,
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
           case when cg.id is not null then custom_points(cg, e.result)
                else result_points(r.game, e.result) end as pts,
           case when cg.id is not null then not coalesce((e.result ->> 'failed')::boolean, false)
                else result_can_win(r.game, e.result) end as can_win
    from rounds r
    join my_crews c on c.id = r.crew_id
    join entries e on e.round_id = r.id
    left join custom_games cg on cg.crew_id = r.crew_id and 'custom:' || cg.id = r.game
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
  select c.invite_code, c.name, p.game, coalesce(cg.name, initcap(p.game)), p.user_id, pr.display_name,
         p.user_id = v_user, p.played, p.wins, p.streak
  from per_player p
  join my_crews c on c.id = p.crew_id
  join profiles pr on pr.id = p.user_id
  left join custom_games cg on cg.crew_id = p.crew_id and 'custom:' || cg.id = p.game
  order by c.created_at, p.game, p.wins desc, p.wins::numeric / p.played desc, p.played desc;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.crew_custom_game(uuid, text),
  public.crew_can_play(uuid, text),
  public.custom_settings(jsonb),
  public.normalize_custom(public.custom_games, text, jsonb),
  public.custom_points(public.custom_games, jsonb),
  public.create_custom_game(uuid, jsonb),
  public.update_custom_game(uuid, jsonb),
  public.extension_rankings(text)
from public, anon;

grant execute on function
  public.create_custom_game(uuid, jsonb),
  public.update_custom_game(uuid, jsonb)
to authenticated;

grant execute on function public.extension_rankings(text) to anon, authenticated;
