-- No two members of a crew can share a display name (ignoring case and
-- surrounding spaces), so scoreboards and rankings are never ambiguous.
--
-- Joining is refused if the name is taken in that crew, and so is renaming
-- yourself to a name taken in any of your crews. Crews that already have two
-- people with the same name are left as they are.

create function public.same_name(a text, b text) returns boolean
language sql immutable as $$ select lower(trim(a)) = lower(trim(b)) $$;

create or replace function public.join_crew(p_code text) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c      crews;
  v_name text;
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

  select display_name into v_name from profiles where id = auth.uid();
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

-- Renaming yourself: the new name can't match anyone else in your crews.
create function public.check_display_name_free() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if same_name(new.display_name, old.display_name) then return new; end if;
  if exists (
    select 1
    from crew_members mine
    join crew_members other on other.crew_id = mine.crew_id and other.user_id <> new.id
    join profiles p on p.id = other.user_id
    where mine.user_id = new.id and same_name(p.display_name, new.display_name)
  ) then
    raise exception 'Someone in one of your crews is already called %. Pick a different name.', trim(new.display_name);
  end if;
  return new;
end $$;

create trigger profiles_display_name_free
  before update of display_name on public.profiles
  for each row execute function public.check_display_name_free();

revoke execute on function
  public.same_name(text, text),
  public.check_display_name_free()
from public, anon;
