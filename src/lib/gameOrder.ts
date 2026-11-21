/**
 * The order you've dragged a crew's games into under Today. It's yours alone:
 * kept in this browser, per account and per crew.
 */
const orderKey = (userId: string, crewId: string) => `scrim-game-order:${userId}:${crewId}`;

export function savedGameOrder(userId: string, crewId: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(orderKey(userId, crewId)) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return []; // Storage blocked or garbled: the usual order.
  }
}

export function saveGameOrder(userId: string, crewId: string, ids: string[]) {
  try {
    localStorage.setItem(orderKey(userId, crewId), JSON.stringify(ids));
  } catch {
    // Storage blocked: the order lasts until the page is closed.
  }
}

/** Items in the saved order; ones it doesn't mention (games added since) go last, in their usual order. */
export function inSavedOrder<T>(items: T[], idOf: (item: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const at = (item: T) => rank.get(idOf(item)) ?? Infinity;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => at(a.item) - at(b.item) || a.i - b.i)
    .map(({ item }) => item);
}
