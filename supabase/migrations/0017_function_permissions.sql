-- Lock down which functions the API can call.
--
-- Supabase makes every new function in public callable by the API roles
-- (anon, authenticated). Earlier migrations revoked "from public, anon",
-- which left internal helpers callable by any signed-in user, including
-- record_entry, which takes a user id: anyone could post a score as anyone
-- else.
--
-- Now: nothing is callable by default, and only the functions the site, the
-- extension and RLS actually use are granted. A function added later is
-- private until a migration grants it.

-- Future functions: private by default.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

do $$
declare f record;
begin
  -- Existing functions: take everything away...
  for f in select oid::regprocedure as sig from pg_proc
           where pronamespace = 'public'::regnamespace and prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;

  -- ...then grant back what the site calls, plus the RLS helpers (policies
  -- run them as the querying user).
  for f in select oid::regprocedure as sig from pg_proc
           where pronamespace = 'public'::regnamespace and prokind = 'f'
             and proname in (
               'can_see_entry', 'is_crew_member',
               'create_crew', 'join_crew', 'leave_crew', 'delete_crew',
               'update_crew_settings', 'set_crew_game', 'remove_crew_member',
               'create_custom_game', 'update_custom_game', 'delete_custom_game',
               'submit_entry', 'void_entry', 'get_round_board',
               'create_extension_token', 'revoke_extension_tokens',
               'suggest_game',
               'extension_submit', 'extension_rankings'
             ) loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;

  -- The extension calls with the publishable key only; its token is the auth.
  for f in select oid::regprocedure as sig from pg_proc
           where pronamespace = 'public'::regnamespace and prokind = 'f'
             and proname in ('extension_submit', 'extension_rankings') loop
    execute format('grant execute on function %s to anon', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
