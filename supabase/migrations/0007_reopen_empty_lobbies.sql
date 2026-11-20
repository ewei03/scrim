-- A crew has at most one lobby per game and puzzle, and create_lobby returns
-- the existing one. If that lobby was closed before anyone played (e.g. the
-- host closed it early), it was a dead end: closed, empty, hidden from the
-- archive, and blocking a new lobby. Now creating the lobby again reopens it
-- with the new settings. A closed lobby that has entries is a finished game
-- and is returned as-is.

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
  if found then
    if lobby_closed(l) and not exists (select 1 from entries where lobby_id = l.id) then
      update lobbies
      set closed_at = null,
          closes_at = p_closes_at,
          hide_until_submitted = p_hide_until_submitted,
          allow_manual = p_allow_manual,
          created_by = auth.uid()
      where id = l.id
      returning * into l;
    end if;
    return l;
  end if;

  insert into lobbies (crew_id, game, puzzle_id, created_by, closes_at, hide_until_submitted, allow_manual)
  values (p_crew, p_game, p_puzzle, auth.uid(), p_closes_at, p_hide_until_submitted, p_allow_manual)
  returning * into l;
  return l;
end $$;
