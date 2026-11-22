-- "Suggest a game" becomes a feedback form.
--
-- Messages come in three kinds: a game suggestion (as before), a problem
-- report, or anything else. They stay in game_suggestions (so the dashboard
-- keeps one place to read them), with a kind and, for problem reports, the
-- browser and extension version, to tell e.g. Opera from Chrome.
--
-- Guests can now report problems and send other messages; suggesting a game
-- still needs a Google account. The wait between messages drops from an hour
-- to two minutes; five a day stays.
--
-- send_feedback replaces suggest_game.
--
-- Safe to run again.

alter table public.game_suggestions
  add column if not exists kind text not null default 'game',
  add column if not exists details jsonb;

alter table public.game_suggestions drop constraint if exists game_suggestions_kind_check;
alter table public.game_suggestions
  add constraint game_suggestions_kind_check check (kind in ('game', 'problem', 'other'));

-- Only game suggestions have a game name.
alter table public.game_suggestions alter column name drop not null;
alter table public.game_suggestions drop constraint if exists game_suggestions_name_for_games;
alter table public.game_suggestions
  add constraint game_suggestions_name_for_games check (kind <> 'game' or name is not null);

drop function if exists public.suggest_game(text, text, text, text);

create or replace function public.send_feedback(
  p_kind    text,
  p_message text default null,
  p_name    text default null,
  p_url     text default null,
  p_email   text default null,
  p_details jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_message text := nullif(trim(p_message), '');
  v_name    text := nullif(trim(p_name), '');
  v_url     text := nullif(trim(p_url), '');
  v_email   text := lower(nullif(trim(p_email), ''));
  v_details jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to send feedback'; end if;
  if p_kind is null or p_kind not in ('game', 'problem', 'other') then raise exception 'Pick what this is about'; end if;

  if p_kind = 'game' then
    if (select is_guest from profiles where id = auth.uid()) then
      raise exception 'Sign in with Google to suggest a game';
    end if;
    if v_name is null then raise exception 'Give the game a name'; end if;
    if char_length(v_name) > 80 then raise exception 'Name is too long (80 characters max)'; end if;
    if v_url is not null and (char_length(v_url) > 300 or v_url !~* '^https?://[^\s]+$') then
      raise exception 'Link must be a web address starting with http:// or https://';
    end if;
  else
    -- Only game suggestions have a game and a link.
    v_name := null;
    v_url := null;
    if v_message is null then raise exception 'Write a message'; end if;
    -- What the site knows about where it went wrong: just these, kept short.
    if p_kind = 'problem' and jsonb_typeof(p_details) = 'object' then
      v_details := nullif(jsonb_strip_nulls(jsonb_build_object(
        'browser',   left(p_details ->> 'browser', 300),
        'extension', left(p_details ->> 'extension', 20),
        'page',      left(p_details ->> 'page', 300)
      )), '{}'::jsonb);
    end if;
  end if;

  if char_length(v_message) > 1000 then raise exception 'Message is too long (1000 characters max)'; end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'That email address doesn''t look right';
  end if;
  if exists (select 1 from game_suggestions
             where user_id = auth.uid() and created_at > now() - interval '2 minutes') then
    raise exception 'You just sent one. Try again in a couple of minutes!';
  end if;
  if (select count(*) from game_suggestions
      where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s plenty of messages for today. Try again tomorrow!';
  end if;

  insert into game_suggestions (user_id, kind, name, url, notes, email, details)
  values (auth.uid(), p_kind, v_name, v_url, v_message, v_email, v_details);
end $$;

-- See 0017: new functions start private.
revoke execute on function public.send_feedback(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_feedback(text, text, text, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
