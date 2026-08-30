import { useState } from "react";
import { ApiError, api, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { formatTimeControl } from "./format";
import { RecentGamesModal } from "./RecentGames";

const PRESETS = [
  { label: "3 min", initial: 180, increment: 0 },
  { label: "5 min", initial: 300, increment: 0 },
  { label: "10 min", initial: 600, increment: 0 },
] as const;

export function Lobby({ user, onCreateInvite }: { user: User; onCreateInvite: (gameID: string) => void }) {
  const { authorized } = useAuth();
  const [preset, setPreset] = useState<number>(1);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const chosen = PRESETS[preset] ?? PRESETS[1];

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
    <section className="lobby" aria-labelledby="lobby-heading">
      <div>
        <p className="section-number">01 / LOBBY</p>
        <h2 id="lobby-heading">Invite a friend.</h2>
        <ProfileCard user={user} />
      </div>

      <div className="panel">
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

        <p className="hint">
          Share the link with a specific person — the first one who opens it while signed in plays as your
          opponent.
        </p>
        {inviteError && (
          <p className="error" role="alert">
            {inviteError}
          </p>
        )}
        <button type="button" onClick={() => void createInvite()} disabled={inviteBusy}>
          {inviteBusy ? "Creating…" : "Create invite link"} <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

function ProfileCard({ user }: { user: User }) {
  const played = user.wins + user.losses + user.draws;
  const [showGames, setShowGames] = useState(false);

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

      <button type="button" className="link" onClick={() => setShowGames(true)}>
        Recent games →
      </button>

      {showGames && <RecentGamesModal onClose={() => setShowGames(false)} />}
    </div>
  );
}
