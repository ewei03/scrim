/**
 * Cleans pasted share text before a game parses it: drops emoji variation
 * selectors, and turns chat shortcodes (":green_square:" from Discord,
 * ":large_green_square:" from Slack) back into the squares they stand for, so
 * those pastes get the same strict checks as the real thing.
 */
export function normalizeShareText(text: string): string {
  const squares: Record<string, string> = {
    green: "🟩",
    yellow: "🟨",
    blue: "🟦",
    purple: "🟪",
    orange: "🟧",
    white: "⬜",
    black: "⬛",
  };
  return text
    .replace(/️/g, "")
    .replace(/:(?:large_)?(green|yellow|blue|purple|orange|white|black)(?:_large)?_square:/gi, (_, colour: string) =>
      squares[colour.toLowerCase()],
    );
}

/**
 * The grid rows after a share's header: every line that has any of `tiles` on
 * it. They must be together (one block), and each must be made of tiles and
 * nothing else (spaces aside). Returns the rows as arrays of tile characters.
 */
export function gridRows(
  afterHeader: string,
  tiles: ReadonlySet<string>,
): { ok: true; rows: string[][] } | { ok: false; error: string } {
  const lines = afterHeader.split(/\r?\n/);
  const rows: string[][] = [];
  let ended = false;
  for (const line of lines) {
    const chars = Array.from(line.replace(/\s/g, ""));
    const hasTile = chars.some((c) => tiles.has(c));
    if (!hasTile) {
      if (rows.length) ended = true;
      continue;
    }
    if (ended) return { ok: false, error: "The grid should be one block of rows, with nothing between them." };
    if (!chars.every((c) => tiles.has(c))) {
      return { ok: false, error: `Row ${rows.length + 1} of the grid has something other than squares in it.` };
    }
    rows.push(chars);
  }
  return { ok: true, rows };
}
