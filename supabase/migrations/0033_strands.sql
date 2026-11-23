-- Strands (NYT).
--
-- Numbered from #1 on 2024-03-04 and resets at local midnight, like Wordle
-- and Connections. Scored by hints used (fewer is better); it can't be lost,
-- so every result can win. Results keep the share's emoji as a string: b for
-- a theme word, s for the spangram, h for a hint. Keep in sync with
-- src/games/strands.ts.
--
-- Safe to run again.

create or replace function public.normalize_result(p_game text, p_puzzle text, p_result jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_solved   boolean;
  v_guesses  int;
  v_grid     jsonb;
  v_rows     int;
  v_row      text;
  i          int;
  v_groups   int;
  v_mistakes int;
  v_seen     text;
  v_tiers    text;
  v_points   int;
  v_hints    int;
  v_words    int;
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

  if p_game = 'connections' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Connections #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_grid := p_result -> 'grid';
    if v_grid is not null and jsonb_typeof(v_grid) <> 'null' then
      -- The grid is the source of truth: work the score out from it.
      if jsonb_typeof(v_grid) <> 'array' then raise exception 'Invalid grid'; end if;
      v_rows := jsonb_array_length(v_grid);
      if v_rows not between 1 and 7 then raise exception 'Invalid grid'; end if;
      v_groups := 0;
      v_mistakes := 0;
      v_seen := '';
      for i in 0 .. v_rows - 1 loop
        v_row := v_grid ->> i;
        if v_row is null or v_row !~ '^[ygbp]{4}$' then raise exception 'Invalid grid row'; end if;
        if v_row = repeat(left(v_row, 1), 4) then
          if position(left(v_row, 1) in v_seen) > 0 then raise exception 'Grid does not match score'; end if;
          v_seen := v_seen || left(v_row, 1);
          v_groups := v_groups + 1;
        else
          v_mistakes := v_mistakes + 1;
        end if;
      end loop;
      v_solved := v_groups = 4;
      v_row := v_grid ->> (v_rows - 1);
      if v_solved and (v_mistakes > 3 or v_row <> repeat(left(v_row, 1), 4)) then
        raise exception 'Grid does not match score';
      end if;
      if not v_solved and (v_mistakes <> 4 or v_row = repeat(left(v_row, 1), 4)) then
        raise exception 'Grid is not a finished game';
      end if;
    else
      v_grid := null;
      v_solved := coalesce((p_result ->> 'solved')::boolean, false);
      if v_solved then
        v_mistakes := (p_result ->> 'mistakes')::int;
        if v_mistakes is null or v_mistakes not between 0 and 3 then
          raise exception 'Mistakes must be between 0 and 3';
        end if;
        v_groups := 4;
      else
        v_mistakes := 4;
        v_groups := coalesce((p_result ->> 'groups')::int, 0);
        if v_groups not between 0 and 3 then raise exception 'Groups must be between 0 and 3'; end if;
      end if;
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'puzzle',   p_puzzle,
      'solved',   v_solved,
      'mistakes', v_mistakes,
      'groups',   v_groups,
      'grid',     v_grid
    ));
  end if;

  if p_game = 'krillion' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Krillion #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_tiers := p_result ->> 'tiers';
    if v_tiers is not null then
      -- The tiers are the source of truth: work the points out from them.
      if v_tiers !~ '^[xpcsrdk]{7}$' then raise exception 'Invalid answers'; end if;
      v_points := 0;
      for i in 1 .. 7 loop
        v_points := v_points + case substr(v_tiers, i, 1)
          when 'p' then 10 when 'c' then 15 when 's' then 30
          when 'r' then 60 when 'd' then 85 when 'k' then 100 else 0 end;
      end loop;
    else
      v_points := (p_result ->> 'points')::int;
      if v_points is null or v_points not between 0 and 700 or v_points % 5 <> 0 then
        raise exception 'Score must be between 0 and 7,000 m';
      end if;
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'puzzle', p_puzzle,
      'points', v_points,
      'tiers',  v_tiers
    ));
  end if;

  if p_game = 'strands' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Strands #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_tiers := p_result ->> 'grid';
    if v_tiers is not null then
      -- The share's emoji are the source of truth: work the score out from them.
      -- b = theme word, s = spangram, h = hint (see src/games/strands.ts).
      if v_tiers !~ '^[bsh]{1,40}$' then raise exception 'Invalid result'; end if;
      if char_length(v_tiers) - char_length(replace(v_tiers, 's', '')) <> 1 then
        raise exception 'A finished Strands has exactly one spangram';
      end if;
      v_hints := char_length(v_tiers) - char_length(replace(v_tiers, 'h', ''));
      v_words := char_length(v_tiers) - v_hints;
      if v_words < 2 then raise exception 'That isn''t a finished game'; end if;
      return jsonb_build_object(
        'puzzle',   p_puzzle,
        'hints',    v_hints,
        'words',    v_words,
        'spangram', position('s' in replace(v_tiers, 'h', '')),
        'grid',     v_tiers
      );
    end if;

    v_hints := (p_result ->> 'hints')::int;
    if v_hints is null or v_hints not between 0 and 40 then raise exception 'Hints must be between 0 and 40'; end if;
    v_words := coalesce((p_result ->> 'words')::int, 8);
    if v_words not between 2 and 40 then raise exception 'Invalid result'; end if;
    return jsonb_build_object(
      'puzzle',   p_puzzle,
      'hints',    v_hints,
      'words',    v_words,
      'spangram', least(greatest(coalesce((p_result ->> 'spangram')::int, 1), 1), v_words)
    );
  end if;

  raise exception 'Unsupported game: %', p_game;
