-- Limits that keep crews small and hard to spam:
--   * a crew holds at most 10 members (the owner included);
--   * the owner can turn off guest joins (crews.allow_guests);
--   * each account owns at most 4 crews at once;
--   * display names and crew names are at most 16 characters (new names and
--     renames; longer names from before stay until they're changed);
--   * guests can't suggest games;
--   * guests can make one crew, which lasts for the day: at midnight (crew
--     time) it's deleted, along with the guest account. Linking Google first
--     keeps both.
--
-- Safe to run again: an earlier version of this file may already have run.

alter table public.crews add column if not exists allow_guests boolean not null default true;

-- When a guest's crew gets deleted: the midnight after it was made, in its
-- time zone. Fixed at creation, so changing the time zone can't push it back.
-- Null for crews made by Google accounts, and cleared when a guest links one.
alter table public.crews add column if not exists guest_expires_at timestamptz;

-- ---------------------------------------------------------------------------
-- Joining: member cap and guest switch
-- ---------------------------------------------------------------------------

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

  insert into crew_members (crew_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Creating: at most 4 crews owned at once, 1 for guests (deleted at midnight)
-- ---------------------------------------------------------------------------

create or replace function public.create_crew(p_name text, p_timezone text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c       crews;
  v_guest boolean := (select is_guest from profiles where id = auth.uid());
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_guest and exists (select 1 from crews where created_by = auth.uid()) then
    raise exception 'Guests can make one crew. Sign in with Google to make more.';
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
  insert into crews (name, created_by, timezone, guest_expires_at)
  values (
    trim(p_name), auth.uid(), p_timezone,
    case when v_guest
      then (((now() at time zone p_timezone)::date + 1)::timestamp) at time zone p_timezone
    end
  )
  returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Guests at midnight
-- ---------------------------------------------------------------------------

-- Every few minutes (pg_cron, see 0016):
--   * a guest's crew whose day is over is deleted, with the guest account
--     (and so its scores everywhere);
--   * guests leave crews they joined once that day is over (scores stay).
-- Returns how many crews and memberships it removed.
create or replace function public.remove_expired_guests() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_owners  uuid[];
  v_crews   int;
  v_members int;
begin
  with gone as (
    delete from crews c
    using profiles p
    where p.id = c.created_by and p.is_guest and c.guest_expires_at <= now()
    returning c.created_by
  )
  select array_agg(distinct created_by), count(*) into v_owners, v_crews from gone;

  if v_owners is not null then
    -- The guest accounts go too. Deleting the auth user takes the profile
    -- and everything hanging off it.
    -- If the database won't allow that, the crews still go; the accounts
    -- stay (they're guests, with nothing left to show).
    begin
      delete from auth.users u where u.id = any (v_owners) and u.is_anonymous;
    exception when insufficient_privilege then
      raise warning 'remove_expired_guests: can''t delete guest accounts: %', sqlerrm;
    end;
  end if;

  delete from crew_members m
  using profiles p, crews c
  where p.id = m.user_id
    and c.id = m.crew_id
    and p.is_guest
    and c.created_by <> m.user_id
    and (now() at time zone coalesce(c.timezone, 'UTC'))::date
      > (m.joined_at at time zone coalesce(c.timezone, 'UTC'))::date;
  get diagnostics v_members = row_count;
  return v_crews + v_members;
end $$;

-- Linking Google keeps the guest's crew: no more expiry.
create or replace function public.sync_guest_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set is_guest = coalesce(new.is_anonymous, false) where id = new.id;
  if not coalesce(new.is_anonymous, false) then
    update public.crews set guest_expires_at = null where created_by = new.id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Settings: the guest switch, and crew names up to 16 characters
-- ---------------------------------------------------------------------------

drop function if exists public.update_crew_settings(uuid, text, boolean, text);

create or replace function public.update_crew_settings(
  p_crew uuid,
  p_timezone text default null,
  p_hide_until_submitted boolean default null,
  p_name text default null,
  p_allow_guests boolean default null
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
      allow_guests         = coalesce(p_allow_guests, allow_guests)
  where id = p_crew and created_by = auth.uid()
  returning * into c;
  if not found then raise exception 'Only the crew owner can change crew settings'; end if;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Display names: 16 characters
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    rtrim(left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      'Player'
    ), 16)),
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Checked on rename only, so names from before the limit keep working (and
-- other updates to those profiles, like linking Google, still go through).
create or replace function public.check_display_name_length() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name and char_length(trim(new.display_name)) > 16 then
    raise exception 'Display names are up to 16 characters';
  end if;
  return new;
end $$;

drop trigger if exists profiles_display_name_length on public.profiles;
create trigger profiles_display_name_length
  before update of display_name on public.profiles
  for each row execute function public.check_display_name_length();

-- ---------------------------------------------------------------------------
-- Game suggestions: Google accounts only
-- ---------------------------------------------------------------------------

create or replace function public.suggest_game(
  p_name text,
  p_url text default null,
  p_notes text default null,
  p_email text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := nullif(trim(p_name), '');
  v_url   text := nullif(trim(p_url), '');
  v_notes text := nullif(trim(p_notes), '');
  v_email text := lower(nullif(trim(p_email), ''));
begin
  if auth.uid() is null then raise exception 'Sign in to suggest a game'; end if;
  if (select is_guest from profiles where id = auth.uid()) then
    raise exception 'Sign in with Google to suggest a game';
  end if;
  if v_name is null then raise exception 'Give the game a name'; end if;
  if char_length(v_name) > 80 then raise exception 'Name is too long (80 characters max)'; end if;
  if v_url is not null and (char_length(v_url) > 300 or v_url !~* '^https?://[^\s]+$') then
    raise exception 'Link must be a web address starting with http:// or https://';
  end if;
  if char_length(v_notes) > 1000 then raise exception 'Notes are too long (1000 characters max)'; end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'That email address doesn''t look right';
  end if;
  if exists (select 1 from game_suggestions
             where user_id = auth.uid() and created_at > now() - interval '1 hour') then
    raise exception 'You just sent a suggestion. Try again in an hour!';
  end if;
  if (select count(*) from game_suggestions
      where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s plenty of suggestions for today. Try again tomorrow!';
  end if;

  insert into game_suggestions (user_id, name, url, notes, email)
  values (auth.uid(), v_name, v_url, v_notes, v_email);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges (see 0017: new functions start private)
-- ---------------------------------------------------------------------------

revoke execute on function
  public.update_crew_settings(uuid, text, boolean, text, boolean),
  public.check_display_name_length()
from public, anon, authenticated;

grant execute on function public.update_crew_settings(uuid, text, boolean, text, boolean) to authenticated;

notify pgrst, 'reload schema';
