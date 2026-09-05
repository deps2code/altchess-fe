import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Game, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { usePowers } from "../hooks/usePowers";
import { formatPowers, formatTimeControl } from "./format";
import { RecentGamesModal } from "./RecentGames";

const PRESETS = [
  { label: "3 min", initial: 180, increment: 0 },
  { label: "5 min", initial: 300, increment: 0 },
  { label: "10 min", initial: 600, increment: 0 },
] as const;

/** Charges of *each* power, per player, for the game about to be created.
 *  Fixed at creation time and shown to the joiner before they accept. */
const POWER_CHOICES = [
  { count: 0, label: "None", hint: "plain chess" },
  { count: 1, label: "1", hint: "of each power" },
  { count: 2, label: "2", hint: "of each power" },
  { count: 3, label: "3", hint: "of each power" },
] as const;

const DEFAULT_POWERS = 1;

export function Lobby({ user, onOpenGame }: { user: User; onOpenGame: (gameID: string) => void }) {
  const { authorized } = useAuth();
  const powers = usePowers();
  const [preset, setPreset] = useState<number>(1);
  const [powerCount, setPowerCount] = useState<number>(DEFAULT_POWERS);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // The one game this account is currently in, if any — an open invite of
  // their own or a game in progress. It survives signing in on a different
  // device, since it is server state rather than anything in this browser.
  const [active, setActive] = useState<Game | null>(null);

  const chosen = PRESETS[preset] ?? PRESETS[1];
  // A server with no engine configured can't honour any budget but zero, so
  // the picker is forced there rather than offering charges nothing can spend.
  const powersOffered = powers.status !== "ready" || powers.available;
  const chosenPowers = powersOffered ? powerCount : 0;

  const loadActive = useCallback(
    async (signal?: AbortSignal) => {
      // GET /seeks/me returns a game only for a waiting invite or a game in
      // progress; a parked seek carries no game, and a finished one reads as
      // "none".
      const current = await authorized((token) => api.currentSeek(token, signal));
      setActive(current.game);
    },
    [authorized],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadActive(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [loadActive]);

  async function createInvite() {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const invite = await authorized((token) =>
        api.createInvite(token, {
          initial_seconds: chosen.initial,
          increment_seconds: chosen.increment,
          powers_per_player: chosenPowers,
        }),
      );
      onOpenGame(invite.id);
    } catch (cause) {
      setInviteError(cause instanceof ApiError ? cause.message : "Could not create an invite link.");
      setInviteBusy(false);
      // A 409 here means a game was started elsewhere since this screen
      // loaded; re-reading it turns the refusal into a way back in.
      if (cause instanceof ApiError && cause.code === "already_in_game") {
        void loadActive().catch(() => undefined);
      }
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
        {active ? (
          <ActiveGameCard game={active} viewerID={user.id} onOpenGame={onOpenGame} />
        ) : (
          <>
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

            <fieldset>
              <legend>Powers</legend>
              <div className="choices">
                {POWER_CHOICES.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={option.count === chosenPowers ? "choice active" : "choice"}
                    aria-pressed={option.count === chosenPowers}
                    disabled={!powersOffered}
                    onClick={() => setPowerCount(option.count)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.hint}</span>
                  </button>
                ))}
              </div>
              {!powersOffered && (
                <p className="hint">
                  This server has no engine configured, so powers are unavailable — this game is plain chess.
                </p>
              )}
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
          </>
        )}
      </div>
    </section>
  );
}

/** Replaces the invite form while a game is already under way: one game at a
 *  time is a server rule, so offering a second one here would only produce a
 *  409. This is also the way back in after signing in on another device — the
 *  game link never had to be kept. */
function ActiveGameCard({
  game,
  viewerID,
  onOpenGame,
}: {
  game: Game;
  viewerID: string;
  onOpenGame: (gameID: string) => void;
}) {
  const waiting = game.status === "waiting";
  const opponent = game.white.id === viewerID ? game.black : game.white;

  return (
    <div className="active-game">
      <p className="section-number">In progress</p>
      <h3>{waiting ? "Your invite is open" : `Playing ${opponent?.display_name ?? "your opponent"}`}</h3>
      <p className="hint">
        {formatTimeControl(game.initial_seconds, game.increment_seconds)} · {formatPowers(game.powers_per_player)} ·{" "}
        {waiting
          ? "nobody has taken the link yet. Reopen it to share or cancel it."
          : "you can only be in one game at a time — finish or abort this one to start another."}
      </p>
      <button type="button" className="pill" onClick={() => onOpenGame(game.id)}>
        {waiting ? "Reopen your invite" : "Return to your game"} <span aria-hidden="true">→</span>
      </button>
    </div>
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
