-- The games your crews play, for the extension popup's Play tab: one row per
-- game, oldest-added first. Custom games bring their own name and link;
-- built-in games leave both null (the extension knows them).
--
-- Safe to run again.

drop function if exists public.extension_games(text);

create function public.extension_games(p_token text)
returns table (
  game      text,
  game_name text,
  url       text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_user uuid;
begin
  select t.user_id into v_user from extension_tokens t where t.token_hash = hash_token(p_token);
  if v_user is null then raise exception 'Extension is not connected to a Scrim account'; end if;

  return query
  select g.game, cg.name, cg.url
  from crew_games g
  join crew_members m on m.crew_id = g.crew_id and m.user_id = v_user
  left join custom_games cg on cg.crew_id = g.crew_id and 'custom:' || cg.id = g.game
  group by g.game, cg.name, cg.url
  order by min(g.added_at), g.game;
end $$;
revoke execute on function public.extension_games(text) from public, anon, authenticated;
grant execute on function public.extension_games(text) to anon, authenticated;

notify pgrst, 'reload schema';
