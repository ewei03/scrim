-- The crew owner can reset the rankings.
--
-- Resetting doesn't delete anything: the crew remembers when it happened, and
-- rankings (the site's and the extension's) count only days that end after
-- that. The archive keeps every day. There's no way to undo it from the site.
--
-- Safe to run again.

alter table public.crews add column if not exists rankings_reset_at timestamptz;

create or replace function public.reset_rankings(p_crew uuid) returns public.crews
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if not exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'Only the crew owner can reset the rankings';
  end if;
  update crews set rankings_reset_at = now() where id = p_crew returning * into c;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Extension rankings: as in 0019, from the last reset on (mirrors CrewView)
-- ---------------------------------------------------------------------------

create or replace function public.extension_rankings(p_token text)
returns table (
  crew_code    text,
  crew_name    text,
  game         text,
  game_name    text,
  user_id      uuid,
  display_name text,
  is_me        boolean,
  played       int,
  wins         int,
  streak       int
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_user uuid;
begin
  select t.user_id into v_user from extension_tokens t where t.token_hash = hash_token(p_token);
  if v_user is null then raise exception 'Extension is not connected to a Scrim account'; end if;

  return query
  with my_crews as (
    select c.* from crews c join crew_members m on m.crew_id = c.id and m.user_id = v_user
  ),
  scored as (
    select r.crew_id, r.game, r.id as round_id, r.closes_at, e.user_id,
           case when cg.id is not null then custom_points(cg, e.result)
                else result_points(r.game, e.result) end as pts,
           case when cg.id is not null then not coalesce((e.result ->> 'failed')::boolean, false)
                else result_can_win(r.game, e.result) end as can_win
    from rounds r
    join my_crews c on c.id = r.crew_id
    join entries e on e.round_id = r.id
    left join custom_games cg on cg.crew_id = r.crew_id and 'custom:' || cg.id = r.game
    where r.closes_at <= now()
      -- Only days after the owner last reset the rankings.
      and (c.rankings_reset_at is null or r.closes_at > c.rankings_reset_at)
  ),
  judged as (
    -- Ties share the win, as long as the result can win at all.
    select s.*,
           s.can_win and s.pts = min(s.pts) over (partition by s.round_id) as won,
           row_number() over (partition by s.crew_id, s.game, s.user_id order by s.closes_at desc) as rn
    from scored s
  ),
  per_player as (
    select j.crew_id, j.game, j.user_id,
           count(*)::int as played,
           (count(*) filter (where j.won))::int as wins,
           -- Wins in a row, counting back from their latest round.
           coalesce(min(j.rn) filter (where not j.won) - 1, count(*))::int as streak
    from judged j
    join crew_members m on m.crew_id = j.crew_id and m.user_id = j.user_id
    group by j.crew_id, j.game, j.user_id
  )
  select c.invite_code, c.name, p.game, coalesce(cg.name, initcap(p.game)), p.user_id, pr.display_name,
         p.user_id = v_user, p.played, p.wins, p.streak
  from per_player p
  join my_crews c on c.id = p.crew_id
  join profiles pr on pr.id = p.user_id
  left join custom_games cg on cg.crew_id = p.crew_id and 'custom:' || cg.id = p.game
  order by c.created_at, p.game,
           -- Ranked by win rate: a skipped day doesn't count against you.
           case when c.rank_by_win_rate then p.wins::numeric / p.played end desc nulls last,
           p.wins desc, p.wins::numeric / p.played desc, p.played desc;
end $$;

-- See 0017: new functions start private.
revoke execute on function public.reset_rankings(uuid) from public, anon, authenticated;
grant execute on function public.reset_rankings(uuid) to authenticated;

notify pgrst, 'reload schema';
