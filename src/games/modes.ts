/**
 * Games with more than one mode (keep in sync with game_modes() in
 * supabase/migrations/0042_perceptle_minecraftdle_angledle.sql). Each mode is its own game (its own id,
 * rounds, scoring and rankings), but the crew page shows them as one game:
 * one switch in the Games box turns them all on or off, and a card, the
 * rankings and the archive each have a toggle between the modes'
 * leaderboards. The first mode is the main one: its id stands for the group
 * (in your card order, and which cards you've collapsed).
 */
export type ModeGroup = {
  name: string;
  modes: { id: string; label: string }[];
};

export const MODE_GROUPS: ModeGroup[] = [
  {
    name: "Costcodle",
    modes: [
      { id: "costcodle", label: "Checkout" },
      { id: "costcodleclassic", label: "Classic" },
    ],
  },
  {
    name: "Mini Crossword",
    modes: [
      { id: "minicrossword", label: "Easy" },
      { id: "minicrosswordhard", label: "Hard" },
    ],
  },
  {
    name: "Minecraftdle",
    modes: [
      { id: "minecraftdle", label: "Block" },
      { id: "minecraftdleitem", label: "Item" },
      { id: "minecraftdlemob", label: "Mob" },
    ],
  },
];

const byGame = new Map(MODE_GROUPS.flatMap((g) => g.modes.map((m) => [m.id, g] as const)));

/** The group a game is a mode of, if any. */
export function groupOf(gameId: string): ModeGroup | undefined {
  return byGame.get(gameId);
}

/** The id that stands for a game's group: its main mode, or the game itself. */
export function mainId(gameId: string): string {
  return groupOf(gameId)?.modes[0].id ?? gameId;
}

/** A mode's short label ("Classic"), or null for a game without modes. */
export function modeLabel(gameId: string): string | null {
  return groupOf(gameId)?.modes.find((m) => m.id === gameId)?.label ?? null;
}

/** The name for a game or its group: "Costcodle" for either of its modes. */
export function groupName(gameId: string, name: string): string {
  return groupOf(gameId)?.name ?? name;
}

/**
 * One item per game or group, in the order given (a group where its first
 * mode comes), each with the modes present in `items` (in the group's own
 * order).
 */
export function groupItems<T>(items: T[], idOf: (item: T) => string): { id: string; items: T[] }[] {
  const out: { id: string; items: T[] }[] = [];
  const at = new Map<string, number>();
  for (const item of items) {
    const id = mainId(idOf(item));
    const i = at.get(id);
    if (i === undefined) {
      at.set(id, out.length);
      out.push({ id, items: [item] });
    } else {
      out[i].items.push(item);
    }
  }
  for (const g of out) {
    const group = groupOf(g.id);
    if (group) {
      const rank = (item: T) => group.modes.findIndex((m) => m.id === idOf(item));
      g.items.sort((a, b) => rank(a) - rank(b));
    }
  }
  return out;
}

/** Which mode you last looked at for each group, kept in this browser. */
const modeKey = "scrim-game-mode";

export function savedModes(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(modeKey) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

export function saveMode(groupId: string, modeId: string) {
  try {
    localStorage.setItem(modeKey, JSON.stringify({ ...savedModes(), [groupId]: modeId }));
  } catch {
    // Storage blocked: it lasts this visit.
  }
}
