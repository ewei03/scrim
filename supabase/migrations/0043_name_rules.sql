-- Name rules (mirrors src/lib/names.ts):
--   * crew names are up to 24 characters (was 16, see 0018; the column has
--     allowed 40 since 0001)
--   * crew names and display names are ASCII letters and digits, with single
--     spaces between words
-- Checked when a name is set or changed, so existing names keep working.
-- The pattern is written out in each function rather than shared, because
-- the display name trigger runs as the signed-in user, who can't call new
-- functions (0017).

-- ---------------------------------------------------------------------------
-- Crew names
-- ---------------------------------------------------------------------------

create or replace function public.create_crew(p_name text, p_timezone text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c      crews;
  v_name text := trim(p_name);
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
  if coalesce(v_name, '') = '' or char_length(v_name) > 24 then
    raise exception 'Crew names are 1 to 24 characters';
  end if;
  if v_name !~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$' then
    raise exception 'Crew names can only use letters, numbers and spaces';
  end if;
  insert into crews (name, created_by, timezone) values (v_name, auth.uid(), p_timezone) returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return c;
end $$;

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
  if p_name is not null and (v_name = '' or char_length(v_name) > 24) then
    raise exception 'Crew names are 1 to 24 characters';
  end if;
  if p_name is not null and v_name !~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$' then
    raise exception 'Crew names can only use letters, numbers and spaces';
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
-- Display names
-- ---------------------------------------------------------------------------

-- New accounts: the first name given (guest's choice, then Google's) with
-- other characters dropped, cut to 16, else "Player".
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_raw  text;
  v_name text;
begin
  foreach v_raw in array array[
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  ] loop
    v_name := trim(left(trim(regexp_replace(
      regexp_replace(coalesce(v_raw, ''), '[^A-Za-z0-9 ]', '', 'g'), ' {2,}', ' ', 'g')), 16));
    exit when v_name <> '';
  end loop;
  insert into public.profiles (id, display_name, is_guest)
  values (new.id, coalesce(nullif(v_name, ''), 'Player'), coalesce(new.is_anonymous, false))
  on conflict (id) do nothing;
  return new;
end $$;

-- Renames only, so older names keep working (and other updates to those
-- profiles, like linking Google, still go through).
create or replace function public.check_display_name_length() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name then
    if char_length(trim(new.display_name)) > 16 then
      raise exception 'Display names are up to 16 characters';
    end if;
    if trim(new.display_name) !~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$' then
      raise exception 'Display names can only use letters, numbers and spaces';
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
