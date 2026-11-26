-- Worldle, Globle, Waffle (the daily) and Nerdle (classic).
--
-- Worldle: guess the country in six; ranked like Wordle. Numbered from #0 on
-- 2022-01-21 by local date. Results keep the share's closeness squares.
--
-- Globle: unlimited guesses, so everyone finishes; fewest wins. It has no
-- numbers, so Scrim numbers its days from 2022-01-01, by local date.
--
-- Waffle: 15 swaps, 0-5 left over as stars; most stars wins, running out is a
-- loss. One puzzle worldwide, #0 on 2022-01-21, changing at midnight UTC.
--
-- Nerdle: the eight-character equation in six; ranked like Wordle. One puzzle
-- worldwide, #1 on 2022-01-20, changing at midnight UTC. Results keep the
-- share's grid ("p" for purple).
--
-- Keep in sync with src/games/worldle.ts, globle.ts, waffle.ts and nerdle.ts.
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

  if p_game = 'contexto' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Contexto #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_solved := coalesce((p_result ->> 'solved')::boolean, false);
    v_guesses := (p_result ->> 'guesses')::int;
    if v_guesses is null or v_guesses not between 1 and 9999 then
      raise exception 'Guesses must be between 1 and 9,999';
    end if;
    v_hints := coalesce((p_result ->> 'hints')::int, 0);
    if v_hints not between 0 and least(999, v_guesses) then
      raise exception 'That many hints doesn''t fit the guesses';
    end if;

    v_grid := p_result -> 'chart';
    if v_grid is not null and jsonb_typeof(v_grid) <> 'null' then
      if jsonb_typeof(v_grid) <> 'array' or jsonb_array_length(v_grid) <> 3
         or exists (select 1 from jsonb_array_elements(v_grid) c
                    where jsonb_typeof(c) <> 'number' or (c #>> '{}')::numeric < 0
                       or (c #>> '{}')::numeric <> trunc((c #>> '{}')::numeric)) then
        raise exception 'Invalid bars';
      end if;
      if (v_grid ->> 0)::int + (v_grid ->> 1)::int + (v_grid ->> 2)::int > v_guesses then
        raise exception 'The bars don''t match the guesses';
      end if;
      if v_solved and (v_grid ->> 0)::int < 1 then
        raise exception 'A solved Contexto has the word itself in green';
      end if;
    else
      v_grid := null;
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'puzzle',  p_puzzle,
      'solved',  v_solved,
      'guesses', v_guesses,
      'hints',   v_hints,
      'chart',   v_grid
    ));
  end if;

  if p_game = 'costcodle' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Costcodle Checkout #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    -- The five misses are the source of truth: work the total out from them.
    v_grid := p_result -> 'offs';
    if jsonb_typeof(v_grid) is distinct from 'array' or jsonb_array_length(v_grid) <> 5 then
      raise exception 'A Checkout has 5 items';
    end if;
    if exists (select 1 from jsonb_array_elements(v_grid) c
               where jsonb_typeof(c) <> 'number' or (c #>> '{}')::numeric < 0
                  or (c #>> '{}')::numeric > 1000000000
                  or (c #>> '{}')::numeric <> trunc((c #>> '{}')::numeric)) then
      raise exception 'One of those amounts can''t be right';
    end if;

    return jsonb_build_object(
      'puzzle', p_puzzle,
      'offs',   v_grid,
      'total',  (select sum((c #>> '{}')::bigint) from jsonb_array_elements(v_grid) c)
    );
  end if;

  if p_game = 'poople' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Poople #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_guesses := (p_result ->> 'guesses')::int;
    if v_guesses is null or v_guesses not between 1 and 99 then
      raise exception 'Steps must be between 1 and 99';
    end if;
    v_points := (p_result ->> 'best')::int;
    if v_points is not null and v_points not between 1 and v_guesses then
      raise exception 'That can''t beat the shortest path';
    end if;

    v_grid := p_result -> 'grid';
    if v_grid is not null and jsonb_typeof(v_grid) <> 'null' then
      if jsonb_typeof(v_grid) <> 'array' then raise exception 'Invalid grid'; end if;
      v_rows := jsonb_array_length(v_grid);
      if v_rows <> v_guesses + 1 then raise exception 'The grid doesn''t match the steps'; end if;
      v_seen := null;
      for i in 0 .. v_rows - 1 loop
        v_row := v_grid ->> i;
        if v_row is null or v_row !~ '^[p.]{4}$' then raise exception 'Invalid grid row'; end if;
        if (v_row = 'pppp') <> (i = v_rows - 1) then raise exception 'A finished Poople ends at POOP'; end if;
        -- One letter changes per step, so at most one tile does.
        if v_seen is not null and (
             (substr(v_row, 1, 1) <> substr(v_seen, 1, 1))::int + (substr(v_row, 2, 1) <> substr(v_seen, 2, 1))::int
           + (substr(v_row, 3, 1) <> substr(v_seen, 3, 1))::int + (substr(v_row, 4, 1) <> substr(v_seen, 4, 1))::int > 1) then
          raise exception 'Each word changes only one letter';
        end if;
        v_seen := v_row;
      end loop;
    else
      v_grid := null;
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'puzzle',  p_puzzle,
      'guesses', v_guesses,
      'best',    v_points,
      'grid',    v_grid
    ));
  end if;

  if p_game = 'minicrossword' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Mini Crossword #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_points := (p_result ->> 'seconds')::int;
    if v_points is null or v_points not between 0 and 86400 then raise exception 'That time can''t be right'; end if;
    v_hints := coalesce((p_result ->> 'reveals')::int, 0);
    if v_hints not between 0 and 49 then raise exception 'Reveals must be between 0 and 49'; end if;

    return jsonb_build_object(
      'puzzle',  p_puzzle,
      'seconds', v_points,
      'reveals', v_hints
    );
  end if;

  if p_game = 'worldle' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Worldle #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_solved := coalesce((p_result ->> 'solved')::boolean, false);
    v_guesses := case when v_solved then (p_result ->> 'guesses')::int else null end;
    if v_solved and (v_guesses is null or v_guesses not between 1 and 6) then
      raise exception 'Guesses must be between 1 and 6';
    end if;

    -- Five squares per guess for how close it was: greens, then at most one
    -- yellow, then blanks. All green is the country itself.
    v_grid := p_result -> 'grid';
    if v_grid is not null and jsonb_typeof(v_grid) <> 'null' then
      if jsonb_typeof(v_grid) <> 'array' then raise exception 'Invalid grid'; end if;
      v_rows := jsonb_array_length(v_grid);
      if v_rows <> coalesce(v_guesses, 6) then raise exception 'Grid does not match score'; end if;
      for i in 0 .. v_rows - 1 loop
        v_row := v_grid ->> i;
        if v_row is null or v_row !~ '^g*y?\.*$' or length(v_row) <> 5 then
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
      'grid',    v_grid
    ));
  end if;

  if p_game = 'globle' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for another day''s Globle';
    end if;
    v_guesses := (p_result ->> 'guesses')::int;
    if v_guesses is null or v_guesses not between 1 and 199 then
      raise exception 'Guesses must be between 1 and 199';
    end if;
    return jsonb_build_object('puzzle', p_puzzle, 'guesses', v_guesses);
  end if;

  if p_game = 'waffle' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Waffle #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_solved := coalesce((p_result ->> 'solved')::boolean, false);
    v_points := case when v_solved then (p_result ->> 'stars')::int else null end;
    if v_solved and (v_points is null or v_points not between 0 and 5) then
      raise exception 'Stars must be between 0 and 5';
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'puzzle', p_puzzle,
      'solved', v_solved,
      'stars',  v_points
    ));
  end if;

  if p_game = 'nerdle' then
    if p_result ->> 'puzzle' is distinct from p_puzzle then
      raise exception 'That result is for Nerdle #%, but this lobby is for #%', p_result ->> 'puzzle', p_puzzle;
    end if;

    v_solved := coalesce((p_result ->> 'solved')::boolean, false);
    v_guesses := case when v_solved then (p_result ->> 'guesses')::int else null end;
    if v_solved and (v_guesses is null or v_guesses not between 1 and 6) then
      raise exception 'Guesses must be between 1 and 6';
    end if;

    v_grid := p_result -> 'grid';
    if v_grid is not null and jsonb_typeof(v_grid) <> 'null' then
      if jsonb_typeof(v_grid) <> 'array' then raise exception 'Invalid grid'; end if;
      v_rows := jsonb_array_length(v_grid);
      if v_rows <> coalesce(v_guesses, 6) then raise exception 'Grid does not match score'; end if;
      for i in 0 .. v_rows - 1 loop
        v_row := v_grid ->> i;
        if v_row is null or v_row !~ '^[gp.]{8}$' then raise exception 'Invalid grid row'; end if;
        if (v_row = 'gggggggg') <> (v_solved and i = v_rows - 1) then
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
      'grid',    v_grid
    ));
  end if;

  raise exception 'Unsupported game: %', p_game;
