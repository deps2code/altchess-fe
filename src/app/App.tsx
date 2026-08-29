import { usePowers } from "../hooks/usePowers";

export function App() {
  const powers = usePowers();

  return (
    <main>
      <nav aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="Alternate Chess home">
          <span aria-hidden="true">♞</span> ALTCHESS
        </a>
        <span className="status"><i /> Server authoritative</span>
      </nav>

      <section className="hero">
        <div className="eyebrow">A new line of play</div>
        <h1>Chess, with one more decision.</h1>
        <p className="intro">
          The board stays honest. The clock keeps running. Limited powers let you ask for insight at exactly the right moment.
        </p>
        <button type="button">Find a match <span aria-hidden="true">→</span></button>
      </section>

      <section className="powers" aria-labelledby="powers-heading">
        <div>
          <p className="section-number">01 / POWERS</p>
          <h2 id="powers-heading">Use them wisely.</h2>
        </div>

        <div className="power-list" aria-live="polite">
          {powers.status === "loading" && <p>Loading available powers…</p>}
          {powers.status === "error" && <p className="error">{powers.error}. Start the backend and try again.</p>}
          {powers.powers.map((power, index) => (
            <article key={power.id}>
              <span className="power-index">0{index + 1}</span>
              <div>
                <h3>{power.name}</h3>
                <p>{power.description}</p>
              </div>
              <span className="private">Private</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

