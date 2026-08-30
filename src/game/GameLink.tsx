import { useEffect, useState } from "react";
import { ApiError, api, type Game, type GameSnapshot } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { formatTimeControl } from "../lobby/format";
import { GameScreen, type PlayableGame } from "./GameScreen";

/** Mirrors useSeek's POLL_INTERVAL_MS — how often a waiting room checks
 *  whether someone has joined yet. */
const POLL_INTERVAL_MS = 2000;

/** Renders whatever a `/?game={id}` link currently points at: a waiting
 *  room for the creator, a join prompt for anyone else, the live/finished
 *  game once both players are known, or an "unavailable" message. There's
 *  no spectating — a third party who arrives after the invite is filled
 *  sees the same "not available" state as one arriving too late. */
export function GameLink({
  gameID,
  viewerID,
  onLeaveToLobby,
}: {
  gameID: string;
  viewerID: string;
  onLeaveToLobby: () => void;
}) {
  const { authorized } = useAuth();
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    authorized((token) => api.gameSnapshot(token, gameID, controller.signal))
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(cause instanceof ApiError ? cause.message : "Could not load this game.");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [gameID, authorized]);

  // Poll only while the creator is waiting for someone to join.
  useEffect(() => {
    if (snapshot?.status !== "waiting") {
      return;
    }
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      authorized((token) => api.gameSnapshot(token, gameID, controller.signal))
        .then((next) => setSnapshot(next))
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [snapshot?.status, gameID, authorized]);

  async function join() {
    setJoinBusy(true);
    setJoinError(null);
    try {
      const joined = await authorized((token) => api.joinGame(token, gameID));
      setSnapshot((prev) => (prev ? { ...prev, game: joined, status: joined.status } : prev));
    } catch (cause) {
      setJoinError(cause instanceof ApiError ? cause.message : "Could not join this game.");
    } finally {
      setJoinBusy(false);
    }
  }

  async function cancelInvite() {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await authorized((token) => api.abortGame(token, gameID));
      onLeaveToLobby();
    } catch (cause) {
      setCancelError(cause instanceof ApiError ? cause.message : "Could not cancel this invite.");
      setCancelBusy(false);
    }
  }

  if (loadError) {
    return <Unavailable message={loadError} onLeaveToLobby={onLeaveToLobby} />;
  }
  if (!snapshot) {
    return <Unavailable message={null} onLeaveToLobby={onLeaveToLobby} />;
  }

  const { game } = snapshot;

  if (snapshot.status === "waiting") {
    if (game.white.id === viewerID) {
      return (
        <WaitingRoom
          gameID={gameID}
          game={game}
          busy={cancelBusy}
          error={cancelError}
          onCancel={() => void cancelInvite()}
        />
      );
    }
    return <JoinPrompt game={game} busy={joinBusy} error={joinError} onJoin={() => void join()} />;
  }

  const isParticipant = game.white.id === viewerID || game.black?.id === viewerID;
  if (isParticipant && game.black) {
    const playable: PlayableGame = { ...game, black: game.black };
    return <GameScreen game={playable} viewerID={viewerID} onGameEnded={onLeaveToLobby} />;
  }

  return <Unavailable message="This game isn't available to you." onLeaveToLobby={onLeaveToLobby} />;
}

function Unavailable({ message, onLeaveToLobby }: { message: string | null; onLeaveToLobby: () => void }) {
  return (
    <section className="lobby">
      <div>
        <p className="section-number">01 / LOBBY</p>
        <h2>{message ? "Not available" : "Loading…"}</h2>
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
        <button type="button" className="ghost" onClick={onLeaveToLobby}>
          Back to lobby
        </button>
      </div>
    </section>
  );
}

function WaitingRoom({
  gameID,
  game,
  busy,
  error,
  onCancel,
}: {
  gameID: string;
  game: Game;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/?game=${encodeURIComponent(gameID)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the link is still selectable text.
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="waiting-heading">
        <span className="spinner-pawn" aria-hidden="true">
          ♟
        </span>
        <h3 id="waiting-heading">
          Waiting for an opponent<span className="dots" aria-hidden="true" />
        </h3>
        <p className="hint">
          {formatTimeControl(game.initial_seconds, game.increment_seconds)} · share this link — the first person
          who opens it while signed in joins as your opponent.
        </p>
        <label htmlFor="invite-link" className="hint">
          Invite link
        </label>
        <input id="invite-link" type="text" readOnly value={link} onFocus={(event) => event.target.select()} />
        <button type="button" className="pill outline" onClick={() => void copyLink()}>
          {copied ? "Copied" : "Copy link"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel invite"}
        </button>
      </div>
    </div>
  );
}

function JoinPrompt({
  game,
  busy,
  error,
  onJoin,
}: {
  game: Game;
  busy: boolean;
  error: string | null;
  onJoin: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="join-heading">
        <span className="spinner-pawn" aria-hidden="true">
          ♟
        </span>
        <h3 id="join-heading">{game.white.display_name} invited you to play</h3>
        <p className="hint">
          {formatTimeControl(game.initial_seconds, game.increment_seconds)} · @{game.white.username} ·{" "}
          {game.white.rating}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="pill" onClick={onJoin} disabled={busy}>
          {busy ? "Joining…" : "Join game"}
        </button>
      </div>
    </div>
  );
}
