-- Removing a member can also wipe their stats, and no longer bans them.
--
-- remove_crew_member used to delete only the member's entries in open rounds,
-- leaving their finished results in the crew's history and rankings. Now the
-- owner can pass p_wipe to delete every result they posted in this crew, so a
-- removed member doesn't clutter the rankings. Their results in other crews
-- are untouched.
--
-- Removed members also used to be banned from rejoining (crew_bans). Now
-- they can rejoin with the invite link like anyone else, and existing bans
-- are lifted. join_crew still checks crew_bans, which simply stays empty.
--
-- Safe to run again.

drop function if exists public.remove_crew_member(uuid, uuid);

create or replace function public.remove_crew_member(p_crew uuid, p_user uuid, p_wipe boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crews where id = p_crew and created_by = auth.uid()) then
    raise exception 'Only the crew owner can remove members';
  end if;
  if p_user = auth.uid() then raise exception 'The owner can''t remove themselves'; end if;

  delete from crew_members where crew_id = p_crew and user_id = p_user;
  if not found then raise exception 'Not a member of this crew'; end if;

  -- Open rounds always lose their entry; with p_wipe, finished ones do too.
  delete from entries e
  using rounds r
  where e.round_id = r.id and r.crew_id = p_crew and e.user_id = p_user
    and (p_wipe or r.closes_at > now());
end $$;

delete from public.crew_bans;

-- See 0017: new functions start private.
revoke execute on function public.remove_crew_member(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.remove_crew_member(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
