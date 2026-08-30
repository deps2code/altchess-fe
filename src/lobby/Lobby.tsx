import { useState, type FormEvent } from "react";
import { ApiError, api, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { GameScreen, type PlayableGame } from "../game/GameScreen";
import { formatTimeControl } from "./format";
import { useSeek } from "./useSeek";

const PRESETS = [
  { label: "3 min", initial: 180, increment: 0 },
  { label: "5 min", initial: 300, increment: 0 },
  { label: "10 min", initial: 600, increment: 0 },
] as const;

const BANDS = [
  { label: "Within 100", value: 100 },
  { label: "Within 200", value: 200 },
  { label: "Within 500", value: 500 },
  { label: "Anyone", value: 2000 },
] as const;

export function Lobby({ user, onCreateInvite }: { user: User; onCreateInvite: (gameID: string) => void }) {
  const { authorized } = useAuth();
  const { result, error, busy, create, cancel, refresh } = useSeek();
  const [preset, setPreset] = useState<number>(1);
  const [band, setBand] = useState<number>(200);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const chosen = PRESETS[preset] ?? PRESETS[1];

  if (result.status === "matched" && result.game?.black) {
    const game: PlayableGame = { ...result.game, black: result.game.black };
    return <GameScreen game={game} viewerID={user.id} onGameEnded={() => void refresh()} />;
  }

  function findMatch(event: FormEvent) {
    event.preventDefault();
    void create({
      initial_seconds: chosen.initial,
      increment_seconds: chosen.increment,
      rating_band: band,
    });
  }

  async function createInvite() {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const invite = await authorized((token) =>
        api.createInvite(token, { initial_seconds: chosen.initial, increment_seconds: chosen.increment }),
      );
      onCreateInvite(invite.id);
    } catch (cause) {
      setInviteError(cause instanceof ApiError ? cause.message : "Could not create an invite link.");
      setInviteBusy(false);
    }
  }

  return (
    <>
      <section className="lobby" aria-labelledby="lobby-heading">
        <div>
          <p className="section-number">01 / LOBBY</p>
          <h2 id="lobby-heading">Find a match.</h2>
          <ProfileCard user={user} />
        </div>

        <div className="panel">
          <form onSubmit={findMatch}>
            <fieldset>
              <legend>Time control</legend>
              <div className="choices">
                {PRESETS.map((option, index) => (
                  <button
                    key={option.label}
                    type="button"
                    className={index === preset ? "choice active" : "choice"}
                    aria-pressed={index === preset}
                    onClick={() => setPreset(index)}
                  >
                    <strong>{option.label}</strong>
                    <span>{formatTimeControl(option.initial, option.increment)}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label htmlFor="band">Opponent rating</label>
            <select id="band" value={band} onChange={(event) => setBand(Number(event.target.value))}>
              {BANDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="hint">Both players have to accept the gap, so a wide range still waits for a willing opponent.</p>

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy}>
              {busy ? "Searching…" : "Find a match"} <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="hint">
            Or invite a specific person with the time control above — the first person who opens the link while
            signed in plays as your opponent.
          </p>
          {inviteError && (
            <p className="error" role="alert">
              {inviteError}
            </p>
          )}
          <button type="button" className="pill outline" onClick={() => void createInvite()} disabled={inviteBusy}>
            {inviteBusy ? "Creating…" : "Create invite link"}
          </button>
        </div>
      </section>

      {result.status === "pending" && (
        <SearchingModal
          timeControl={formatTimeControl(
            result.seek?.initial_seconds ?? chosen.initial,
            result.seek?.increment_seconds ?? chosen.increment,
          )}
          band={result.seek?.rating_band ?? band}
          busy={busy}
          onCancel={() => void cancel()}
        />
      )}
    </>
  );
}

function ProfileCard({ user }: { user: User }) {
  const played = user.wins + user.losses + user.draws;

  return (
    <div className="profile">
      <h3>{user.display_name}</h3>
      <p className="handle">@{user.username}</p>

      <dl>
        <div>
          <dt>Rating</dt>
          <dd>{user.rating}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd>
            {user.wins}–{user.losses}–{user.draws}
          </dd>
        </div>
        <div>
          <dt>Games</dt>
          <dd>{played}</dd>
        </div>
      </dl>
    </div>
  );
}

function SearchingModal({
  timeControl,
  band,
  busy,
  onCancel,
}: {
  timeControl: string;
  band: number;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="searching-heading">
        <span className="spinner-pawn" aria-hidden="true">
          ♟
        </span>
        <h3 id="searching-heading">
          Waiting for an opponent<span className="dots" aria-hidden="true" />
        </h3>
        <p className="hint">
          {timeControl} · within {band} rating points. You keep your place if you reload.
        </p>
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          Cancel search
        </button>
      </div>
    </div>
  );
}
