-- Guests now leave a crew when the day they joined ends (midnight in the
-- crew's time zone), rather than 24 hours after joining. Their scores stay:
-- past days, winners and rankings still include them, marked as guests.
--
-- get_round_board also returns is_guest, so the site can mark guests on the
-- scoreboard.

-- Removes guests whose joining day has ended in the crew's time zone.
-- Owners are never removed (the crew would be left without one). Returns how
-- many memberships it removed.
create or replace function public.remove_expired_guests() returns int
language plpgsql security definer set search_path = public as $$
declare v_removed int;
begin
  delete from crew_members m
  using profiles p, crews c
  where p.id = m.user_id
    and c.id = m.crew_id
    and p.is_guest
    and c.created_by <> m.user_id
    and (now() at time zone coalesce(c.timezone, 'UTC'))::date
      > (m.joined_at at time zone coalesce(c.timezone, 'UTC'))::date;
  get diagnostics v_removed = row_count;
  return v_removed;
end $$;

revoke execute on function public.remove_expired_guests() from public, anon, authenticated;

-- Run it every 5 minutes, so guests leave soon after midnight in every time
-- zone (some are offset by half or quarter hours). Scheduling under the same
-- name replaces the hourly job from 0012. Needs pg_cron (see 0012).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('scrim-remove-expired-guests', '*/5 * * * *', 'select public.remove_expired_guests()');
  end if;
end $$;

-- The scoreboard, now with is_guest. Its return type changes, so it's dropped
-- and recreated.
drop function if exists public.get_round_board(uuid, text, text);

create function public.get_round_board(p_crew uuid, p_game text, p_puzzle text)
returns table (
  entry_id     uuid,
  user_id      uuid,
  display_name text,
  is_guest     boolean,
  submitted_at timestamptz,
  source       text,
  result       jsonb,
  hidden       boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.user_id, p.display_name, p.is_guest, e.submitted_at, e.source,
         case when can_see_entry(e.round_id, e.user_id) then e.result end,
         not can_see_entry(e.round_id, e.user_id)
  from rounds r
  join entries e on e.round_id = r.id
  join profiles p on p.id = e.user_id
  where r.crew_id = p_crew and r.game = p_game and r.puzzle_id = p_puzzle and is_crew_member(r.crew_id)
  order by e.submitted_at
$$;

revoke execute on function public.get_round_board(uuid, text, text) from public, anon;
grant execute on function public.get_round_board(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
