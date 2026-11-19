-- Lobbies can only be created for today's puzzle (archive puzzles may come later).
--
-- Wordle rolls over at each player's local midnight, so "today" depends on
-- timezone. Accept any puzzle that is today's somewhere on Earth: from the
-- date in UTC-12 to the date in UTC+14.

create function public.is_todays_puzzle(p_game text, p_puzzle text) returns boolean
language sql stable as $$
  select case p_game
    when 'wordle' then
      p_puzzle::int between
        (((now() at time zone 'UTC') - interval '12 hours')::date - date '2021-06-19')
        and (((now() at time zone 'UTC') + interval '14 hours')::date - date '2021-06-19')
    else false
  end
$$;

create or replace function public.create_lobby(
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
  if not is_todays_puzzle(p_game, p_puzzle) then
    raise exception 'Lobbies can only be created for today''s puzzle';
  end if;
  if p_closes_at <= now() then raise exception 'Deadline must be in the future'; end if;

  select * into l from lobbies where crew_id = p_crew and game = p_game and puzzle_id = p_puzzle;
  if found then return l; end if;

  insert into lobbies (crew_id, game, puzzle_id, created_by, closes_at, hide_until_submitted, allow_manual)
  values (p_crew, p_game, p_puzzle, auth.uid(), p_closes_at, p_hide_until_submitted, p_allow_manual)
  returning * into l;
  return l;
end $$;

revoke execute on function public.is_todays_puzzle(text, text) from public, anon;
