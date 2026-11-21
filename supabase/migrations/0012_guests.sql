-- Guests are passing through: a guest account (Supabase anonymous sign-in)
-- stays in a crew for a day. 24 hours after joining, it's removed from the
-- crew along with its scores there. Linking Google turns a guest into a
-- regular account, which stays.
--
-- Crew owners are never removed this way (the crew would be left without an
-- owner); a guest who owns a crew keeps it.
--
-- profiles.is_guest mirrors auth.users.is_anonymous, so the site can label
-- guests (other players can't read auth.users).
--
-- The cleanup runs hourly with pg_cron. On Supabase, enable the pg_cron
-- extension (Database → Extensions) before running this, or the schedule is
-- skipped; it can be added later by running the cron.schedule call below.

alter table public.profiles add column is_guest boolean not null default false;

update public.profiles p set is_guest = true
from auth.users u
where u.id = p.id and u.is_anonymous;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      'Player'
    ), 24),
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Linking Google (or any upgrade from guest) updates the flag.
create function public.sync_guest_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set is_guest = coalesce(new.is_anonymous, false) where id = new.id;
  return new;
end $$;

create trigger on_auth_user_guest_change
  after update of is_anonymous on auth.users
  for each row execute function public.sync_guest_flag();

-- Removes guests who joined a crew over a day ago, and their scores in it.
-- Returns how many memberships it removed.
create function public.remove_expired_guests() returns int
language plpgsql security definer set search_path = public as $$
declare v_removed int;
begin
  create temporary table expired_guests on commit drop as
    select m.crew_id, m.user_id
    from crew_members m
    join profiles p on p.id = m.user_id
    join crews c on c.id = m.crew_id
    where p.is_guest
      and m.joined_at < now() - interval '1 day'
      and c.created_by <> m.user_id;

  delete from entries e
  using rounds r, expired_guests x
  where e.round_id = r.id and r.crew_id = x.crew_id and e.user_id = x.user_id;

  delete from crew_members m
  using expired_guests x
  where m.crew_id = x.crew_id and m.user_id = x.user_id;
  get diagnostics v_removed = row_count;

  drop table expired_guests;
  return v_removed;
end $$;

revoke execute on function
  public.sync_guest_flag(),
  public.remove_expired_guests()
from public, anon, authenticated;

-- Hourly, if pg_cron is installed.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('scrim-remove-expired-guests', '17 * * * *', 'select public.remove_expired_guests()');
  end if;
end $$;
