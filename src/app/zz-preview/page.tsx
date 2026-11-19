// TEMPORARY visual preview: delete after checking.
export default function Preview() {
  const crews = [["Breakfast Club", 5], ["Work", 3], ["The Wordlers Guild of Ontario", 12]] as const;
  return (
    <div className="stack-lg">
      <section className="crew-plate">
        <p className="crew-plate-bar"><span>Crew</span><span>4 members</span></p>
        <div className="crew-plate-body">
          <div className="row between wrap"><h1>Breakfast Club</h1><button className="btn btn-small">⧉ Invite to crew</button></div>
          <ul className="member-chips">{["Enoch", "Sam", "Jo", "Priya"].map((n, i) => <li key={n} className={i === 0 ? "me" : undefined}>{n}</li>)}</ul>
        </div>
      </section>
      <section className="stack">
        <h2>Open lobbies</h2>
        <ul className="list list-live">
          <li><a className="list-row todo" href="#"><span><span className="live-dot">●</span><strong>Wordle #1,979</strong> <span className="muted">· Breakfast Club</span></span><span className="row"><span className="muted small">4h 12m left</span><span className="pill pill-hot">play</span></span></a></li>
          <li><a className="list-row" href="#"><span><span className="live-dot">●</span><strong>Wordle #1,979</strong> <span className="muted">· Work</span></span><span className="row"><span className="muted small">4h 12m left</span><span className="pill">✓ in</span></span></a></li>
        </ul>
      </section>
      <section className="stack">
        <h2>Your crews</h2>
        <ul className="crew-grid">
          {crews.map(([n, m]) => (
            <li key={n}><a href="#" className="crew-card"><span className="crew-name">{n}</span><span className="crew-meta"><span>{m} members</span><span>→</span></span></a></li>
          ))}
        </ul>
      </section>
      <section className="stack">
        <h2>Archive</h2>
        <ul className="list list-archive">
          {[["Wed, Nov 18", "1,978", "★ Enoch, Sam · 3/6"], ["Tue, Nov 17", "1,977", "★ Jo · 2/6"], ["Mon, Nov 16", "1,976", "no winner"]].map(([d, n, w]) => (
            <li key={n}><a className="list-row" href="#"><span className="archive-date">{d}</span><span>Wordle #{n}</span><span>{w}</span></a></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
