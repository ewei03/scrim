-- Removing a game from a crew throws away its day in progress.
--
-- Scores sent for a round that hasn't closed yet were never part of the
-- archive or the rankings. Before, the round stayed and closed at midnight as
-- usual, so its scores showed up once the game was added back. Now the
-- crew's open rounds for that game are deleted (their entries and voids go
-- with them, on delete cascade). Finished days stay.
--
-- Safe to run again.

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
    delete from rounds where crew_id = p_crew and game = p_game and closes_at > now();
  end if;
end $$;

notify pgrst, 'reload schema';
