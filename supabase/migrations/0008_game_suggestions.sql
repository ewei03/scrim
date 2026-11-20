-- Game suggestions from players.
--
-- Anyone signed in (guests too) can suggest a game through suggest_game().
-- Nobody can read them through the API: RLS is on with no policies and the
-- API roles get no table privileges. The owner reads them in the Supabase
-- dashboard (Table Editor → game_suggestions, or the SQL editor), which
-- bypasses RLS.

create table public.game_suggestions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  name        text not null check (char_length(name) between 1 and 80),
  url         text check (url is null or char_length(url) <= 300),
  notes       text check (notes is null or char_length(notes) <= 1000),
  created_at  timestamptz not null default now()
);

alter table public.game_suggestions enable row level security;
revoke all on public.game_suggestions from anon, authenticated;

create index game_suggestions_user_recent on public.game_suggestions (user_id, created_at desc);

create or replace function public.suggest_game(p_name text, p_url text default null, p_notes text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := nullif(trim(p_name), '');
  v_url   text := nullif(trim(p_url), '');
  v_notes text := nullif(trim(p_notes), '');
begin
  if auth.uid() is null then raise exception 'Sign in to suggest a game'; end if;
  if v_name is null then raise exception 'Give the game a name'; end if;
  if char_length(v_name) > 80 then raise exception 'Name is too long (80 characters max)'; end if;
  if v_url is not null and (char_length(v_url) > 300 or v_url !~* '^https?://[^\s]+$') then
    raise exception 'Link must be a web address starting with http:// or https://';
  end if;
  if char_length(v_notes) > 1000 then raise exception 'Notes are too long (1000 characters max)'; end if;
  if exists (select 1 from game_suggestions
             where user_id = auth.uid() and created_at > now() - interval '1 hour') then
    raise exception 'You just sent a suggestion. Try again in an hour!';
  end if;
  if (select count(*) from game_suggestions
      where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s plenty of suggestions for today. Try again tomorrow!';
  end if;

  insert into game_suggestions (user_id, name, url, notes)
  values (auth.uid(), v_name, v_url, v_notes);
end $$;

revoke execute on function public.suggest_game(text, text, text) from public, anon;
grant execute on function public.suggest_game(text, text, text) to authenticated;
