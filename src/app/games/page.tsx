import type { Metadata } from "next";
import Link from "next/link";
import { SuggestGameButton } from "@/components/SuggestGame";
import { gameList } from "@/games/registry";

export const metadata: Metadata = { title: "Games — Scrim" };

/** Every game Scrim supports, credited to whoever makes it. */
export default function GamesPage() {
  const games = gameList();
  return (
    <article className="stack prose">
      <h1>Games</h1>
      <p>
        View the full list of the games that Scrim supports. We&apos;re always open to adding new games - feel free to suggest one{" "}
        <SuggestGameButton>here!</SuggestGameButton>
      </p>

      <ul>
        {games.map((g) => (
          <li key={g.id}>
            <a href={g.url} target="_blank" rel="noreferrer">
              {g.name}
            </a>{" "}
            by {g.source}
          </li>
        ))}
      </ul>

      <div className="back-home">
        <Link href="/" className="btn btn-primary">
          ← Back to Scrim
        </Link>
      </div>
    </article>
  );
}
