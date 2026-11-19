export function SetupNotice() {
  return (
    <div className="card stack">
      <h2>Almost there</h2>
      <p>
        Scrim needs a Supabase project. Copy <code>.env.example</code> to <code>.env.local</code>, fill in your
        project URL and publishable key, run the SQL in <code>supabase/migrations</code>, and restart the dev
        server. See the README for the full checklist.
      </p>
    </div>
  );
}
