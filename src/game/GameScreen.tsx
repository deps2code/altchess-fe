import { useEffect, useRef, useState } from "react";
import { ApiError, api, type ClockFrame, type Game, type PowerID, type PublicUser } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { formatTimeControl } from "../lobby/format";
import { mountGameBoard, type BoardHandle } from "./board";
import { openGameConnection, type GameConnection } from "./connection";
import { EvalBar } from "./EvalBar";
import { evaluationForOutcome, formatEvaluation } from "./evaluation";
import {
  BoardIcon,
  BoltIcon,
  BulbIcon,
  CheckIcon,
  CloseIcon,
  FlaskIcon,
  GaugeIcon,
  HomeIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "./icons";
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
  try_move: "Try a move",
};

/** Display order for the powers panel. Which of these actually render is
 *  driven by key presence in `charges`, not this list — a game already in
 *  flight when a power shipped simply has no key for it. */
const POWER_ORDER: PowerID[] = ["best_move", "current_eval", "try_move"];

/** Icon-only mark for each power, used by the mobile picker's 3-wide grid —
 *  same lamp/dial/flask mapping as the aside's own copy. */
const POWER_ICONS: Record<PowerID, typeof BulbIcon> = {
  best_move: BulbIcon,
  current_eval: GaugeIcon,
  try_move: FlaskIcon,
};

