import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Game, type PlayerColor, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { BulbIcon, ChipIcon, ClockIcon, GaugeIcon, PersonIcon, TrendIcon } from "../game/icons";
import { useBots } from "../hooks/useBots";
import { usePowers } from "../hooks/usePowers";
import { formatPowers, formatTimeControl } from "./format";
import { RecentGamesModal } from "./RecentGames";

const PRESETS = [
  { label: "3 min", initial: 180, increment: 0 },
  { label: "5 min", initial: 300, increment: 0 },
  { label: "10 min", initial: 600, increment: 0 },
] as const;

/** Who the game is against. "friend" produces a shareable invite link and a
 *  waiting room; "computer" produces a game that is already playable, because
 *  its opponent already exists. */
type Opponent = "friend" | "computer";

/** The difficulty a fresh visitor lands on — low enough to be a game rather
 *  than a demonstration. The catalog itself comes from the server. */
const DEFAULT_BOT_LEVEL = 2;

/** Charges of *each* power, per player, for the game about to be created.
 *  Fixed at creation time and shown to the joiner before they accept. The
 *  choices carry no copy of their own: the count is the whole label, and the
 *  "of each power" it used to spell out is the icon pair above the row. */
const POWER_CHOICES = [0, 1, 2, 3] as const;

const DEFAULT_POWERS = 1;

/** The side the creator takes; whoever joins — a friend or the engine — gets
 *  the other one. White is the default because it is what every game created
 *  before this picker existed used. */
const COLOR_CHOICES: readonly PlayerColor[] = ["white", "black"];

export function Lobby({ user, onOpenGame }: { user: User; onOpenGame: (gameID: string) => void }) {
  const { authorized } = useAuth();
  const powers = usePowers();
  const bots = useBots();
  const [opponent, setOpponent] = useState<Opponent>("friend");
  const [preset, setPreset] = useState<number>(1);
  const [botLevel, setBotLevel] = useState<number>(DEFAULT_BOT_LEVEL);
  const [powerCount, setPowerCount] = useState<number>(DEFAULT_POWERS);
  const [color, setColor] = useState<PlayerColor>("white");
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
  // The engine behind the powers is the same one the bots play on, so a
  // server without it offers neither. Unlike the power picker this can't fall
  // back to a lesser choice — there is simply no opponent — so the tab is
  // disabled outright rather than silently reinterpreted.
  const botsOffered = bots.status === "ready" && bots.available && bots.levels.length > 0;
  const chosenBot = bots.levels.find((level) => level.level === botLevel) ?? bots.levels[0];
  const playingComputer = opponent === "computer";

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

  /** Both opponents end on the same screen — a `/?game={id}` link — so the
   *  only difference is which endpoint writes the row and whether anyone has
   *  to join it afterwards. */
  async function startGame() {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const created = await authorized((token) =>
        playingComputer
          ? api.createBotGame(token, {
              initial_seconds: chosen.initial,
              increment_seconds: chosen.increment,
              level: chosenBot?.level ?? DEFAULT_BOT_LEVEL,
              powers_per_player: chosenPowers,
              color,
            })
          : api.createInvite(token, {
              initial_seconds: chosen.initial,
              increment_seconds: chosen.increment,
              powers_per_player: chosenPowers,
              color,
            }),
      );
      onOpenGame(created.id);
    } catch (cause) {
      const fallback = playingComputer
        ? "Could not start a game against the computer."
        : "Could not create an invite link.";
      setInviteError(cause instanceof ApiError ? cause.message : fallback);
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
        <h2 id="lobby-heading">{playingComputer ? "Play the computer." : "Invite a friend."}</h2>
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
              {playingComputer && chosenBot && (
                <>
                  <span>{chosenBot.name}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{formatTimeControl(chosen.initial, chosen.increment)}</span>
              <span aria-hidden="true">·</span>
              <span>as {color}</span>
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

          {/* Opponent first: it is the one choice that changes what the
              button at the bottom actually does. */}
          <div className="seg" role="group" aria-label="Opponent">
            <button
              type="button"
              className={playingComputer ? "seg-tab" : "seg-tab active"}
              aria-pressed={!playingComputer}
              onClick={() => setOpponent("friend")}
            >
              <PersonIcon />A friend
            </button>
            <button
              type="button"
              className={playingComputer ? "seg-tab active" : "seg-tab"}
              aria-pressed={playingComputer}
              disabled={!botsOffered}
              onClick={() => setOpponent("computer")}
            >
              <ChipIcon />
              The computer
            </button>
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

          {/* Which side the creator takes. The caption spells out the only
              consequence that isn't obvious from the word itself — who is on
              move when the game opens. */}
          <div className="field">
            <div className="field-head">
              <span className="field-label">Your side</span>
            </div>

            <div className="seg" role="group" aria-label="Your side">
              {COLOR_CHOICES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === color ? "seg-tab active" : "seg-tab"}
                  aria-pressed={option === color}
                  onClick={() => setColor(option)}
                >
                  {option === "white" ? "White" : "Black"}
                </button>
              ))}
            </div>

            <p className="field-foot">
              {color === "white"
                ? "You move first."
                : playingComputer
                  ? "The computer moves first."
                  : "Your opponent moves first."}
            </p>
          </div>

          {/* Difficulty, like powers below it, is a row of bare numbers: the
              level's own name and description do the talking underneath, and
              the chip carries the strength that number stands for. */}
          {playingComputer && (
            <div className="field">
              <div className="field-head">
                <span className="field-label">Difficulty</span>
                <span className="power-chips">
                  <span
                    className="power-chip"
                    title="Approximate strength"
                    aria-label={chosenBot ? `Rated about ${chosenBot.rating}` : "Strength unknown"}
                  >
                    <ChipIcon /> <b>{chosenBot?.rating ?? "—"}</b>
                  </span>
                </span>
              </div>

              <div className="count-row wide" role="group" aria-label="Difficulty level">
                {bots.levels.map((level) => (
                  <button
                    key={level.level}
                    type="button"
                    className={level.level === chosenBot?.level ? "count active" : "count"}
                    aria-pressed={level.level === chosenBot?.level}
                    aria-label={`${level.name}, rated about ${level.rating}`}
                    onClick={() => setBotLevel(level.level)}
                  >
                    {level.level}
                  </button>
                ))}
              </div>

              <p className="field-foot">{chosenBot?.description ?? "Loading opponents…"}</p>
            </div>
          )}

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

          <button type="button" className="cta" onClick={() => void startGame()} disabled={inviteBusy}>
            {playingComputer
              ? inviteBusy
                ? "Starting…"
                : `Play ${chosenBot?.name ?? "the computer"}`
              : inviteBusy
                ? "Creating…"
                : "Create invite link"}
          </button>

          {playingComputer && (
            <p className="field-foot centered">
              Games against the computer are unrated, and start the moment you press play.
            </p>
          )}
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
  // Either seat can be the viewer's own now, and the other one is empty while
  // an invite is still waiting — so this is nullable on both sides.
  const opponent = game.white?.id === viewerID ? game.black : game.white;

  return (
    <div className="active-game">
      <p className="section-number">In progress</p>
      <h3>{waiting ? "Your invite is open" : `Playing ${opponent?.display_name ?? "your opponent"}`}</h3>
      <p className="hint">
        {formatTimeControl(game.initial_seconds, game.increment_seconds)} · {formatPowers(game.powers_per_player)} ·{" "}
        {game.bot_level != null ? "unrated · " : ""}
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
