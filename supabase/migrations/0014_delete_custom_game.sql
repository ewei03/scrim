-- The crew owner can delete a custom game, along with every score and day
-- played for it (its rounds, their entries, and the crew playing it). Unlike
-- turning a game off, this can't be undone: its history and rankings go too.

create function public.delete_custom_game(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g custom_games;
begin
  select cg.* into g from custom_games cg
  join crews c on c.id = cg.crew_id
  where cg.id = p_game and c.created_by = auth.uid();
  if not found then raise exception 'Only the crew owner can delete custom games'; end if;

  -- Entries go with their rounds (on delete cascade).
  delete from rounds where crew_id = g.crew_id and game = 'custom:' || g.id;
  delete from crew_games where crew_id = g.crew_id and game = 'custom:' || g.id;
  delete from custom_games where id = g.id;
end $$;

revoke execute on function public.delete_custom_game(uuid) from public, anon;
grant execute on function public.delete_custom_game(uuid) to authenticated;