end $$;

create or replace function public.is_supported_game(p_game text) returns boolean
language sql immutable as $$ select p_game in ('wordle', 'connections', 'krillion', 'strands', 'contexto', 'costcodle', 'poople', 'minicrossword', 'worldle', 'globle', 'waffle', 'nerdle') $$;

create or replace function public.puzzle_date(p_game text, p_puzzle text) returns date
language sql immutable as $$
  select case
    when p_game = 'wordle'         then date '2021-06-19'
    when p_game = 'connections'    then date '2023-06-11'
    when p_game = 'strands'        then date '2024-03-03'
    when p_game = 'contexto'       then date '2022-09-18'
    when p_game = 'krillion'       then date '2026-07-15'
    when p_game = 'costcodle'      then date '2026-11-09'
    when p_game = 'poople'         then date '2025-08-14'
    when p_game = 'minicrossword'  then date '2026-06-21'
    when p_game = 'worldle'        then date '2022-01-21'
    when p_game = 'globle'         then date '2022-01-01'
    when p_game = 'waffle'         then date '2022-01-21'
    when p_game = 'nerdle'         then date '2022-01-19'
    when p_game like 'custom:%'    then date '2020-01-01'
  end + p_puzzle::int
$$;

-- As in 0036, plus Worldle and Globle by local date, and Waffle and Nerdle by UTC date.
create or replace function public.is_todays_puzzle(p_game text, p_puzzle text) returns boolean
language sql stable as $$
  select case
    when p_game = 'krillion' then
      p_puzzle::int = ((now() at time zone 'America/New_York')::date - date '2026-07-15')
    when p_game = 'poople' then
      p_puzzle::int = ((now() at time zone 'Etc/GMT+8')::date - date '2025-08-14')
    when p_game in ('waffle', 'nerdle') then
      puzzle_date(p_game, p_puzzle) = (now() at time zone 'UTC')::date
    when p_game in ('wordle', 'connections', 'strands', 'contexto', 'costcodle', 'minicrossword', 'worldle', 'globle')
      or p_game like 'custom:%' then
      puzzle_date(p_game, p_puzzle)
        between ((now() at time zone 'UTC') - interval '12 hours')::date
        and ((now() at time zone 'UTC') + interval '14 hours')::date
    else false
  end
