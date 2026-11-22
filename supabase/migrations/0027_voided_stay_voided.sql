-- A voided entry stays voided.
--
-- The extension keeps re-sending results it has seen (on every visit to the
-- game, and whenever the site asks it to sync), so a voided result used to
-- come straight back. Now voiding remembers the result, and that same result
-- isn't taken again for that day, from the extension or a paste. A different
-- result (the game played again) still goes in while the day is on.
--
-- Safe to run again.

create table if not exists public.voided_entries (
  round_id  uuid not null references public.rounds (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  result    jsonb not null,
  voided_at timestamptz not null default now()
);
create index if not exists voided_entries_round_user on public.voided_entries (round_id, user_id);

-- Only reachable through the RPCs below.
alter table public.voided_entries enable row level security;

create or replace function public.void_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e entries;
begin
  delete from entries x
  using rounds r, crews c
  where x.id = p_entry and r.id = x.round_id and c.id = r.crew_id and c.created_by = auth.uid()
  returning x.* into e;
  if e.id is null then raise exception 'Only the crew owner can void entries'; end if;
  insert into voided_entries (round_id, user_id, result) values (e.round_id, e.user_id, e.result);
end $$;

-- As in 0011, plus the 'voided' outcome.
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
  if exists (select 1 from voided_entries where round_id = r.id and user_id = p_user and result = v_result) then
    return 'voided';
  end if;
  insert into entries (round_id, user_id, result, raw, source)
  values (r.id, p_user, v_result, left(p_raw, 2000), p_source);
  return 'submitted';
end $$;

-- As in 0019, plus the 'voided' outcome.
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
    when 'voided'      then raise exception 'The crew owner voided this result. Play again to submit a new one';
    else null;
  end case;
end $$;
