-- Guests who stop playing are removed from their crews after 48 hours.
--
-- A guest account lives in one browser, so one that's gone quiet has usually
-- been lost (signed out, cleared, another device). It used to stay in its
-- crews for good, taking one of the 10 places. Now the cleanup
-- (remove_expired_guests, every 5 minutes with pg_cron) also finds guests
-- with no activity in the last 48 hours (no score submitted, no crew joined,
-- and the account itself over 48 hours old) and takes them out of every
-- crew. Like a removed member:
--   * their scores for days still being played are deleted;
--   * their results on finished days stay, so the archive still shows them.
--     The rankings count current members only, so they drop out of those.
-- The account stays (deleting it would take those results with it); it can
-- still rejoin with an invite link from the same browser.
-- Guests who own a crew (made before guests were stopped from making them)
-- are left alone, so no crew is left without an owner. Linking Google makes
-- an account a regular one, which this never touches.
--
-- Safe to run again.

create or replace function public.remove_expired_guests() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_stale   uuid[];
  v_kicked  int := 0;
  v_idle    int := 0;
begin
  -- Guests still in a crew, with nothing done in 48 hours.
  select array_agg(p.id) into v_stale
  from profiles p
  join auth.users u on u.id = p.id
  where p.is_guest
    and u.is_anonymous
    and exists (select 1 from crew_members m where m.user_id = p.id)
    and not exists (select 1 from crews c where c.created_by = p.id)
    and greatest(
          p.created_at,
          (select max(e.submitted_at) from entries e where e.user_id = p.id),
          (select max(m.joined_at) from crew_members m where m.user_id = p.id)
        ) < now() - interval '48 hours';

  if v_stale is not null then
    -- Days still being played lose their entry; finished days keep it.
    delete from entries e
    using rounds r
    where e.round_id = r.id and e.user_id = any (v_stale) and r.closes_at > now();
    delete from crew_members where user_id = any (v_stale);
    -- Pending requests go; declined ones stay, so they aren't asked again.
    delete from crew_join_requests where user_id = any (v_stale) and not declined;
    v_kicked := cardinality(v_stale);
  end if;

  -- Guest accounts with nothing left at all, a day after they were made (0020).
  begin
    delete from auth.users u
    using profiles p
    where p.id = u.id
      and u.is_anonymous
      and p.is_guest
      and p.created_at < now() - interval '1 day'
      and not exists (select 1 from crew_members m where m.user_id = p.id)
      and not exists (select 1 from crews c where c.created_by = p.id)
      and not exists (select 1 from entries e where e.user_id = p.id)
      and not exists (select 1 from crew_join_requests r where r.user_id = p.id and not r.declined);
    get diagnostics v_idle = row_count;
  exception when insufficient_privilege then
    raise warning 'remove_expired_guests: can''t delete guest accounts: %', sqlerrm;
  end;

  return v_kicked + v_idle;
end $$;

revoke execute on function public.remove_expired_guests() from public, anon, authenticated;

notify pgrst, 'reload schema';
