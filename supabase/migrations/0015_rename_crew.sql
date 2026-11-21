-- Renaming a crew: update_crew_settings takes p_name. Databases set up
-- before 0009 gained that parameter still have the three-argument version,
-- so swap it for the four-argument one. On a fresh database this just
-- redefines the same function.

drop function if exists public.update_crew_settings(uuid, text, boolean);

create or replace function public.update_crew_settings(
  p_crew uuid,
  p_timezone text default null,
  p_hide_until_submitted boolean default null,
  p_name text default null
) returns public.crews
language plpgsql security definer set search_path = public as $$
declare
  c      crews;
  v_name text := trim(p_name);
begin
  if p_timezone is not null and not is_valid_timezone(p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone;
  end if;
  if p_name is not null and (v_name = '' or char_length(v_name) > 40) then
    raise exception 'Crew names are 1 to 40 characters';
  end if;
  update crews
  set timezone             = coalesce(p_timezone, timezone),
      hide_until_submitted = coalesce(p_hide_until_submitted, hide_until_submitted),
      name                 = coalesce(v_name, name)
  where id = p_crew and created_by = auth.uid()
  returning * into c;
  if not found then raise exception 'Only the crew owner can change crew settings'; end if;
  return c;
end $$;

revoke execute on function public.update_crew_settings(uuid, text, boolean, text) from public, anon;
grant execute on function public.update_crew_settings(uuid, text, boolean, text) to authenticated;

-- Have PostgREST pick up the new signature now.
notify pgrst, 'reload schema';
