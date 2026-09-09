import { useEffect, useRef, useState } from "react";
import { ApiError, api, type ClockFrame, type Game, type PowerID, type PublicUser } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { formatTimeControl } from "../lobby/format";
import { mountGameBoard, type BoardHandle } from "./board";
import { openGameConnection, type GameConnection } from "./connection";
import { EvalBar } from "./EvalBar";
import { formatEvaluation } from "./evaluation";
import { BoardIcon, HomeIcon, ThumbsDownIcon, ThumbsUpIcon } from "./icons";
import { capturedMaterial, PIECE_GLYPH, type CapturedPiece } from "./material";
import type { ErrorFrame, PowerUsedFrame, StateFrame } from "./protocol";

/** GameScreen only ever mounts once both players are known — a "waiting"
 *  invite gets its own screen (GameLink) instead. */
export type PlayableGame = Game & { white: PublicUser; black: PublicUser };

type LiveState = {
  fen: string;
  turn: "white" | "black";
  ply: number;
  status: string;
  clocks: ClockFrame;
  result?: "white" | "black" | "draw";
  endReason?: string;
  whiteRatingChange?: number;
  blackRatingChange?: number;
};

/** How long the opponent's "a power was used" toast stays up. It leaves
 *  nothing behind afterwards — no count, no tally, no post-game record. */
const NOTICE_MS = 3000;

/** Mirrors the server's own bound (lobby.MaxFeedbackLength) and the
 *  game_feedback CHECK constraint behind it. */
const FEEDBACK_MAX_CHARS = 255;

const endReasonLabels: Record<string, string> = {
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  draw: "Draw",
  resignation: "Resignation",
  timeout: "Time forfeit",
};

const powerLabels: Record<PowerID, string> = {
  best_move: "Best move",
  current_eval: "Evaluation",
};

