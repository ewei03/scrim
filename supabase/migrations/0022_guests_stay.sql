-- Guests stay, but can't make crews.
--
-- Guests used to be passing through: they left each crew at the end of the
-- day they joined it (0016), and could make one crew that was deleted at
-- midnight with their account (0018). Now:
--   * guests stay in the crews they join, like anyone else. They lose access
--     the usual ways: signing out, switching devices, clearing site data
--     (a guest account only exists in that browser);
--   * guests can't make crews again (as in 0013). They join someone else's
--     with an invite link. Signing in with Google lifts this;
--   * crews guests already made stay, and no longer expire.
--
-- The cleanup (remove_expired_guests, every few minutes with pg_cron) now
-- only deletes guest accounts over a day old with nothing attached (0020).
--
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Creating: Google accounts only, at most 4 owned at once
-- ---------------------------------------------------------------------------

create or replace function public.create_crew(p_name text, p_timezone text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if (select is_guest from profiles where id = auth.uid()) then
    raise exception 'Sign in with Google to create a crew. Guests can join crews with an invite link.';
  end if;
  if p_timezone is null or not is_valid_timezone(p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone;
  end if;
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 16 then
    raise exception 'Crew names are 1 to 16 characters';
  end if;
  if (select count(*) from crews where created_by = auth.uid()) >= 4 then
    raise exception 'You own 4 crews, the most you can. Delete one to make another.';
  end if;
  insert into crews (name, created_by, timezone) values (trim(p_name), auth.uid(), p_timezone) returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- No more expiry
-- ---------------------------------------------------------------------------

-- Linking Google just stops them being a guest.
create or replace function public.sync_guest_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set is_guest = coalesce(new.is_anonymous, false) where id = new.id;
  return new;
end $$;

-- Only idle guest accounts: over a day old, with no crew they're in or own,
-- no score anywhere and no request waiting to join. Nothing visible goes.
create or replace function public.remove_expired_guests() returns int
language plpgsql security definer set search_path = public as $$
declare v_idle int := 0;
begin
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
  return v_idle;
end $$;

-- Guests' crews no longer have a deadline (only the functions above used it).
alter table public.crews drop column if exists guest_expires_at;

revoke execute on function public.remove_expired_guests() from public, anon, authenticated;
revoke execute on function public.create_crew(text, text) from public, anon, authenticated;
grant execute on function public.create_crew(text, text) to authenticated;

notify pgrst, 'reload schema';
