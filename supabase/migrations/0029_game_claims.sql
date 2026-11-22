-- One game, one Scrim account.
--
-- A game's saved progress lives in the browser, so when one person signs out
-- of Scrim and another signs in on the same computer, the extension could
-- send the first person's game as the second's. Now the extension also sends
-- who played it: a hash of the game account it was played on (the NYT or
-- Krillion account), or of the browser when played signed out. The first
-- Scrim account to send a game claims it; the same game from any other Scrim
-- account gets 'not-yours' and goes nowhere.
--
-- Claims are kept for a week: past that, the puzzle's day is over everywhere.
--
-- Safe to run again.

create table if not exists public.game_claims (
  player     text not null check (player ~ '^[0-9a-f]{64}$'),
  game       text not null,
  puzzle     text not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (player, game, puzzle)
);
create index if not exists game_claims_claimed_at on public.game_claims (claimed_at);

-- Only reachable through extension_submit.
alter table public.game_claims enable row level security;

-- Extensions from before this send no player, and are taken as before.
drop function if exists public.extension_submit(text, text, jsonb, text);

create or replace function public.extension_submit(
  p_token text, p_game text, p_result jsonb, p_raw text default null, p_player text default null
)
returns table (crew_code text, crew_name text, outcome text)
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid;
  v_owner  uuid;
  v_puzzle text := p_result ->> 'puzzle';
  c        crews;
begin
  select user_id into v_user from extension_tokens where token_hash = hash_token(p_token);
  if v_user is null then raise exception 'Extension is not connected to a Scrim account'; end if;
  update extension_tokens set last_used_at = now() where token_hash = hash_token(p_token);

  if not is_supported_game(p_game) then raise exception 'Unsupported game: %', p_game; end if;

  if p_player is not null then
    if p_player !~ '^[0-9a-f]{64}$' then raise exception 'Invalid player'; end if;
    if v_puzzle is null or v_puzzle !~ '^[0-9]{1,6}$' then raise exception 'Invalid puzzle number'; end if;
    delete from game_claims where claimed_at < now() - interval '7 days';
    insert into game_claims (player, game, puzzle, user_id)
    values (p_player, p_game, v_puzzle, v_user)
    on conflict do nothing;
    select user_id into v_owner from game_claims where player = p_player and game = p_game and puzzle = v_puzzle;
    if v_owner <> v_user then
      crew_code := null;
      crew_name := null;
      outcome := 'not-yours';
      return next;
      return;
    end if;
  end if;

  for c in
    select cr.* from crews cr
    join crew_members m on m.crew_id = cr.id and m.user_id = v_user
    join crew_games g on g.crew_id = cr.id and g.game = p_game
    order by cr.created_at
  loop
    crew_code := c.invite_code;
    crew_name := c.name;
    outcome := record_entry(v_user, c.id, p_game, p_result, p_raw, 'extension');
    return next;
  end loop;
end $$;

revoke execute on function public.extension_submit(text, text, jsonb, text, text) from public;
grant execute on function public.extension_submit(text, text, jsonb, text, text) to anon, authenticated;
