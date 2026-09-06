import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Game, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { BulbIcon, ClockIcon, GaugeIcon, TrendIcon } from "../game/icons";
import { usePowers } from "../hooks/usePowers";
import { formatPowers, formatTimeControl } from "./format";
import { RecentGamesModal } from "./RecentGames";

const PRESETS = [
  { label: "3 min", initial: 180, increment: 0 },
  { label: "5 min", initial: 300, increment: 0 },
  { label: "10 min", initial: 600, increment: 0 },
] as const;

/** Charges of *each* power, per player, for the game about to be created.
 *  Fixed at creation time and shown to the joiner before they accept. The
 *  choices carry no copy of their own: the count is the whole label, and the
 *  "of each power" it used to spell out is the icon pair above the row. */
const POWER_CHOICES = [0, 1, 2, 3] as const;

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

      {active ? (
        <div className="panel">
          <ActiveGameCard game={active} viewerID={user.id} onOpenGame={onOpenGame} />
        </div>
      ) : (
        <div className="panel selector">
          {/* The heading carries a live read-out of the two choices below it,
              so the terms of the game are legible without re-reading the
              controls that set them. */}
          <div className="selector-head">
            <h3>New game</h3>
            <p className="selector-summary">
              <TrendIcon />
              <span>{formatTimeControl(chosen.initial, chosen.increment)}</span>
              <span aria-hidden="true">·</span>
              <span className="summary-powers">
                {chosenPowers === 0 ? (
                  "plain chess"
                ) : (
                  <>
                    {chosenPowers}× <BulbIcon /> <GaugeIcon />
                  </>
                )}
              </span>
            </p>
          </div>

          <div className="seg" role="group" aria-label="Time control">
            {PRESETS.map((option, index) => (
              <button
                key={option.label}
                type="button"
                className={index === preset ? "seg-tab active" : "seg-tab"}
                aria-pressed={index === preset}
                onClick={() => setPreset(index)}
              >
                {index === preset && <ClockIcon />}
                {option.label}
              </button>
            ))}
          </div>

          {/* Powers are a count, not a list: the icon pair above the row is
              what says "of each", so every choice is just its own number. */}
          <div className="field">
            <div className="field-head">
              <span className="field-label">Powers</span>
              <span className="power-chips">
                <span className="power-chip" title="Best move" aria-label={`Best move: ${chosenPowers} per player`}>
                  <BulbIcon /> <b>×{chosenPowers}</b>
                </span>
                <span className="power-chip" title="Evaluation" aria-label={`Evaluation: ${chosenPowers} per player`}>
                  <GaugeIcon /> <b>×{chosenPowers}</b>
                </span>
              </span>
            </div>

            <div className="count-row" role="group" aria-label="Charges of each power, per player">
              {POWER_CHOICES.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={count === chosenPowers ? "count active" : "count"}
                  aria-pressed={count === chosenPowers}
                  aria-label={count === 0 ? "No powers — plain chess" : `${count} of each power, per player`}
                  disabled={!powersOffered}
                  onClick={() => setPowerCount(count)}
                >
                  {count}
                </button>
              ))}
            </div>

            <p className="field-foot">
              {!powersOffered
                ? "No engine on this server — powers are unavailable."
                : chosenPowers === 0
                  ? "Plain chess — no engine help for either side."
                  : "One power per turn."}
            </p>
          </div>

          {inviteError && (
            <p className="error" role="alert">
              {inviteError}
            </p>
          )}

          <button type="button" className="cta" onClick={() => void createInvite()} disabled={inviteBusy}>
            {inviteBusy ? "Creating…" : "Create invite link"}
          </button>
        </div>
      )}
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
