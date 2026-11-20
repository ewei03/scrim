import type { GameAdapter } from "@/games/types";

/** Sets `--game` to the game's colour for everything inside. */
export function gameStyle(game: GameAdapter<unknown>): React.CSSProperties {
  return { "--game": game.color } as React.CSSProperties;
}

/** The game's name on its colour, so games are easy to tell apart in lists. */
export function GameTag({ game }: { game: GameAdapter<unknown> }) {
  return (
    <span className="game-tag" style={gameStyle(game)}>
      {game.name}
    </span>
  );
}
