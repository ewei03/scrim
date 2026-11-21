-- Guests can't create crews: they're only in a crew for a day (0012), so they
-- join through invite links. Signing in with Google lifts this.

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
  insert into crews (name, created_by, timezone) values (trim(p_name), auth.uid(), p_timezone) returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return c;
end $$;
