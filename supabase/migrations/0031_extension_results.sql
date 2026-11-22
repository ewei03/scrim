-- Today's results for the extension's popup, from the server.
--
-- The popup used to list only results this browser's copy of the extension
-- had seen, so a game played in one browser didn't show in another (or after
-- the extension was reinstalled). Now it asks for your entries instead.
--
-- The popup says which puzzle is "today" for each game (Wordle and
-- Connections go by the player's own date), and gets back one row per game:
-- the result and how many of your crews it's in. Crews you've left don't count.
--
-- Safe to run again.

create or replace function public.extension_results(p_token text, p_puzzles jsonb)
returns table (game text, puzzle text, result jsonb, crews int, submitted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_user uuid;
begin
  select t.user_id into v_user from extension_tokens t where t.token_hash = hash_token(p_token);
  if v_user is null then raise exception 'Extension is not connected to a Scrim account'; end if;
  if jsonb_typeof(p_puzzles) is distinct from 'object' then raise exception 'Invalid puzzles'; end if;

  return query
  select r.game, r.puzzle_id,
         -- The same result goes to every crew; the latest one if they differ.
         (array_agg(e.result order by e.submitted_at desc))[1],
         count(distinct r.crew_id)::int,
         max(e.submitted_at)
  from entries e
  join rounds r on r.id = e.round_id
  join crew_members m on m.crew_id = r.crew_id and m.user_id = v_user
  join jsonb_each_text(p_puzzles) p (game, puzzle) on p.game = r.game and p.puzzle = r.puzzle_id
  where e.user_id = v_user
  group by r.game, r.puzzle_id
  order by max(e.submitted_at) desc;
end $$;

-- See 0017: new functions start private. The extension calls this with the
-- anon key and its own token, like extension_rankings.
revoke execute on function public.extension_results(text, jsonb) from public, anon, authenticated;
grant execute on function public.extension_results(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