$$;

-- As in 0038, plus the four new games.
create or replace function public.result_points(p_game text, p_result jsonb) returns numeric
language sql immutable as $$
  select case p_game
    when 'wordle' then
      case when coalesce((p_result ->> 'solved')::boolean, false) and p_result ->> 'guesses' is not null
        then (p_result ->> 'guesses')::numeric else 7 end
    -- 0–3 mistakes for solves; every loss ties at 4, below them.
    when 'connections' then
      case when coalesce((p_result ->> 'solved')::boolean, false)
        then (p_result ->> 'mistakes')::numeric else 4 end
    when 'strands' then (p_result ->> 'hints')::numeric
    -- Fewest guesses (hints don't count); giving up is last, all give-ups tied.
    when 'contexto' then
      case when coalesce((p_result ->> 'solved')::boolean, false)
        then (p_result ->> 'guesses')::numeric else 1000000 end
    when 'krillion' then -(p_result ->> 'points')::numeric
    -- Least off in total (cents).
    when 'costcodle' then (p_result ->> 'total')::numeric
    when 'poople' then (p_result ->> 'guesses')::numeric
    -- Fewest reveals, then fastest (a day is under 1,000,000 seconds).
    when 'minicrossword' then
      coalesce((p_result ->> 'reveals')::numeric, 0) * 1000000 + (p_result ->> 'seconds')::numeric
    -- Like Wordle: 1-6 guesses, 7 for a miss.
    when 'worldle' then
      case when coalesce((p_result ->> 'solved')::boolean, false) and p_result ->> 'guesses' is not null
        then (p_result ->> 'guesses')::numeric else 7 end
    when 'nerdle' then
      case when coalesce((p_result ->> 'solved')::boolean, false) and p_result ->> 'guesses' is not null
        then (p_result ->> 'guesses')::numeric else 7 end
    when 'globle' then (p_result ->> 'guesses')::numeric
    -- Most stars first (0 for five, 5 for none), then 6 for running out of swaps.
    when 'waffle' then
      case when coalesce((p_result ->> 'solved')::boolean, false)
        then 5 - coalesce((p_result ->> 'stars')::numeric, 0) else 6 end
  end
$$;

create or replace function public.result_can_win(p_game text, p_result jsonb) returns boolean
language sql immutable as $$
  select case p_game
    when 'krillion' then (p_result ->> 'points')::numeric > 0
    when 'strands' then true
    when 'costcodle' then true
    when 'poople' then true
    when 'minicrossword' then true
    when 'globle' then true
    else coalesce((p_result ->> 'solved')::boolean, false)
  end
$$;

-- Waffle's and Nerdle's days end at midnight UTC.
create or replace function public.round_closes_at(p_crew uuid, p_game text, p_puzzle text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select ((puzzle_date(p_game, p_puzzle) + 1)::timestamp)
         at time zone case
           when p_game = 'krillion' then 'America/New_York'
           when p_game = 'poople' then 'Etc/GMT+8'
           when p_game in ('waffle', 'nerdle') then 'UTC'
           else coalesce(c.timezone, 'UTC')
         end
  from crews c where c.id = p_crew
$$;

-- As in 0036, plus Worldle's and Nerdle's grids.
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
    -- A paste always has its grid (or Krillion's answers, Strands' dots, Contexto's bars or
    -- Costcodle's items), so a score can't be claimed without one. The Mini's, Globle's
    -- and Waffle's shares have none to check.
    if (p_game in ('wordle', 'connections', 'worldle', 'nerdle') and jsonb_typeof(p_result -> 'grid') is distinct from 'array')
       or (p_game = 'krillion' and nullif(p_result ->> 'tiers', '') is null)
       or (p_game = 'strands' and nullif(p_result ->> 'grid', '') is null)
       or (p_game = 'contexto' and jsonb_typeof(p_result -> 'chart') is distinct from 'array')
       or (p_game = 'costcodle' and jsonb_typeof(p_result -> 'offs') is distinct from 'array')
       or (p_game = 'poople' and jsonb_typeof(p_result -> 'grid') is distinct from 'array') then
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