const outcomeLabels: Record<"checkmate" | "stalemate" | "draw", string> = {
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  draw: "Draw",
};

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
  // to render because none are ever sent. Partial, not a full Record: a
  // power a game never had (added after it started) is a missing key, not a
  // zero — see api/client.ts's own comment on this same shape.
  const [charges, setCharges] = useState<Partial<Record<PowerID, number>> | null>(null);
  // One power per turn: the ply the viewer last spent a power at, or null.
  // Server state, mirrored — seeded from the snapshot and then only ever set
  // by a power_used frame, so a refused or refunded power never locks a turn
  // here either.
  const [powerUsedPly, setPowerUsedPly] = useState<number | null>(null);
  const [pendingPower, setPendingPower] = useState<PowerID | null>(null);
  const [powerResult, setPowerResult] = useState<PowerUsedFrame | null>(null);
  const [opponentUsedPower, setOpponentUsedPower] = useState(false);
  // Mobile-only: the aside's powers panel can scroll out of view on a narrow
  // screen, so a floating button opens the same choices as a small overlay
  // instead. Picking one closes it immediately — for try_move that's the
  // moment it arms, for the other two it's the moment the request is sent.
  const [powersModalOpen, setPowersModalOpen] = useState(false);

  // try_move's own state machine. armedPower is set the moment the button is
  // clicked, before anything is sent; candidateUCI/previewOpen track the
  // request from the moment a drag sends it (previewOpen stays true through
  // the wait for the engine and through the result, so "back to the current
  // position" is always available — never only once the answer lands).
  // tryMovePhase drives the eval bar's before → after sweep (see EvalBar).
  const [armedPower, setArmedPower] = useState<PowerID | null>(null);
  const [candidateUCI, setCandidateUCI] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tryMovePhase, setTryMovePhase] = useState<"before" | "after">("before");

  const boardEl = useRef<HTMLDivElement | null>(null);
  const boardHandle = useRef<BoardHandle | null>(null);
  const connection = useRef<GameConnection | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  // The command_id of the try_move request currently awaiting an answer, and
  // — set only if the player hits "back" before it arrives — the command_id
  // of one to treat as cancelled: its charge and turn lock still land for
  // real (the engine ran, the spend happened), but no preview reopens for a
  // candidate nobody is looking at anymore.
  const pendingCommandRef = useRef<string | null>(null);
  const cancelledCommandRef = useRef<string | null>(null);

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
        }, (uci, expectedPly) => {
          // A try_move candidate, armed by the powers panel: sent as a power
          // request rather than a move. previewOpen goes up immediately, not
          // once the answer lands, so "back to the current position" is
          // available for the whole wait.
          const commandID = crypto.randomUUID();
          pendingCommandRef.current = commandID;
          setArmedPower(null);
          setPendingPower("try_move");
          setPowerResult(null);
          setPreviewOpen(true);
          setCandidateUCI(uci);
          connection.current?.send({
            type: "use_power",
            command_id: commandID,
            expected_ply: expectedPly,
            power: "try_move",
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
              // A verdict belongs to the position it was asked about. An
              // authoritative frame always wins over a preview too — the
              // board's own applyState already tore it down; this is the
              // React-state half of the same reset (unconditional, since a
              // handler defined once at mount can't safely read the latest
              // previewOpen/armedPower to decide whether it's needed).
              setPowerResult(null);
              setArmedPower(null);
              setPreviewOpen(false);
              setCandidateUCI(null);
              pendingCommandRef.current = null;
              cancelledCommandRef.current = null;
            },
            onError: (frame: ErrorFrame) => {
              setWsError(frame.message);
              setPendingPower(null);
              setArmedPower(null);
              // A refund must snap the board back too, or a refused/refunded
              // try_move leaves a dead preview on screen. clearPreview is a
              // no-op when there was nothing to clear.
              boardHandle.current?.clearPreview();
              setPreviewOpen(false);
              setCandidateUCI(null);
              pendingCommandRef.current = null;
              cancelledCommandRef.current = null;
            },
            onPowerUsed: (frame: PowerUsedFrame) => {
              if (frame.power === "try_move" && frame.command_id === cancelledCommandRef.current) {
                // The player already hit "back" before this arrived. The
                // spend is real either way — apply the bookkeeping — but
                // nobody is looking at this candidate anymore, so no preview
                // reopens for it.
                cancelledCommandRef.current = null;
                setCharges((previous) => ({ ...(previous ?? {}), [frame.power]: frame.remaining }));
                setPendingPower(null);
                setPowerUsedPly(frame.ply);
                return;
              }

              setCharges((previous) => ({ ...(previous ?? {}), [frame.power]: frame.remaining }));
              setPendingPower(null);
              setPowerResult(frame);
              setPowerUsedPly(frame.ply);
              if (frame.power === "best_move" && frame.best_move) {
                boardHandle.current?.showHint(frame.best_move);
              }
              if (frame.power === "try_move") {
                setTryMovePhase("before");
                boardHandle.current?.showPreview(frame.after_fen ?? "", frame.candidate_uci ?? "");
                // Two rAFs guarantee an actual paint lands between the
                // "before" render (instant, no transition — see EvalBar) and
                // this one, which is what lets the height transition sweep
                // rather than jump straight to the after reading.
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => setTryMovePhase("after"));
                });
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
            onDisconnected: () => {
              // A reconnect rehydrates nothing on its own, so a preview the
              // client can no longer vouch for is discarded — the same
              // "back" the player could have chosen themselves, costing
              // nothing extra since the charge is already spent either way.
              boardHandle.current?.clearPreview();
              boardHandle.current?.armCandidate(false);
              setPreviewOpen(false);
              setCandidateUCI(null);
              setArmedPower(null);
              pendingCommandRef.current = null;
              cancelledCommandRef.current = null;
              setPendingPower((previous) => (previous === "try_move" ? null : previous));
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
    if (power === "try_move") {
      // Arms (or, clicked again, disarms) — nothing is sent and no charge is
      // touched until a drag actually produces a candidate.
      const next = armedPower === "try_move" ? null : "try_move";
      setArmedPower(next);
      boardHandle.current?.armCandidate(next === "try_move");
      return;
    }
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

  function playPreviewedMove() {
    if (!tryMoveResult) {
      return;
    }
    // The frame's own ply, not live?.ply: they agree in every case that can
    // reach this button, but this makes "this move, for the position it was
    // computed for" explicit, so a hypothetical mismatch fails as stale_ply
    // instead of silently applying somewhere else. Nothing is changed
    // locally — the preview already *is* the post-move position, so the
    // arriving state frame re-renders it authoritatively, real last-move
    // highlight included.
    connection.current?.send({
      type: "move",
      command_id: crypto.randomUUID(),
      expected_ply: tryMoveResult.ply,
      uci: tryMoveResult.candidate_uci ?? "",
    });
  }

  function backToPosition() {
    boardHandle.current?.clearPreview();
    boardHandle.current?.armCandidate(false);
    setPreviewOpen(false);
    setCandidateUCI(null);
    // Animates the bar back down to the pre-candidate reading — powerResult
    // is deliberately kept, so the readout stays up for the rest of the turn
    // (paid for, and the lock means there's no second try to spend it on).
    setTryMovePhase("before");
    if (pendingPower === "try_move") {
      // Still waiting on the engine: mark this request's answer as one to
      // apply silently rather than reopen a preview for.
      cancelledCommandRef.current = pendingCommandRef.current;
    }
    setPendingPower((previous) => (previous === "try_move" ? null : previous));
  }

  const tryMoveResult = powerResult?.power === "try_move" ? powerResult : null;
  // The eval bar reads the viewer's own last verdict: current_eval's single
  // reading, or try_move's before/after pair driven by tryMovePhase (an
  // ended candidate becomes a synthetic reading — see evaluationForOutcome).
  // A best_move result leaves the bar where it was, and the next state frame
  // clears powerResult and with it the bar either way.
  const evaluation =
    powerResult?.power === "current_eval"
      ? powerResult
      : tryMoveResult
        ? tryMovePhase === "before"
          ? { score_cp: tryMoveResult.score_cp, mate_in: tryMoveResult.mate_in }
          : tryMoveResult.after_outcome
            ? evaluationForOutcome(tryMoveResult.after_outcome, viewerColor)
            : { score_cp: tryMoveResult.after_score_cp, mate_in: tryMoveResult.after_mate_in }
        : null;
  // Only the try_move "before" reading is laid out with no transition — see
  // EvalBar's own doc comment on why that has to be a real, separately
  // tracked render rather than a value derived at the same instant the
  // "after" one is set.
  const evalInstant = tryMoveResult !== null && tryMovePhase === "before";
  const finished = live?.status === "finished" || live?.status === "aborted";
  const playable = live?.status === "pending" || live?.status === "live";
  const material = capturedMaterial(live?.fen ?? "");
  const advantage = viewerColor === "white" ? material.whiteAdvantage : -material.whiteAdvantage;
  const yourTurn = playable === true && live?.turn === viewerColor;
  const usedThisTurn = live !== null && powerUsedPly === live.ply;
  // Same key-presence filter the aside panel uses — a game already in flight
  // when a power shipped simply has no key for it.
  const availablePowers = charges ? POWER_ORDER.filter((power) => charges[power] !== undefined) : [];

  // Escape backs out of whatever is frontmost: an armed try_move, an open
  // preview, or — matching the click-outside dismissal below — the result.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (armedPower) {
        setArmedPower(null);
        boardHandle.current?.armCandidate(false);
        return;
      }
      if (previewOpen) {
        backToPosition();
        return;
      }
      if (finished && !resultDismissed) {
        setResultDismissed(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedPower, previewOpen, finished, resultDismissed]);

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
            {game.powers_per_player > 0 && (
              <EvalBar viewerColor={viewerColor} evaluation={evaluation} instant={evalInstant} />
            )}
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
              armedPower={armedPower}
              pending={pendingPower}
              previewOpen={previewOpen}
              candidateUCI={candidateUCI}
              result={powerResult}
              yourTurn={yourTurn}
              usedThisTurn={usedThisTurn}
              onUse={usePower}
              onPlay={playPreviewedMove}
              onBack={backToPosition}
            />
          )}

          {finished && live && (
            <p className="hint" role="status">
              {describeEnd(viewerColor, live)}
            </p>
          )}
        </aside>
      </div>

      {/* Mobile-only: the aside above can end up scrolled out of view on a
          narrow screen, so this floating button opens the same power choices
          as a small overlay instead. Hidden by CSS above the same breakpoint
          the aside already stacks at. */}
      {game.powers_per_player > 0 && charges && (
        <button
          type="button"
          className="icon-button powers-fab"
          title="Powers"
          aria-label="Open your powers"
          onClick={() => setPowersModalOpen(true)}
        >
          <BoltIcon />
        </button>
      )}

      {powersModalOpen && charges && (
        <div
          className="modal-backdrop soft"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPowersModalOpen(false);
            }
          }}
        >
          <div className="modal soft powers-modal" role="dialog" aria-modal="true" aria-labelledby="powers-modal-heading">
            <button type="button" className="modal-close" aria-label="Close" onClick={() => setPowersModalOpen(false)}>
              <span aria-hidden="true">×</span>
            </button>
            <p id="powers-modal-heading" className="section-number">
              Your powers
            </p>
            <div className="powers-grid">
              {availablePowers.map((power) => {
                const Icon = POWER_ICONS[power];
                const remaining = charges[power] ?? 0;
                return (
                  <button
                    key={power}
                    type="button"
                    className={armedPower === power ? "icon-button power-tile active" : "icon-button power-tile"}
                    disabled={!yourTurn || usedThisTurn || previewOpen || remaining <= 0 || pendingPower !== null}
                    title={`${powerLabels[power]} — ${remaining} left`}
                    aria-label={`${powerLabels[power]} — ${remaining} left`}
                    onClick={() => {
                      // Closes right away — for try_move that's the moment it
                      // arms (the board itself needs to be visible for the
                      // drag), for the other two it's the moment the request
                      // is sent.
                      usePower(power);
                      setPowersModalOpen(false);
                    }}
                  >
                    <Icon />
                    <span className="power-tile-count" aria-hidden="true">
                      {remaining}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Mobile-only: mirrors the aside's own "Drag a move to try it" label,
          which sits inside the powers panel and is what the FAB modal closes
          to reveal — but on a narrow screen that panel is scrolled away, so
          this floating reminder stays visible right below the board instead. */}
      {armedPower === "try_move" && !previewOpen && (
        <div className="try-move-hint-bar" role="status">
          <FlaskIcon />
          <span>Drag a move to try it</span>
        </div>
      )}

      {/* Mobile-only companion to the aside's own try-move confirm pair (same
          eval readout, same actions) — fixed to the bottom of the screen so
          both are visible without scrolling back up to the aside. */}
      {tryMoveResult && previewOpen && (
        <div className="try-move-confirm-bar" role="dialog" aria-modal="true" aria-label="Play the previewed move?">
          <p className="try-move-confirm-eval">
            <strong>{formatEvaluation(tryMoveResult)}</strong>
            {" → "}
            <strong>
              {tryMoveResult.after_outcome
                ? outcomeLabels[tryMoveResult.after_outcome]
                : formatEvaluation({ score_cp: tryMoveResult.after_score_cp, mate_in: tryMoveResult.after_mate_in })}
            </strong>
          </p>
          <div className="try-move-confirm-actions">
            <button
              type="button"
              className="icon-button small primary"
              title="Play this move"
              aria-label="Play this move"
              onClick={playPreviewedMove}
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              className="icon-button small"
              title="Back to the current position"
              aria-label="Back to the current position"
              onClick={backToPosition}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

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
                {/* A scorecard rather than the page's generic <dl> stats row:
                    that one lays out left-aligned and wraps to two ragged
                    lines inside a modal this narrow, which reads as a mistake
                    next to everything else here being centred. */}
                <div className="result-scores">
                  <ResultScore
                    player={game.white}
                    side="White"
                    change={live.whiteRatingChange}
                    won={live.result === "white"}
                  />
                  <ResultScore
                    player={game.black}
                    side="Black"
                    change={live.blackRatingChange}
                    won={live.result === "black"}
                  />
                </div>
                {/* A bot game is never rated, so neither side has a delta to
                    show; say so once rather than twice in the columns. */}
                {game.bot_level != null && <p className="hint result-note">Unrated · you played the engine</p>}
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

/** One column of the result modal's scorecard: who played that side, the
 *  rating they end the game on, and the delta that got them there. The delta
 *  is absent for a game that was never rated (a bot game), where the rating
 *  shown is simply the one that side came in with. */
function ResultScore({
  player,
  side,
  change,
  won,
}: {
  player: PublicUser;
  side: "White" | "Black";
  change: number | undefined;
  won: boolean;
}) {
  return (
    <div className={won ? "result-score won" : "result-score"}>
      <p className="result-side">{side}</p>
      <p className="result-player">{player.display_name}</p>
      <p className="result-rating">{player.rating + (change ?? 0)}</p>
      {change !== undefined && (
        <p className={change > 0 ? "result-change up" : change < 0 ? "result-change down" : "result-change"}>
          {change > 0 ? `+${change}` : change < 0 ? `−${Math.abs(change)}` : "±0"}
        </p>
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
  armedPower,
  pending,
  previewOpen,
  candidateUCI,
  result,
  yourTurn,
  usedThisTurn,
  onUse,
  onPlay,
  onBack,
}: {
  charges: Partial<Record<PowerID, number>>;
  /** Which power is armed and waiting for a drag — try_move only, but kept
   *  general the way `pending` already is. */
  armedPower: PowerID | null;
  pending: PowerID | null;
  /** True from the moment a try_move candidate is sent until it is played or
   *  discarded — spans both the wait for the engine and the result, since
   *  "back to the current position" is offered for the whole span. */
  previewOpen: boolean;
  candidateUCI: string | null;
  result: PowerUsedFrame | null;
  yourTurn: boolean;
  /** One power per turn, whichever power it is — the server refuses a second
   *  one at the same ply, so the panel does not offer it. */
  usedThisTurn: boolean;
  onUse: (power: PowerID) => void;
  onPlay: () => void;
  onBack: () => void;
}) {
  // Which powers to show is decided by key presence in charges, not this
  // fixed list — a game already in flight when a power shipped has no key
  // for it at all, and that is a different thing from having spent it all.
  const powers = POWER_ORDER.filter((power) => charges[power] !== undefined);
  const enabled = yourTurn && !usedThisTurn && !previewOpen;
  const tryMoveResult = result?.power === "try_move" ? result : null;

  return (
    <div className="powers-panel">
      <p className="section-number">Your powers</p>
      <div className="power-buttons">
        {powers.map((power) => {
          const remaining = charges[power] ?? 0;
          const armed = armedPower === power;
          return (
            <button
              key={power}
              type="button"
              className={armed ? "choice active" : "choice"}
              disabled={!enabled || remaining <= 0 || pending !== null}
              onClick={() => onUse(power)}
            >
              <strong>{powerLabels[power]}</strong>
              <span>{pending === power ? "Thinking…" : armed ? "Drag a move to try it" : `${remaining} left`}</span>
            </button>
          );
        })}
      </div>

      {result && result.power !== "try_move" && (
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

      {previewOpen &&
        (tryMoveResult ? (
          <div className="try-move-preview">
            <p className="power-result" role="status">
              <strong>{formatEvaluation(tryMoveResult)}</strong>
              {" → "}
              <strong>
                {tryMoveResult.after_outcome
                  ? outcomeLabels[tryMoveResult.after_outcome]
                  : formatEvaluation({ score_cp: tryMoveResult.after_score_cp, mate_in: tryMoveResult.after_mate_in })}
              </strong>
              {!tryMoveResult.after_outcome && " for White"}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="icon-button small primary"
                title="Play this move"
                aria-label="Play this move"
                onClick={onPlay}
              >
                <CheckIcon />
              </button>
              <button
                type="button"
                className="icon-button small"
                title="Back to the current position"
                aria-label="Back to the current position"
                onClick={onBack}
              >
                <CloseIcon />
              </button>
            </div>
            <p className="hint action-caption">Play this move · back to the current position</p>
          </div>
        ) : (
          <p className="try-move-preview hint" role="status">
            Thinking about {candidateUCI}…{" "}
            <button type="button" className="ghost" onClick={onBack}>
              Back
            </button>
          </p>
        ))}

      {!yourTurn && <p className="hint">Powers can only be used on your own turn.</p>}
      {yourTurn && usedThisTurn && !previewOpen && <p className="hint">One power per turn — make your move.</p>}
    </div>
  );
}
