-- Display names don't have to be unique within a crew any more (undoes 0010).
--
-- Joining, approving a join request and renaming yourself no longer check
-- for someone else in the crew with the same name. Members are told apart by
-- their account, not their name, everywhere that matters.
--
-- same_name() is left in place: earlier migrations still mention it.
--
-- Safe to run again.

drop trigger if exists profiles_display_name_free on public.profiles;
drop function if exists public.check_display_name_free();

-- As in 0023, without the name check.
create or replace function public.join_crew(p_code text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c        crews;
  v_guest  boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  -- One join at a time per account, so two tabs can't both take the 4th place.
  perform pg_advisory_xact_lock(hashtext('crew_count:' || auth.uid()::text));

  -- The crew limit comes first. Members opening their own crew's link again
  -- aren't joining anything, so it doesn't apply to them.
  if crew_count(auth.uid()) >= 4 and not exists (
    select 1 from crew_members m join crews x on x.id = m.crew_id
    where x.invite_code = lower(trim(p_code)) and m.user_id = auth.uid()
  ) then
    raise exception 'You''re in 4 crews, the most you can. Leave one to join another.';
  end if;

  select * into c from crews where invite_code = lower(trim(p_code));
  if not found then raise exception 'Crew not found'; end if;

  -- Already in it: opening the link again is fine.
  if exists (select 1 from crew_members where crew_id = c.id and user_id = auth.uid()) then
    return c;
  end if;

  select is_guest into v_guest from profiles where id = auth.uid();
  if v_guest and not c.allow_guests then
    raise exception 'This crew doesn''t take guests. Sign in with Google to join.';
  end if;
  -- Locked while counting, so two people can't both take the last place.
  perform 1 from crews where id = c.id for update;
  if (select count(*) from crew_members where crew_id = c.id) >= 10 then
    raise exception 'This crew is full (10 players max)';
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

-- As in 0023, without the name check. Owner only: let someone in, or turn them down.
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

  perform pg_advisory_xact_lock(hashtext('crew_count:' || p_user::text));
  if crew_count(p_user) >= 4 then
    raise exception 'They''re already in 4 crews, the most anyone can be in.';
  end if;
  perform 1 from crews where id = p_crew for update;
  if (select count(*) from crew_members where crew_id = p_crew) >= 10 then
    raise exception 'This crew is full (10 players max)';
  end if;
  insert into crew_members (crew_id, user_id) values (p_crew, p_user) on conflict do nothing;
  delete from crew_join_requests where crew_id = p_crew and user_id = p_user;
end $$;
