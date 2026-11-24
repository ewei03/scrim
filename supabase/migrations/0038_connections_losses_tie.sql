-- Every Connections loss (DNF) ties for last.
--
-- Losses used to rank among themselves by groups found (8 - groups), so
-- finding two groups beat finding none. Now a loss is a loss: they all tie,
-- below every solve, like Wordle's X/6 and Contexto's give-ups. Mirrors
-- compare() in src/games/connections.ts. Otherwise as in 0036.
--
-- Safe to run again.

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
  end
$$;

notify pgrst, 'reload schema';
