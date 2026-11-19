export type Profile = { id: string; display_name: string };

export type Crew = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type Lobby = {
  id: string;
  crew_id: string;
  game: string;
  puzzle_id: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  closes_at: string;
  closed_at: string | null;
  hide_until_submitted: boolean;
  allow_manual: boolean;
};

export type EntrySource = "paste" | "manual" | "extension";

export type BoardRow = {
  entry_id: string;
  user_id: string;
  display_name: string;
  submitted_at: string;
  source: EntrySource;
  /** Null while hidden by spoiler protection. */
  result: unknown | null;
  hidden: boolean;
};

export function isClosed(lobby: Lobby, now = Date.now()): boolean {
  return lobby.closed_at !== null || new Date(lobby.closes_at).getTime() <= now;
}

export function endedAt(lobby: Lobby): string {
  return lobby.closed_at ?? lobby.closes_at;
}
