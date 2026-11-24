-- Tell a crew when a guest was taken out of it for being inactive.
--
-- The cleanup (remove_expired_guests, 0025) takes guests with nothing done in
-- 48 hours out of their crews, and nothing recorded it: they just vanished
-- from the crew box and the rankings. Now each removal is logged here, per
-- crew, with the name they had, so the crew page can say what happened.
-- Members of the crew can read its log; nobody writes to it but the cleanup.
-- Entries older than 7 days are cleared out by the same cleanup. A guest
-- account deleted later keeps its log entries (the name is copied in).
--
-- Safe to run again.

create table if not exists public.crew_removals (
  id           uuid primary key default gen_random_uuid(),
  crew_id      uuid not null references public.crews (id) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null,
  display_name text not null,
  removed_at   timestamptz not null default now()
);

create index if not exists crew_removals_crew on public.crew_removals (crew_id, removed_at);

alter table public.crew_removals enable row level security;

drop policy if exists "crew members read removals" on public.crew_removals;
create policy "crew members read removals" on public.crew_removals
  for select to authenticated using (is_crew_member(crew_id));

grant select on public.crew_removals to authenticated;

create or replace function public.remove_expired_guests() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_stale   uuid[];
  v_kicked  int := 0;
  v_idle    int := 0;
begin
  -- Guests still in a crew, with nothing done in 48 hours.
  select array_agg(p.id) into v_stale
  from profiles p
  join auth.users u on u.id = p.id
  where p.is_guest
    and u.is_anonymous
    and exists (select 1 from crew_members m where m.user_id = p.id)
    and not exists (select 1 from crews c where c.created_by = p.id)
    and greatest(
          p.created_at,
          (select max(e.submitted_at) from entries e where e.user_id = p.id),
          (select max(m.joined_at) from crew_members m where m.user_id = p.id)
        ) < now() - interval '48 hours';

  if v_stale is not null then
    -- Each crew they leave hears about it.
    insert into crew_removals (crew_id, user_id, display_name)
    select m.crew_id, m.user_id, p.display_name
    from crew_members m
    join profiles p on p.id = m.user_id
    where m.user_id = any (v_stale);
    -- Days still being played lose their entry; finished days keep it.
    delete from entries e
    using rounds r
    where e.round_id = r.id and e.user_id = any (v_stale) and r.closes_at > now();
    delete from crew_members where user_id = any (v_stale);
    -- Pending requests go; declined ones stay, so they aren't asked again.
    delete from crew_join_requests where user_id = any (v_stale) and not declined;
    v_kicked := cardinality(v_stale);
  end if;

  -- Old news.
  delete from crew_removals where removed_at < now() - interval '7 days';

  -- Guest accounts with nothing left at all, a day after they were made (0020).
  begin
    delete from auth.users u
    using profiles p
    where p.id = u.id
      and u.is_anonymous
      and p.is_guest
      and p.created_at < now() - interval '1 day'
      and not exists (select 1 from crew_members m where m.user_id = p.id)
      and not exists (select 1 from crews c where c.created_by = p.id)
      and not exists (select 1 from entries e where e.user_id = p.id)
      and not exists (select 1 from crew_join_requests r where r.user_id = p.id and not r.declined);
    get diagnostics v_idle = row_count;
  exception when insufficient_privilege then
    raise warning 'remove_expired_guests: can''t delete guest accounts: %', sqlerrm;
  end;

  return v_kicked + v_idle;
end $$;

revoke execute on function public.remove_expired_guests() from public, anon, authenticated;

notify pgrst, 'reload schema';
