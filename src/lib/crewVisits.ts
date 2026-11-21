/**
 * When you last opened each crew's page, so it can say who's joined since.
 * Kept in this browser, per account and per crew, like the game order.
 */
const visitKey = (userId: string, crewId: string) => `scrim-crew-visit:${userId}:${crewId}`;

/** When you last opened this crew here (ms), or null if you never have (or storage is blocked). */
export function lastCrewVisit(userId: string, crewId: string): number | null {
  try {
    const at = Number(localStorage.getItem(visitKey(userId, crewId)));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function recordCrewVisit(userId: string, crewId: string, at = Date.now()) {
  try {
    localStorage.setItem(visitKey(userId, crewId), String(at));
  } catch {
    // Storage blocked: every visit counts as the first, so nothing's announced.
  }
}

/**
 * Who joined after your last visit, oldest first: never you, and nobody on a
 * first visit (everyone would be "new").
 */
export function joinedSince<M extends { user_id: string; joined_at: string }>(
  members: M[],
  me: string | undefined,
  since: number | null,
): M[] {
  if (since === null) return [];
  return members
    .filter((m) => m.user_id !== me && new Date(m.joined_at).getTime() > since)
    .sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime());
}

/** "Sam", "Sam and Alex", "Sam, Alex and Jo", "Sam, Alex and 3 others". */
export function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
