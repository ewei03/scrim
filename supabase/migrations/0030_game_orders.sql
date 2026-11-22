-- Your order for a crew's games, kept on your account.
--
-- It used to live only in the browser you dragged it in, so another device
-- (or cleared site data) showed the usual order. Now it's saved here, per
-- crew and member, and the site still keeps a copy in the browser so the
-- order shows straight away.
--
-- It's yours alone: nobody else in the crew can read it. Leaving the crew
-- (or the crew being deleted) drops it.
--
-- Safe to run again.

create table if not exists public.game_orders (
  crew_id    uuid not null references public.crews (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  games      text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (crew_id, user_id),
  foreign key (crew_id, user_id) references public.crew_members (crew_id, user_id) on delete cascade
);

alter table public.game_orders enable row level security;

drop policy if exists "read your own game order" on public.game_orders;
create policy "read your own game order" on public.game_orders
  for select using (user_id = auth.uid());

grant select on public.game_orders to authenticated;

create or replace function public.set_game_order(p_crew uuid, p_games text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_crew_member(p_crew) then raise exception 'Crew not found'; end if;
  if coalesce(array_length(p_games, 1), 0) > 100
     or exists (select 1 from unnest(p_games) g where g is null or length(g) > 100) then
    raise exception 'Invalid game order';
  end if;
  insert into game_orders (crew_id, user_id, games)
  values (p_crew, auth.uid(), p_games)
  on conflict (crew_id, user_id) do update set games = excluded.games, updated_at = now();
end $$;

revoke execute on function public.set_game_order(uuid, text[]) from public, anon, authenticated;
grant execute on function public.set_game_order(uuid, text[]) to authenticated;