end $$;

create or replace function public.is_supported_game(p_game text) returns boolean
language sql immutable as $$ select p_game in ('wordle', 'connections', 'krillion', 'strands') $$;

create or replace function public.puzzle_date(p_game text, p_puzzle text) returns date
language sql immutable as $$
  select case
    when p_game = 'wordle'         then date '2021-06-19'
    when p_game = 'connections'    then date '2023-06-11'
    when p_game = 'strands'        then date '2024-03-03'
    when p_game = 'krillion'       then date '2026-07-15'
    when p_game like 'custom:%'    then date '2020-01-01'
  end + p_puzzle::int
$$;

-- Wordle, Connections, Strands and custom games are numbered by local date, so
-- accept any day that is "today" somewhere on Earth (UTC-12 to UTC+14).
-- Krillion has a single worldwide dive by New York date.
create or replace function public.is_todays_puzzle(p_game text, p_puzzle text) returns boolean
language sql stable as $$
  select case
    when p_game = 'krillion' then
      p_puzzle::int = ((now() at time zone 'America/New_York')::date - date '2026-07-15')
    when p_game in ('wordle', 'connections', 'strands') or p_game like 'custom:%' then
      puzzle_date(p_game, p_puzzle)
        between ((now() at time zone 'UTC') - interval '12 hours')::date
        and ((now() at time zone 'UTC') + interval '14 hours')::date
    else false
  end
$$;

-- Mirrors each game's compare() and canWin() (lower points rank higher).
create or replace function public.result_points(p_game text, p_result jsonb) returns numeric
language sql immutable as $$
  select case p_game
    when 'wordle' then
      case when coalesce((p_result ->> 'solved')::boolean, false) and p_result ->> 'guesses' is not null
        then (p_result ->> 'guesses')::numeric else 7 end
    when 'connections' then
      case when coalesce((p_result ->> 'solved')::boolean, false)
        then (p_result ->> 'mistakes')::numeric else 8 - (p_result ->> 'groups')::numeric end
    when 'strands' then (p_result ->> 'hints')::numeric
    when 'krillion' then -(p_result ->> 'points')::numeric
  end
$$;

create or replace function public.result_can_win(p_game text, p_result jsonb) returns boolean
language sql immutable as $$
  select case p_game
    when 'krillion' then (p_result ->> 'points')::numeric > 0
    when 'strands' then true
    else coalesce((p_result ->> 'solved')::boolean, false)
  end
$$;

-- As in 0027, plus Strands: a paste needs its dots.
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
    -- A paste always has its grid (or Krillion's answers, or Strands' dots), so a score can't be
    -- claimed without one.
    if (p_game in ('wordle', 'connections') and jsonb_typeof(p_result -> 'grid') is distinct from 'array')
       or (p_game = 'krillion' and nullif(p_result ->> 'tiers', '') is null)
       or (p_game = 'strands' and nullif(p_result ->> 'grid', '') is null) then
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

notify pgrst, 'reload schema';
