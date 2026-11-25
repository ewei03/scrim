-- More rules for crew owners:
--   * require_approval: opening the invite link asks to join; the owner
--     approves or declines in Manage crew.
--   * rank_by_win_rate: rankings go by win rate instead of total wins, so a
--     skipped day doesn't push you down. (Win rate, streak and average already
--     only count days you played.)
--
-- Safe to run again. (An earlier version also had an allow_paste rule; it's
-- gone, and running this again removes it.)

alter table public.crews drop column if exists allow_paste;
alter table public.crews add column if not exists require_approval boolean not null default false;
alter table public.crews add column if not exists rank_by_win_rate boolean not null default false;

-- ---------------------------------------------------------------------------
-- Join requests
-- ---------------------------------------------------------------------------

create table if not exists public.crew_join_requests (
  crew_id    uuid not null references public.crews (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Declined requests stay, so opening the link again doesn't ask again.
  declined   boolean not null default false,
  primary key (crew_id, user_id)
);

alter table public.crew_join_requests enable row level security;

-- The crew's owner sees its requests; you see your own.
drop policy if exists "owner or requester reads requests" on public.crew_join_requests;
create policy "owner or requester reads requests" on public.crew_join_requests
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from crews c where c.id = crew_id and c.created_by = auth.uid())
  );

grant select on public.crew_join_requests to authenticated;

