/** Short scores that need spelling out on hover. */
const MEANINGS: Record<string, string> = {
  DNF: "Did Not Finish",
};

/** A formatted score; abbreviations like "DNF" explain themselves on hover. */
export function Score({ text }: { text: string }) {
  const meaning = MEANINGS[text];
  return meaning ? (
    <abbr className="score-abbr" title={meaning}>
      {text}
    </abbr>
  ) : (
    <>{text}</>
  );
}