/** A signed rating delta plus the rating it lands on, e.g. "1523 (+8)". */
function ratingCell(baseRating: number, change: number | undefined): string {
  if (change === undefined) {
    return `${baseRating}`;
  }
  const sign = change > 0 ? "+" : "";
  return `${baseRating + change} (${sign}${change})`;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function describeEnd(viewerColor: "white" | "black", live: LiveState): string {
  const label = endReasonLabels[live.endReason ?? ""] ?? "Game over";
  if (!live.result || live.result === "draw") {
    return `${label} — draw.`;
  }
  return live.result === viewerColor ? `${label} — you won.` : `${label} — you lost.`;
}

export function GameScreen({
  game,
  viewerID,
  onGameEnded,
}: {
  game: PlayableGame;
  viewerID: string;
  onGameEnded: () => void;
}) {
  const { authorized } = useAuth();
  const playingWhite = game.white.id === viewerID;
  const viewerColor: "white" | "black" = playingWhite ? "white" : "black";
  const opponentColor: "white" | "black" = playingWhite ? "black" : "white";
  const opponent = playingWhite ? game.black : game.white;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [clocksAt, setClocksAt] = useState(0);
  const [displayClocks, setDisplayClocks] = useState<ClockFrame>({ white_ms: 0, black_ms: 0 });
  const [wsError, setWsError] = useState<string | null>(null);
  const [abortBusy, setAbortBusy] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);
  // The result is an overlay the player can put away to look at the final
  // position, not a wall — the board stays behind it either way.
  const [resultDismissed, setResultDismissed] = useState(false);
  // A game runs in one session at a time. `replaced` means another device
  // took this one over; bumping `sessionEpoch` re-runs the connect effect and
  // takes it back.
  const [replaced, setReplaced] = useState(false);
  const [sessionEpoch, setSessionEpoch] = useState(0);

  // Post-game feedback. A thumbs up is acknowledged here and sent nowhere —
  // only a thumbs down opens the comment box, and only a comment is stored,
  // so the server never receives a rating field at all.
  const [feedbackRating, setFeedbackRating] = useState<"up" | "down" | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // The viewer's own remaining charges, seeded from the snapshot and then
  // only ever replaced by the server's own number on a power_used frame —
  // there is no client-side decrementing, and no opponent counts exist here
  // to render because none are ever sent.
  const [charges, setCharges] = useState<Record<PowerID, number> | null>(null);
  // One power per turn: the ply the viewer last spent a power at, or null.
  // Server state, mirrored — seeded from the snapshot and then only ever set
  // by a power_used frame, so a refused or refunded power never locks a turn
  // here either.
  const [powerUsedPly, setPowerUsedPly] = useState<number | null>(null);
  const [pendingPower, setPendingPower] = useState<PowerID | null>(null);
  const [powerResult, setPowerResult] = useState<PowerUsedFrame | null>(null);
  const [opponentUsedPower, setOpponentUsedPower] = useState(false);

  const boardEl = useRef<HTMLDivElement | null>(null);
  const boardHandle = useRef<BoardHandle | null>(null);
  const connection = useRef<GameConnection | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setReplaced(false);

    authorized((token) => api.gameSnapshot(token, game.id, controller.signal))
      .then((snapshot) => {
        if (cancelled || !boardEl.current) {
          return;
        }
        // GameScreen only ever mounts for a game that has actually started
        // (never "waiting" — GameLink handles that state itself), so these
        // are always present; the type is optional because the same wire
        // shape also covers a waiting invite with no board yet.
        const { fen, turn, ply = 0, clocks } = snapshot;
        if (fen === undefined || turn === undefined || clocks === undefined) {
          setLoadError("This game hasn't started yet.");
          return;
        }

        boardHandle.current = mountGameBoard(boardEl.current, viewerColor, {
          fen,
          turn,
          ply,
          status: snapshot.status,
          lastMove: snapshot.moves?.at(-1),
        }, (uci, expectedPly) => {
          connection.current?.send({
            type: "move",
            command_id: crypto.randomUUID(),
            expected_ply: expectedPly,
            uci,
          });
        });

        setLive({
          fen,
          turn,
          ply,
          status: snapshot.status,
          clocks,
          result: snapshot.result,
          endReason: snapshot.end_reason,
          whiteRatingChange: snapshot.white_rating_change,
          blackRatingChange: snapshot.black_rating_change,
        });
        setDisplayClocks(clocks);
        setClocksAt(Date.now());
        // This is what rehydrates the panel after a reload: the budget is
        // server state, not anything this browser remembers.
        setCharges(snapshot.powers?.remaining ?? null);
        setPowerUsedPly(snapshot.powers?.used_this_turn ? ply : null);

        connection.current = openGameConnection(
          game.id,
          () => authorized((token) => Promise.resolve(token)),
          {
            onState: (frame: StateFrame) => {
              boardHandle.current?.applyState({
                fen: frame.fen,
                turn: frame.turn,
                ply: frame.ply,
                status: frame.status,
                lastMove: frame.last_move,
              });
              setLive({
                fen: frame.fen,
                turn: frame.turn,
                ply: frame.ply,
                status: frame.status,
                clocks: frame.clocks,
                result: frame.result,
                endReason: frame.end_reason,
                whiteRatingChange: frame.white_rating_change,
                blackRatingChange: frame.black_rating_change,
              });
              setDisplayClocks(frame.clocks);
              setClocksAt(Date.now());
              setWsError(null);
              // A verdict belongs to the position it was asked about.
              setPowerResult(null);
            },
            onError: (frame: ErrorFrame) => {
              setWsError(frame.message);
              setPendingPower(null);
            },
            onPowerUsed: (frame: PowerUsedFrame) => {
              setCharges((previous) => ({ ...(previous ?? { best_move: 0, current_eval: 0 }), [frame.power]: frame.remaining }));
              setPendingPower(null);
              setPowerResult(frame);
              setPowerUsedPly(frame.ply);
              if (frame.power === "best_move" && frame.best_move) {
                boardHandle.current?.showHint(frame.best_move);
              }
            },
            onPowerNotice: () => {
              setOpponentUsedPower(true);
              window.clearTimeout(noticeTimer.current);
              noticeTimer.current = window.setTimeout(() => setOpponentUsedPower(false), NOTICE_MS);
            },
            onSessionReplaced: () => {
              setReplaced(true);
            },
          },
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(cause instanceof ApiError ? cause.message : "Could not load the game.");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(noticeTimer.current);
      connection.current?.close();
      connection.current = null;
      boardHandle.current?.destroy();
      boardHandle.current = null;
    };
    // Runs once per game id, and again on each sessionEpoch bump — taking a
    // displaced session back means re-reading the snapshot and reconnecting,
    // which is exactly this effect. viewerColor and authorized are stable for
    // the lifetime of a mounted GameScreen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, sessionEpoch]);

  // Cosmetic-only local tick between server messages; the server's own
  // clocks, delivered on every state frame, are what actually count.
  useEffect(() => {
    if (!live || (live.status !== "pending" && live.status !== "live")) {
      return;
    }
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - clocksAt;
      setDisplayClocks((previous) => {
        const next = { ...previous };
        if (live.turn === "white") {
          next.white_ms = Math.max(0, live.clocks.white_ms - elapsed);
        } else {
          next.black_ms = Math.max(0, live.clocks.black_ms - elapsed);
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [live, clocksAt]);

  async function abort() {
    setAbortBusy(true);
    setAbortError(null);
    try {
      await authorized((token) => api.abortGame(token, game.id));
      onGameEnded();
    } catch (cause) {
      setAbortError(cause instanceof ApiError ? cause.message : "Could not abort the game.");
      setAbortBusy(false);
    }
  }

  async function sendFeedback() {
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      await authorized((token) => api.submitFeedback(token, game.id, feedbackComment.trim()));
      setFeedbackSent(true);
      setFeedbackOpen(false);
    } catch (cause) {
      setFeedbackError(cause instanceof ApiError ? cause.message : "Could not send your feedback.");
    } finally {
      setFeedbackBusy(false);
    }
  }

  function resign() {
    connection.current?.send({
      type: "resign",
      command_id: crypto.randomUUID(),
      expected_ply: live?.ply ?? 0,
    });
  }

  function usePower(power: PowerID) {
    setPendingPower(power);
    setPowerResult(null);
    boardHandle.current?.showHint(null);
    connection.current?.send({
      type: "use_power",
      command_id: crypto.randomUUID(),
      expected_ply: live?.ply ?? 0,
      power,
    });
  }

  // The eval bar reads the viewer's own last `current_eval` verdict, and
  // nothing else: a `best_move` result leaves it where it was, and the next
  // state frame clears `powerResult` and with it the bar.
  const evaluation = powerResult?.power === "current_eval" ? powerResult : null;
  const finished = live?.status === "finished" || live?.status === "aborted";
  const playable = live?.status === "pending" || live?.status === "live";
  const material = capturedMaterial(live?.fen ?? "");
  const advantage = viewerColor === "white" ? material.whiteAdvantage : -material.whiteAdvantage;

  // Escape puts the result away, matching the click-outside dismissal below.
  useEffect(() => {
    if (!finished || resultDismissed) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setResultDismissed(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finished, resultDismissed]);

  return (
    <div className="game-screen">
      <header>
        <a className="brand" href="/" aria-label="Alternate Chess home">
          <span aria-hidden="true">♞</span> ALTCHESS
        </a>
        <span className="status">
          <i /> Game {game.id.slice(0, 8)}
          {!finished && (
            <>
              <button type="button" className="ghost" onClick={resign} disabled={!live}>
                Resign
              </button>
              {/* Abort is only available until the first move is played —
                  after that the game counts, and resignation is the only way
                  out. The server enforces this; hiding the button just keeps
                  the UI from offering something that would fail. */}
              {live?.ply === 0 && (
                <button type="button" className="ghost" onClick={() => void abort()} disabled={abortBusy}>
                  {abortBusy ? "Aborting…" : "Abort game"}
                </button>
              )}
            </>
          )}
          {finished && (
            <>
              {resultDismissed && (
                <button type="button" className="ghost" onClick={() => setResultDismissed(false)}>
                  Show result
                </button>
              )}
              <button type="button" className="ghost" onClick={onGameEnded}>
                Back to lobby
              </button>
            </>
          )}
        </span>
      </header>

      {(loadError ?? abortError ?? wsError) && (
        <p className="error abort-error" role="alert">
          {loadError ?? abortError ?? wsError}
        </p>
      )}

      <div className="board-stage">
        <div className="board-column">
          {/* The opponent sits above the board and the viewer below it, the
              way the pieces themselves are laid out from here. */}
          <PlayerBar
            player={opponent}
            color={opponentColor}
            clockMS={opponentColor === "white" ? displayClocks.white_ms : displayClocks.black_ms}
            onMove={playable && live?.turn === opponentColor}
            captured={opponentColor === "white" ? material.byWhite : material.byBlack}
            advantage={-advantage}
          />

          <div className="board-row">
            <div ref={boardEl} className="board-mount" />
            {/* Only for a match that agreed to powers at all — a rail that
                appeared with the first verdict would resize the board
                mid-game. */}
            {game.powers_per_player > 0 && <EvalBar viewerColor={viewerColor} evaluation={evaluation} />}
          </div>

          <PlayerBar
            player={playingWhite ? game.white : game.black}
            color={viewerColor}
            clockMS={viewerColor === "white" ? displayClocks.white_ms : displayClocks.black_ms}
            onMove={playable && live?.turn === viewerColor}
            captured={viewerColor === "white" ? material.byWhite : material.byBlack}
            advantage={advantage}
          />

          {opponentUsedPower && (
            <p className="power-toast" role="status">
              Your opponent used a power
            </p>
          )}
        </div>

        <aside className="board-side">
          <p className="section-number">{finished ? "Result" : "Opponent"}</p>
          <h3>{opponent.display_name}</h3>
          <p className="handle">
            @{opponent.username} · {opponent.rating}
          </p>

          <dl>
            <div>
              <dt>You play</dt>
              <dd>{playingWhite ? "White" : "Black"}</dd>
            </div>
            <div>
              <dt>Time control</dt>
              <dd>{formatTimeControl(game.initial_seconds, game.increment_seconds)}</dd>
            </div>
          </dl>

          {game.powers_per_player > 0 && charges && (
            <PowersPanel
              charges={charges}
              pending={pendingPower}
              result={powerResult}
              yourTurn={playable === true && live?.turn === viewerColor}
              usedThisTurn={live !== null && powerUsedPly === live.ply}
              onUse={usePower}
            />
          )}

          {finished && live && (
            <p className="hint" role="status">
              {describeEnd(viewerColor, live)}
            </p>
          )}
        </aside>
      </div>

      {/* If the game ended while this session was displaced, the result is
          the thing worth showing — there is nothing left to take back. */}
      {replaced && !finished && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="replaced-heading">
            <span className="result-icon" aria-hidden="true">
              ♟
            </span>
            <h3 id="replaced-heading">Playing somewhere else</h3>
            <p className="hint">
              This game was opened in another window or on another device. One session plays at a time —
              continuing here will disconnect that one.
            </p>
            <button type="button" className="pill" onClick={() => setSessionEpoch((epoch) => epoch + 1)}>
              Play here instead
            </button>
            <button type="button" className="ghost" onClick={onGameEnded}>
              Back to lobby
            </button>
          </div>
        </div>
      )}

      {finished && live && !resultDismissed && (
        <div
          className="modal-backdrop soft"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setResultDismissed(true);
            }
          }}
        >
          <div className="modal soft" role="dialog" aria-modal="true" aria-labelledby="result-heading">
            <button
              type="button"
              className="modal-close"
              aria-label="Close the result and show the final position"
              onClick={() => setResultDismissed(true)}
            >
              <span aria-hidden="true">×</span>
            </button>
            <span className="result-icon" aria-hidden="true">
              ♚
            </span>
            {live.status === "aborted" ? (
              <h3 id="result-heading">Game aborted</h3>
            ) : (
              <>
                <h3 id="result-heading">
                  {!live.result || live.result === "draw"
                    ? "Draw"
                    : `${(live.result === "white" ? game.white : game.black).display_name} wins`}
                </h3>
                <p className="hint">
                  {live.result && live.result !== "draw" && `${live.result === "white" ? "White" : "Black"} · `}
                  {endReasonLabels[live.endReason ?? ""] ?? "Game over"}
                </p>
                <dl>
                  <div>
                    <dt>{game.white.display_name} · White</dt>
                    <dd>{ratingCell(game.white.rating, live.whiteRatingChange)}</dd>
                  </div>
                  <div>
                    <dt>{game.black.display_name} · Black</dt>
                    <dd>{ratingCell(game.black.rating, live.blackRatingChange)}</dd>
                  </div>
                </dl>
              </>
            )}
            {/* Icon-only and side by side: leave, or stay and look at the
                final position. Reviewing is the same dismissal the close
                button and the backdrop click already do. */}
            <div className="modal-actions">
              <button
                type="button"
                className="icon-button primary"
                title="Back to lobby"
                aria-label="Back to lobby"
                onClick={onGameEnded}
              >
                <HomeIcon />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Review the position"
                aria-label="Review the position"
                onClick={() => setResultDismissed(true)}
              >
                <BoardIcon />
              </button>
            </div>
            <p className="hint action-caption">Back to lobby · review the position</p>

            <div className="feedback">
              <p className="section-number">How was this game?</p>
              <div className="modal-actions">
                <button
                  type="button"
                  className={feedbackRating === "up" ? "icon-button small active" : "icon-button small"}
                  title="Good game"
                  aria-label="Good game"
                  aria-pressed={feedbackRating === "up"}
                  disabled={feedbackSent}
                  onClick={() => {
                    setFeedbackRating("up");
                    setFeedbackOpen(false);
                  }}
                >
                  <ThumbsUpIcon />
                </button>
                <button
                  type="button"
                  className={feedbackRating === "down" ? "icon-button small active" : "icon-button small"}
                  title="Something was wrong"
                  aria-label="Something was wrong"
                  aria-pressed={feedbackRating === "down"}
                  disabled={feedbackSent}
                  onClick={() => {
                    setFeedbackRating("down");
                    setFeedbackError(null);
                    setFeedbackOpen(true);
                  }}
                >
                  <ThumbsDownIcon />
                </button>
              </div>
              <p className="hint action-caption" role="status">
                {feedbackSent
                  ? "Thanks — your note was sent."
                  : feedbackRating === "up"
                    ? "Glad it was a good one."
                    : "A thumbs down asks for a short note."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Only the thumbs-down path collects anything, and it is the only
          thing this app stores about a finished game beyond the result. */}
      {feedbackOpen && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="feedback-heading">
            <button
              type="button"
              className="modal-close"
              aria-label="Close without sending feedback"
              onClick={() => {
                setFeedbackOpen(false);
                setFeedbackRating(null);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
            <h3 id="feedback-heading">What went wrong?</h3>
            <p className="hint">A sentence or two is plenty. Nothing is sent unless you send it.</p>
            <label htmlFor="feedback-comment" className="hint">
              Your note
            </label>
            <textarea
              id="feedback-comment"
              value={feedbackComment}
              maxLength={FEEDBACK_MAX_CHARS}
              onChange={(event) => setFeedbackComment(event.target.value)}
            />
            <p className="char-count">
              {feedbackComment.length}/{FEEDBACK_MAX_CHARS}
            </p>
            {feedbackError && (
              <p className="error" role="alert">
                {feedbackError}
              </p>
            )}
            <button
              type="button"
              className="pill"
              disabled={feedbackBusy || feedbackComment.trim() === ""}
              onClick={() => void sendFeedback()}
            >
              {feedbackBusy ? "Sending…" : "Send feedback"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One side's name plate: who they are, their clock, and what they have
 *  captured so far. Rendered for both players, above and below the board. */
function PlayerBar({
  player,
  color,
  clockMS,
  onMove,
  captured,
  advantage,
}: {
  player: PublicUser;
  color: "white" | "black";
  clockMS: number;
  onMove: boolean;
  captured: CapturedPiece[];
  advantage: number;
}) {
  return (
    <div className="player-bar">
      <div className="player-identity">
        <p className="player-name">
          <span className={`player-color ${color}`} aria-hidden="true">
            ●
          </span>
          {player.display_name} <span className="player-handle">@{player.username} · {player.rating}</span>
        </p>
        <p className="captured" aria-label={`Pieces captured by ${player.display_name}`}>
          {captured.map((piece, index) => (
            <span key={`${piece.role}-${index}`} className={`captured-piece ${piece.color}`} aria-hidden="true">
              {PIECE_GLYPH[piece.role]}
            </span>
          ))}
          {advantage > 0 && <span className="material-lead">+{advantage}</span>}
        </p>
      </div>
      <span className={onMove ? "player-clock ticking" : "player-clock"}>{formatClock(clockMS)}</span>
    </div>
  );
}

/** The viewer's own power budget. Nothing about the opponent's is rendered,
 *  because nothing about it is ever sent. */
function PowersPanel({
  charges,
  pending,
  result,
  yourTurn,
  usedThisTurn,
  onUse,
}: {
  charges: Record<PowerID, number>;
  pending: PowerID | null;
  result: PowerUsedFrame | null;
  yourTurn: boolean;
  /** One power per turn, whichever power it is — the server refuses a second
   *  one at the same ply, so the panel does not offer it. */
  usedThisTurn: boolean;
  onUse: (power: PowerID) => void;
}) {
  const powers: PowerID[] = ["best_move", "current_eval"];
  const enabled = yourTurn && !usedThisTurn;

  return (
    <div className="powers-panel">
      <p className="section-number">Your powers</p>
      <div className="power-buttons">
        {powers.map((power) => {
          const remaining = charges[power] ?? 0;
          return (
            <button
              key={power}
              type="button"
              className="choice"
              disabled={!enabled || remaining <= 0 || pending !== null}
              onClick={() => onUse(power)}
            >
              <strong>{powerLabels[power]}</strong>
              <span>
                {pending === power ? "Thinking…" : `${remaining} left`}
              </span>
            </button>
          );
        })}
      </div>

      {result && (
        <p className="power-result" role="status">
          {result.power === "best_move" ? (
            <>
              Play <strong>{result.best_move}</strong>
            </>
          ) : (
            <>
              <strong>{formatEvaluation(result)}</strong> for White
            </>
          )}
        </p>
      )}
      {!yourTurn && <p className="hint">Powers can only be used on your own turn.</p>}
      {yourTurn && usedThisTurn && <p className="hint">One power per turn — make your move.</p>}
    </div>
  );
}
