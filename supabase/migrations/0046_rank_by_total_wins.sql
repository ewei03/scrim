-- Rankings always go by total wins (then win rate, then days played), like
-- crewStats in src/lib/stats.ts. Removes 0019's crew setting to rank by win
-- rate instead ("Omit skipped days from rankings stats"): update_crew_settings
-- loses p_rank_by_win_rate, extension_rankings drops that ordering, and the
-- column goes. Skipped days still never count toward played, wins or win rate,
-- but they do end a streak (0044). Otherwise as in 0044 and 0045.
--
-- Safe to run again.

drop function if exists public.update_crew_settings(uuid, text, boolean, text, boolean, boolean, boolean);
drop function if exists public.update_crew_settings(uuid, text, boolean, text, boolean, boolean);

create function public.update_crew_settings(
  p_crew uuid,
  p_timezone text default null,
  p_hide_until_submitted boolean default null,
  p_name text default null,
  p_allow_guests boolean default null,
  p_require_approval boolean default null
) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c      crews;
  v_name text := trim(p_name);
begin
  if p_timezone is not null and not is_valid_timezone(p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone;
  end if;
  if p_name is not null and (v_name = '' or char_length(v_name) > 24) then
    raise exception 'Crew names are 1 to 24 characters';
  end if;
  if p_name is not null and v_name ~ '[\U0001F000-\U0001FAFF☀-➿⌚⌛⏩-⏺⬅-⬇⬛⬜⭐⭕️⃣\U000E0020-\U000E007F]' then
    raise exception 'Crew names can''t use emoji';
  end if;
  update crews
  set timezone             = coalesce(p_timezone, timezone),
      hide_until_submitted = coalesce(p_hide_until_submitted, hide_until_submitted),
      name                 = coalesce(v_name, name),
      allow_guests         = coalesce(p_allow_guests, allow_guests),
      require_approval     = coalesce(p_require_approval, require_approval)
  where id = p_crew and created_by = auth.uid()
  returning * into c;
  if not found then raise exception 'Only the crew owner can change crew settings'; end if;
  return c;
end $$;

revoke execute on function public.update_crew_settings(uuid, text, boolean, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.update_crew_settings(uuid, text, boolean, text, boolean, boolean) to authenticated;

drop function if exists public.extension_rankings(text);

create function public.extension_rankings(p_token text)
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
  streak       int,
  max_streak   int
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
           s.can_win and s.pts = min(s.pts) over (partition by s.round_id) as won
    from scored s
  ),
  days as (
    -- Every finished round, for every current member: won, lost or skipped.
    select r.crew_id, r.game, r.id as round_id, m.user_id,
           j.round_id is not null as played,
           coalesce(j.won, false) as won,
           row_number() over (partition by r.crew_id, r.game, m.user_id order by r.closes_at desc) as rn
    from rounds r
    join my_crews c on c.id = r.crew_id
    join crew_members m on m.crew_id = r.crew_id
    left join judged j on j.round_id = r.id and j.user_id = m.user_id
    where r.closes_at <= now()
      and (c.rankings_reset_at is null or r.closes_at > c.rankings_reset_at)
  ),
  runs as (
    -- Days in one unbroken run of wins (or not) share a run id.
    select d.*,
           d.rn - row_number() over (partition by d.crew_id, d.game, d.user_id, d.won order by d.rn) as run_id
    from days d
  ),
  run_lengths as (
    select r.crew_id, r.game, r.user_id, count(*)::int as len
    from runs r
    where r.won
    group by r.crew_id, r.game, r.user_id, r.run_id
  ),
  per_player as (
    select d.crew_id, d.game, d.user_id,
           (count(*) filter (where d.played))::int as played,
           (count(*) filter (where d.won))::int as wins,
           -- Wins in a row, counting back from the latest day; a skip ends it.
           coalesce(min(d.rn) filter (where not d.won) - 1, count(*))::int as streak,
           -- Longest run of wins in a row.
           coalesce((select max(l.len) from run_lengths l
                     where l.crew_id = d.crew_id and l.game = d.game and l.user_id = d.user_id), 0) as max_streak
    from days d
    group by d.crew_id, d.game, d.user_id
    having count(*) filter (where d.played) > 0
  )
  select c.invite_code, c.name, p.game, coalesce(cg.name, initcap(p.game)), p.user_id, pr.display_name,
         p.user_id = v_user, p.played, p.wins, p.streak, p.max_streak
  from per_player p
  join my_crews c on c.id = p.crew_id
  join profiles pr on pr.id = p.user_id
  left join custom_games cg on cg.crew_id = p.crew_id and 'custom:' || cg.id = p.game
  order by c.created_at, p.game,
           p.wins desc, p.wins::numeric / p.played desc, p.played desc;
end $$;
revoke execute on function public.extension_rankings(text) from public, anon, authenticated;
grant execute on function public.extension_rankings(text) to anon, authenticated;

alter table public.crews drop column if exists rank_by_win_rate;

notify pgrst, 'reload schema';
