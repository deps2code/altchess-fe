import { useState } from "react";
import { usePowers } from "../hooks/usePowers";
import { AuthPanel } from "../auth/AuthPanel";
import { useAuth } from "../auth/AuthProvider";
import { GameLink } from "../game/GameLink";
import { Lobby } from "../lobby/Lobby";

export function App() {
  const { state, signOut } = useAuth();
  const powers = usePowers();

  // The only client-side routing this app has: a shareable game link is
  // `/?game={id}`. Browser back/forward isn't wired to this state — an
  // accepted gap, not an oversight; a stale screen after Back is fixable
  // with a manual reload.
  const [gameLinkID, setGameLinkID] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("game"),
  );

  // `?invite={code}` prefills the sign-up form's invite code, for sharing a
  // registration invite as a link instead of dictating the code by hand.
  const [inviteCode] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("invite"),
  );

  function goToGame(id: string) {
    window.history.pushState({}, "", `/?game=${encodeURIComponent(id)}`);
    setGameLinkID(id);
  }

  function goToLobby() {
    window.history.pushState({}, "", "/");
    setGameLinkID(null);
  }

  const nav = (
    <nav aria-label="Primary navigation">
      <a className="brand" href="/" aria-label="Alternate Chess home">
        <span aria-hidden="true">♞</span> ALTCHESS
      </a>

      {state.status === "authenticated" ? (
        <span className="status">
          <i /> {state.user.display_name} · {state.user.rating}
          <button type="button" className="ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </span>
      ) : (
        <span className="status">
          <i /> Server authoritative
        </span>
      )}
    </nav>
  );

  return (
    <main>
      {state.status === "anonymous" ? (
        <div className="landing">
          {nav}
          <section className="hero photo">
            <div className="hero-copy">
              <div className="eyebrow">A new line of play</div>
              <h1>
                Chess, with
                <br />
                <span>one more</span>
                <br />
                decision.
              </h1>
              <p className="intro">
                The board stays honest. The clock keeps running. Limited powers let you ask for
                insight at exactly the right moment.
              </p>
            </div>
            <div className="glass-card">
              <AuthPanel initialInviteCode={inviteCode} />
            </div>
          </section>
        </div>
      ) : (
        <>
          {nav}
          {state.status === "loading" ? (
            <section className="hero">
              <p className="intro">Restoring your session…</p>
            </section>
          ) : gameLinkID ? (
            <GameLink gameID={gameLinkID} viewerID={state.user.id} onLeaveToLobby={goToLobby} />
          ) : (
            <Lobby user={state.user} onCreateInvite={goToGame} />
          )}
        </>
      )}

      <section className="powers" aria-labelledby="powers-heading">
        <div>
          <p className="section-number">02 / POWERS</p>
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
