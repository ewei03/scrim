import type { GameAdapter } from "@/games/types";
import { dateIn, nextMidnightIn } from "./time";
import type { Crew } from "./types";

/** The time zone a crew's day runs on for this game. */
export function roundZone(game: GameAdapter<unknown>, crew: Pick<Crew, "timezone">): string {
  return game.zone ?? crew.timezone ?? "UTC";
}

/** The puzzle a crew is playing today. Matches the server's round deadlines. */
export function crewPuzzle(game: GameAdapter<unknown>, crew: Pick<Crew, "timezone">, now = new Date()): string {
  return game.puzzleForDate(dateIn(roundZone(game, crew), now));
}

/** When the crew's current day ends for this game. */
export function crewDeadline(game: GameAdapter<unknown>, crew: Pick<Crew, "timezone">, now = new Date()): Date {
  return nextMidnightIn(roundZone(game, crew), now);
}

/** The browser's time zone, for new crews. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