-- Joining. With require_approval on, it files a request instead (returning the
-- crew, so the page can say who to wait for); the owner then lets you in. All
-- the other checks (bans, guests, the 10-player cap, names) apply when asking.
create or replace function public.join_crew(p_code text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c        crews;
  v_name   text;
  v_guest  boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from crews where invite_code = lower(trim(p_code));
  if not found then raise exception 'Crew not found'; end if;
  if exists (select 1 from crew_bans where crew_id = c.id and user_id = auth.uid()) then
    raise exception 'You were removed from this crew';
  end if;

  -- Already in it: opening the link again is fine.
  if exists (select 1 from crew_members where crew_id = c.id and user_id = auth.uid()) then
    return c;
  end if;

  select display_name, is_guest into v_name, v_guest from profiles where id = auth.uid();
  if v_guest and not c.allow_guests then
    raise exception 'This crew doesn''t take guests. Sign in with Google to join.';
  end if;
  -- Locked while counting, so two people can't both take the last place.
  perform 1 from crews where id = c.id for update;
  if (select count(*) from crew_members where crew_id = c.id) >= 10 then
    raise exception 'This crew is full (10 players max)';
  end if;
  if exists (
    select 1 from crew_members m
    join profiles p on p.id = m.user_id
    where m.crew_id = c.id and same_name(p.display_name, v_name)
  ) then
    raise exception 'Someone in this crew is already called %. Change your display name on your profile, then open the invite link again.', v_name;
  end if;

  if c.require_approval then
    if exists (select 1 from crew_join_requests where crew_id = c.id and user_id = auth.uid() and declined) then
      raise exception 'The owner of % didn''t approve your request to join.', c.name;
    end if;
    insert into crew_join_requests (crew_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
    return c;
  end if;

  insert into crew_members (crew_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  delete from crew_join_requests where crew_id = c.id and user_id = auth.uid();
  return c;
end $$;

-- Owner only: let someone in, or turn them down.
create or replace function public.answer_join_request(p_crew uuid, p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'Only the crew owner can answer join requests';
  end if;
  if not exists (select 1 from crew_join_requests where crew_id = p_crew and user_id = p_user and not declined) then
    raise exception 'No request to answer';
  end if;

  if not p_approve then
    update crew_join_requests set declined = true where crew_id = p_crew and user_id = p_user;
    return;
  end if;

  perform 1 from crews where id = p_crew for update;
  if (select count(*) from crew_members where crew_id = p_crew) >= 10 then
    raise exception 'This crew is full (10 players max)';
  end if;
  if exists (
    select 1 from crew_members m
    join profiles p on p.id = m.user_id
    where m.crew_id = p_crew and same_name(p.display_name, (select display_name from profiles where id = p_user))
  ) then
    raise exception 'Someone in this crew already has that name. They need to change theirs first.';
  end if;
  insert into crew_members (crew_id, user_id) values (p_crew, p_user) on conflict do nothing;
  delete from crew_join_requests where crew_id = p_crew and user_id = p_user;
end $$;

-- ---------------------------------------------------------------------------
-- Pasted results: as in 0011 (undoes the earlier allow_paste check)
-- ---------------------------------------------------------------------------

create or replace function public.submit_entry(p_crew uuid, p_game text, p_result jsonb, p_raw text, p_source text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_outcome text;
begin
  if not is_crew_member(p_crew) then raise exception 'Crew not found'; end if;

  if p_game like 'custom:%' then
    if p_source is distinct from 'manual' then raise exception 'Invalid source'; end if;
  else
    if p_source is distinct from 'paste' then raise exception 'Invalid source'; end if;
    if nullif(trim(p_raw), '') is null then raise exception 'Paste the game''s share text'; end if;
    -- A paste always has its grid (or Krillion's answers), so a score can't be
    -- claimed without one.
    if (p_game in ('wordle', 'connections') and jsonb_typeof(p_result -> 'grid') is distinct from 'array')
       or (p_game = 'krillion' and nullif(p_result ->> 'tiers', '') is null) then
      raise exception 'Paste the whole share text, including the coloured grid';
    end if;
  end if;

  v_outcome := record_entry(auth.uid(), p_crew, p_game, p_result, p_raw, p_source);
  case v_outcome
    when 'not-tracked' then raise exception 'This crew doesn''t play %', p_game;
    when 'closed'      then raise exception 'That puzzle''s day is over for this crew';
    when 'already'     then raise exception 'You already submitted a result for this puzzle';
    else null;
  end case;
end $$;

-- ---------------------------------------------------------------------------
-- Settings: the new switches
-- ---------------------------------------------------------------------------

drop function if exists public.update_crew_settings(uuid, text, boolean, text, boolean);
-- The earlier version of this file, with allow_paste.
drop function if exists public.update_crew_settings(uuid, text, boolean, text, boolean, boolean, boolean, boolean);

create or replace function public.update_crew_settings(
  p_crew uuid,
  p_timezone text default null,
  p_hide_until_submitted boolean default null,
  p_name text default null,
  p_allow_guests boolean default null,
  p_require_approval boolean default null,
  p_rank_by_win_rate boolean default null
) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c      crews;
  v_name text := trim(p_name);
begin
  if p_timezone is not null and not is_valid_timezone(p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone;
  end if;
  if p_name is not null and (v_name = '' or char_length(v_name) > 16) then
    raise exception 'Crew names are 1 to 16 characters';
  end if;
  update crews
  set timezone             = coalesce(p_timezone, timezone),
      hide_until_submitted = coalesce(p_hide_until_submitted, hide_until_submitted),
      name                 = coalesce(v_name, name),
      allow_guests         = coalesce(p_allow_guests, allow_guests),
      require_approval     = coalesce(p_require_approval, require_approval),
      rank_by_win_rate     = coalesce(p_rank_by_win_rate, rank_by_win_rate)
  where id = p_crew and created_by = auth.uid()
  returning * into c;
  if not found then raise exception 'Only the crew owner can change crew settings'; end if;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Extension rankings: in the crew's order (mirrors src/lib/stats.ts)
-- ---------------------------------------------------------------------------

-- Dropped first so this file runs again after 0039 changed the columns.
drop function if exists public.extension_rankings(text);

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

-- ---------------------------------------------------------------------------
-- Privileges (see 0017: new functions start private)
-- ---------------------------------------------------------------------------

revoke execute on function
  public.update_crew_settings(uuid, text, boolean, text, boolean, boolean, boolean),
  public.answer_join_request(uuid, uuid, boolean)
from public, anon, authenticated;

grant execute on function
  public.update_crew_settings(uuid, text, boolean, text, boolean, boolean, boolean),
  public.answer_join_request(uuid, uuid, boolean)
to authenticated;

revoke execute on function public.extension_rankings(text) from public, anon, authenticated;
grant execute on function public.extension_rankings(text) to anon, authenticated;

notify pgrst, 'reload schema';
