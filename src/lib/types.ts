export type Profile = { id: string; display_name: string };

export type Crew = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  /**
   * The crew's day ends at midnight here (except games with their own zone).
   * Null for crews from before time zones existed, until the owner opens the
   * crew page and it's set to theirs.
   */
  timezone: string | null;
  hide_until_submitted: boolean;
  /** Guests (no Google account) can join with the invite link. */
  allow_guests: boolean;
  /** The invite link asks to join; the owner approves in Manage crew. */
  require_approval: boolean;
  /** When the owner last reset the rankings: they count only days that end after it. Null if never. */
  rankings_reset_at: string | null;
};

/** One crew's scoreboard for one daily puzzle. Started by the first result. */
export type Round = {
  id: string;
  crew_id: string;
  game: string;
  puzzle_id: string;
  closes_at: string;
  created_at: string;
};

export type EntrySource = "paste" | "extension";

export type BoardRow = {
  entry_id: string;
  user_id: string;
  display_name: string;
  is_guest: boolean;
  submitted_at: string;
  source: EntrySource;
  /** Null while hidden by spoiler protection. */
  result: unknown | null;
  hidden: boolean;
};

export function isClosed(round: Pick<Round, "closes_at">, now = Date.now()): boolean {
  return new Date(round.closes_at).getTime() <= now;
}
