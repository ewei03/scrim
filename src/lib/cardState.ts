/**
 * Which of a crew's cards under Today you've expanded or collapsed, kept in
 * this browser (per account and crew). A game with nothing saved, like one
 * just added, shows expanded.
 */
const cardsKey = (userId: string, crewId: string) => `scrim-open-cards:${userId}:${crewId}`;

export function savedOpenCards(userId: string, crewId: string): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(cardsKey(userId, crewId)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, boolean] => typeof e[1] === "boolean"),
    );
  } catch {
    return {}; // Storage blocked or garbled: everything expanded.
  }
}

export function saveOpenCards(userId: string, crewId: string, cards: Record<string, boolean>) {
  try {
    localStorage.setItem(cardsKey(userId, crewId), JSON.stringify(cards));
  } catch {
    // Storage blocked: it lasts this visit.
  }
}
