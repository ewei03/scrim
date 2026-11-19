import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const PLACEHOLDERS = ["your-project.supabase.co", "sb_publishable_..."];

/** False until .env.local has real values (not the .env.example placeholders). */
export const isConfigured = Boolean(
  url && key && !PLACEHOLDERS.some((p) => url.includes(p) || key === p),
);

/** Public project details, handed to the Chrome extension when connecting it. */
export function supabaseConfig() {
  if (!isConfigured) throw new Error("Supabase is not configured (see README).");
  return { supabaseUrl: url!, supabaseKey: key! };
}

let client: SupabaseClient | null = null;

/** Browser Supabase client. Created lazily so builds work without env vars. */
export function supabase(): SupabaseClient {
  if (!client) {
    if (!isConfigured) throw new Error("Supabase is not configured (see README).");
    client = createClient(url!, key!);
  }
  return client;
}

/** Call a Postgres function and throw its error message on failure. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function errorMessage(e: unknown): string {
  const raw =
    e instanceof Error
      ? e.message
      : e && typeof e === "object" && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(raw)) {
    return "Couldn't reach the server. Check your connection, or the Supabase URL in .env.local.";
  }
  if (/anonymous sign-ins are disabled/i.test(raw)) {
    return "Guest play isn't enabled yet: turn on anonymous sign-ins in Supabase → Authentication.";
  }
  return raw || "Something went wrong.";
}

