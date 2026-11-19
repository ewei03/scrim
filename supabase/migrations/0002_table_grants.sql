-- Explicit table privileges.
--
-- Newer Supabase projects don't automatically grant the API roles access to
-- tables in `public`, so 0001 alone leaves signed-in users with
-- "permission denied". RLS policies still decide which rows are visible;
-- these grants only allow the queries to run at all.
-- Writes other than renaming yourself go through the RPCs in 0001.

grant usage on schema public to authenticated;

grant select on
  public.profiles,
  public.crews,
  public.crew_members,
  public.lobbies,
  public.entries
to authenticated;

grant update (display_name) on public.profiles to authenticated;

-- Profiles for anyone who signed up before 0001 ran (the trigger only
-- covers new users).
insert into public.profiles (id, display_name)
select u.id,
       left(coalesce(
         nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
         nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
         nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
         'Player'
       ), 24)
from auth.users u
on conflict (id) do nothing;
