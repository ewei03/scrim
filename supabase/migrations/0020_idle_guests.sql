-- Guest accounts with nothing left are deleted.
--
-- A guest who tries Scrim and leaves, or whose crews all moved on, used to
-- stay in Authentication -> Users forever (as did every guest the browser
-- tests make). Now the cleanup also deletes guest accounts that are over a
-- day old and have nothing attached: no crew they're in or own, no score
-- anywhere, no request waiting to join. Nothing visible goes with them.
--
-- Safe to run again.

create or replace function public.remove_expired_guests() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_owners  uuid[];
  v_crews   int;
  v_members int;
  v_idle    int := 0;
begin
  -- A guest's crew whose day is over goes, with the guest account (0018).
  with gone as (
    delete from crews c
    using profiles p
    where p.id = c.created_by and p.is_guest and c.guest_expires_at <= now()
    returning c.created_by
  )
  select array_agg(distinct created_by), count(*) into v_owners, v_crews from gone;

  if v_owners is not null then
    -- Deleting the auth user takes the profile and everything hanging off it.
    -- If the database won't allow that, the crews still go; the accounts stay.
    begin
      delete from auth.users u where u.id = any (v_owners) and u.is_anonymous;
    exception when insufficient_privilege then
      raise warning 'remove_expired_guests: can''t delete guest accounts: %', sqlerrm;
    end;
  end if;

  -- Guests leave crews they joined once that day is over; their scores stay (0016).
  delete from crew_members m
  using profiles p, crews c
  where p.id = m.user_id
    and c.id = m.crew_id
    and p.is_guest
    and c.created_by <> m.user_id
    and (now() at time zone coalesce(c.timezone, 'UTC'))::date
      > (m.joined_at at time zone coalesce(c.timezone, 'UTC'))::date;
  get diagnostics v_members = row_count;

  -- Guest accounts with nothing left, a day after they were made.
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

  return v_crews + v_members + v_idle;
end $$;

revoke execute on function public.remove_expired_guests() from public, anon, authenticated;
