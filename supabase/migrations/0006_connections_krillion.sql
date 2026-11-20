-- Connections and Krillion.
--
-- Connections (NYT): numbered from #1 on 2023-06-12, resets at local
-- midnight like Wordle. Scored by mistakes (0-3 to solve, 4 and you're out).
--
-- Krillion (krillion.io): one Daily Dive worldwide, numbered from #1 on
-- 2026-07-16 and reset at midnight New York time. Seven prompts, each worth
-- 0-100 points by rarity. Keep the tier points in sync with src/games/krillion.ts.

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

  raise exception 'Unsupported game: %', p_game;
end $$;

create or replace function public.is_supported_game(p_game text) returns boolean
language sql immutable as $$ select p_game in ('wordle', 'connections', 'krillion') $$;

-- Wordle and Connections roll over at each player's local midnight, so accept
-- any puzzle that is today's somewhere on Earth (UTC-12 to UTC+14). Krillion
-- has a single worldwide dive by New York date.
create or replace function public.is_todays_puzzle(p_game text, p_puzzle text) returns boolean
language sql stable as $$
  select case p_game
    when 'wordle' then
      p_puzzle::int between
        (((now() at time zone 'UTC') - interval '12 hours')::date - date '2021-06-19')
        and (((now() at time zone 'UTC') + interval '14 hours')::date - date '2021-06-19')
    when 'connections' then
      p_puzzle::int between
        (((now() at time zone 'UTC') - interval '12 hours')::date - date '2023-06-11')
        and (((now() at time zone 'UTC') + interval '14 hours')::date - date '2023-06-11')
    when 'krillion' then
      p_puzzle::int = ((now() at time zone 'America/New_York')::date - date '2026-07-15')
    else false
  end
$$;
