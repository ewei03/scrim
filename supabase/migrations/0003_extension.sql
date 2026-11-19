-- Chrome extension support.
--
-- The extension doesn't hold a Supabase login session. Instead, a signed-in
-- user connects it from Scrim, which mints a random token. The extension
-- calls `extension_submit` with that token when a game finishes, and the
-- result is entered into every open lobby (in the user's crews) for that
-- game + puzzle. Tokens are stored hashed and can be revoked.

create table public.extension_tokens (
  token_hash   bytea primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index on public.extension_tokens (user_id);

-- No policies: only reachable through the functions below.
alter table public.extension_tokens enable row level security;

create function public.hash_token(p_token text) returns bytea
language sql immutable as $$ select sha256(convert_to(p_token, 'UTF8')) $$;

create function public.create_extension_token() returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into extension_tokens (token_hash, user_id) values (hash_token(v_token), auth.uid());
  return v_token;
end $$;

create function public.revoke_extension_tokens() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from extension_tokens where user_id = auth.uid();
end $$;

-- Called by the extension (as the `anon` role). Idempotent: lobbies you've
-- already entered are reported as 'already' and left untouched.
create function public.extension_submit(p_token text, p_game text, p_result jsonb, p_raw text default null)
returns table (lobby_code text, crew_name text, outcome text)
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid;
  v_puzzle text := p_result ->> 'puzzle';
  l        lobbies;
begin
  select user_id into v_user from extension_tokens where token_hash = hash_token(p_token);
  if v_user is null then raise exception 'Extension is not connected to a Scrim account'; end if;
  update extension_tokens set last_used_at = now() where token_hash = hash_token(p_token);

  if not is_supported_game(p_game) then raise exception 'Unsupported game: %', p_game; end if;

  for l in
    select lb.* from lobbies lb
    join crew_members m on m.crew_id = lb.crew_id and m.user_id = v_user
    where lb.game = p_game and lb.puzzle_id = v_puzzle
    order by lb.created_at
  loop
    lobby_code := l.invite_code;
    select name into crew_name from crews where id = l.crew_id;
    if lobby_closed(l) then
      outcome := 'closed';
    elsif exists (select 1 from entries where lobby_id = l.id and user_id = v_user) then
      outcome := 'already';
    else
      insert into entries (lobby_id, user_id, result, raw, source)
      values (l.id, v_user, normalize_result(l.game, l.puzzle_id, p_result), left(p_raw, 2000), 'extension');
      outcome := 'submitted';
    end if;
    return next;
  end loop;
end $$;

revoke execute on function
  public.hash_token(text),
  public.create_extension_token(),
  public.revoke_extension_tokens(),
  public.extension_submit(text, text, jsonb, text)
from public, anon;

grant execute on function public.create_extension_token(), public.revoke_extension_tokens() to authenticated;
grant execute on function public.extension_submit(text, text, jsonb, text) to anon, authenticated;
