import { rpc } from "@/lib/supabase";

/**
 * The order you've dragged a crew's games into under Today. It's yours alone:
 * saved on your account (per crew), with a copy in this browser so it shows
 * before the account's copy has loaded.
 */
const orderKey = (userId: string, crewId: string) => `scrim-game-order:${userId}:${crewId}`;

/** This browser's copy. */
export function savedGameOrder(userId: string, crewId: string): string[] {
  try {
    return asOrder(JSON.parse(localStorage.getItem(orderKey(userId, crewId)) ?? "[]"));
  } catch {
    return []; // Storage blocked or garbled: the usual order.
  }
}

function keepLocally(userId: string, crewId: string, ids: string[]) {
  try {
    localStorage.setItem(orderKey(userId, crewId), JSON.stringify(ids));
  } catch {
    // Storage blocked: the account's copy still has it.
  }
}

/** Saves a new order: in this browser straight away, and on your account. */
export function saveGameOrder(userId: string, crewId: string, ids: string[]) {
  keepLocally(userId, crewId, ids);
  rpc("set_game_order", { p_crew: crewId, p_games: ids }).catch(() => {
    // Offline or failed: this browser keeps it, and the next reorder tries again.
  });
}

/**
 * Brings this browser's copy in line with your account's (`games` from
 * game_orders, or null when there's none yet), and returns the order to use.
 * With none on the account yet, an order dragged here before orders were saved
 * on accounts is used, and saved there.
 */
export function syncGameOrder(userId: string, crewId: string, games: string[] | null): string[] {
  if (games === null) {
    const local = savedGameOrder(userId, crewId);
    if (local.length) saveGameOrder(userId, crewId, local);
    return local;
  }
  const order = asOrder(games);
  keepLocally(userId, crewId, order);
  return order;
}

function asOrder(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Whether games you've still to play go above the ones you've done (each
 * group in your order), kept in this browser per account and crew.
 */
const unplayedKey = (userId: string, crewId: string) => `scrim-unplayed-first:${userId}:${crewId}`;

export function savedUnplayedFirst(userId: string, crewId: string): boolean {
  try {
    return localStorage.getItem(unplayedKey(userId, crewId)) === "1";
  } catch {
    return false;
  }
}

export function saveUnplayedFirst(userId: string, crewId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(unplayedKey(userId, crewId), "1");
    else localStorage.removeItem(unplayedKey(userId, crewId));
  } catch {
    // Storage blocked: it lasts this visit.
  }
}

/** Items you've still to play first, then the rest, each group keeping its order. */
export function unplayedFirst<T>(items: T[], toPlay: (item: T) => boolean): T[] {
  return [...items.filter(toPlay), ...items.filter((item) => !toPlay(item))];
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
