import { useEffect, useRef, useState } from "react";
import { ApiError, api, type Game, type ClockFrame, type PublicUser } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { formatTimeControl } from "../lobby/format";
import { mountGameBoard, type BoardHandle } from "./board";
import { openGameConnection, type GameConnection } from "./connection";
import type { ErrorFrame, StateFrame } from "./protocol";

/** GameScreen only ever mounts once both players are known — a "waiting"
 *  invite gets its own screen (GameLink) instead. */
export type PlayableGame = Game & { black: PublicUser };

type LiveState = {
  turn: "white" | "black";
  ply: number;
  status: string;
  clocks: ClockFrame;
  result?: "white" | "black" | "draw";
  endReason?: string;
};

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function describeEnd(viewerColor: "white" | "black", live: LiveState): string {
  const reason: Record<string, string> = {
    checkmate: "Checkmate",
    stalemate: "Stalemate",
    draw: "Draw",
    resignation: "Resignation",
    timeout: "Time forfeit",
  };
  const label = reason[live.endReason ?? ""] ?? "Game over";
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
  const opponent = playingWhite ? game.black : game.white;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [clocksAt, setClocksAt] = useState(0);
  const [displayClocks, setDisplayClocks] = useState<ClockFrame>({ white_ms: 0, black_ms: 0 });
  const [wsError, setWsError] = useState<string | null>(null);
  const [abortBusy, setAbortBusy] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);

  const boardEl = useRef<HTMLDivElement | null>(null);
  const boardHandle = useRef<BoardHandle | null>(null);
  const connection = useRef<GameConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

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
          turn,
          ply,
          status: snapshot.status,
          clocks,
          result: snapshot.result,
          endReason: snapshot.end_reason,
        });
        setDisplayClocks(clocks);
        setClocksAt(Date.now());

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
                turn: frame.turn,
                ply: frame.ply,
                status: frame.status,
                clocks: frame.clocks,
                result: frame.result,
                endReason: frame.end_reason,
              });
              setDisplayClocks(frame.clocks);
              setClocksAt(Date.now());
              setWsError(null);
            },
            onError: (frame: ErrorFrame) => {
              setWsError(frame.message);
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
      connection.current?.close();
      connection.current = null;
      boardHandle.current?.destroy();
      boardHandle.current = null;
    };
    // Runs once per game id; viewerColor and authorized are stable for the
    // lifetime of a mounted GameScreen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

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

  function resign() {
    connection.current?.send({
      type: "resign",
      command_id: crypto.randomUUID(),
      expected_ply: live?.ply ?? 0,
    });
  }

  const finished = live?.status === "finished" || live?.status === "aborted";

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
              <button type="button" className="ghost" onClick={() => void abort()} disabled={abortBusy}>
                {abortBusy ? "Aborting…" : "Abort game"}
              </button>
            </>
          )}
          {finished && (
            <button type="button" className="ghost" onClick={onGameEnded}>
              Back to lobby
            </button>
          )}
        </span>
      </header>

      {(loadError ?? abortError ?? wsError) && (
        <p className="error abort-error" role="alert">
          {loadError ?? abortError ?? wsError}
        </p>
      )}

      <div className="board-stage">
        <div ref={boardEl} className="board-mount" />

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
            <div>
              <dt>White</dt>
              <dd>{formatClock(displayClocks.white_ms)}</dd>
            </div>
            <div>
              <dt>Black</dt>
              <dd>{formatClock(displayClocks.black_ms)}</dd>
            </div>
          </dl>

          {finished && live && (
            <p className="hint" role="status">
              {describeEnd(viewerColor, live)}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
