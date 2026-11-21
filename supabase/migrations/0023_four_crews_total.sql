-- At most 4 crews per account, owned and joined together.
--
-- The limit used to count only crews you own (0018); joining had no cap. Now
-- every crew you're in counts (an owner is a member of their own crew), and:
--   * joining checks it first, before the crew is even looked up, so someone
--     in 4 crews hears that rather than "not found" or "full". Opening the
--     link of a crew you're already in is still fine;
--   * asking to join a crew that needs approval checks it too, and so does
--     the owner approving (you may have joined others while waiting);
--   * creating a crew counts crews you've joined, not just ones you own.
-- Anyone already in more than 4 keeps them, but can't join or make another
-- until they're under.
--
-- join_crew also drops its crew_bans check: removed members can rejoin (0021).
--
-- Safe to run again.

create or replace function public.crew_count(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from crew_members where user_id = p_user
$$;

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------

create or replace function public.join_crew(p_code text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c        crews;
  v_name   text;
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

  perform pg_advisory_xact_lock(hashtext('crew_count:' || p_user::text));
  if crew_count(p_user) >= 4 then
    raise exception 'They''re already in 4 crews, the most anyone can be in.';
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
-- Creating: Google accounts only, and it counts toward the 4
-- ---------------------------------------------------------------------------

create or replace function public.create_crew(p_name text, p_timezone text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if (select is_guest from profiles where id = auth.uid()) then
    raise exception 'Sign in with Google to create a crew. Guests can join crews with an invite link.';
  end if;
  perform pg_advisory_xact_lock(hashtext('crew_count:' || auth.uid()::text));
  if crew_count(auth.uid()) >= 4 then
    raise exception 'You''re in 4 crews, the most you can. Leave or delete one to make another.';
  end if;
  if p_timezone is null or not is_valid_timezone(p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone;
  end if;
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 16 then
    raise exception 'Crew names are 1 to 16 characters';
  end if;
  insert into crews (name, created_by, timezone) values (trim(p_name), auth.uid(), p_timezone) returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges (see 0017: new functions start private)
-- ---------------------------------------------------------------------------

revoke execute on function public.crew_count(uuid) from public, anon, authenticated;
revoke execute on function
  public.join_crew(text),
  public.answer_join_request(uuid, uuid, boolean),
  public.create_crew(text, text)
from public, anon, authenticated;
grant execute on function
  public.join_crew(text),
  public.answer_join_request(uuid, uuid, boolean),
  public.create_crew(text, text)
to authenticated;

notify pgrst, 'reload schema';
