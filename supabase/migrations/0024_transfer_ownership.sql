-- The crew owner can hand the crew to another member.
--
-- Ownership is crews.created_by: every owner check (settings, games, removing
-- members, join requests, deleting) reads it, so moving it moves all of that.
-- The old owner stays in the crew as a regular member.
--
-- The new owner must already be in the crew, and can't be a guest (a guest
-- account lives in one browser, so the crew could be lost with it; guests
-- can't make crews either, 0022).
--
-- Safe to run again.

create or replace function public.transfer_crew(p_crew uuid, p_user uuid) returns public.crews
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if not exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'Only the crew owner can transfer it';
  end if;
  if p_user = auth.uid() then raise exception 'You already own this crew'; end if;
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = p_user) then
    raise exception 'The new owner has to be in the crew';
  end if;
  if (select is_guest from profiles where id = p_user) then
    raise exception 'Guests can''t own a crew. They need to sign in with Google first.';
  end if;

  update crews set created_by = p_user where id = p_crew returning * into c;
  return c;
end $$;

-- See 0017: new functions start private.
revoke execute on function public.transfer_crew(uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_crew(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
