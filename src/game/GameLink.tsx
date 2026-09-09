import { useEffect, useState } from "react";
import { ApiError, api, type Game, type GameSnapshot, type PublicUser } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { formatPowers, formatTimeControl } from "../lobby/format";
import { CheckIcon, CloseIcon, CopyIcon } from "./icons";
import { GameScreen, type PlayableGame } from "./GameScreen";

/** How often a waiting room checks whether someone has joined yet. */
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
    // While nobody has joined, the one filled seat is the creator's —
    // whichever colour they picked. Neither seat being filled is impossible
    // (the games_has_a_creator constraint), so it reads as unavailable.
    const creator = game.white ?? game.black;
    if (!creator) {
      return <Unavailable message="This game isn't available to you." onLeaveToLobby={onLeaveToLobby} />;
    }
    if (creator.id === viewerID) {
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
    return (
      <JoinPrompt
        game={game}
        creator={creator}
        busy={joinBusy}
        error={joinError}
        onJoin={() => void join()}
        onLeaveToLobby={onLeaveToLobby}
      />
    );
  }

  const isParticipant = game.white?.id === viewerID || game.black?.id === viewerID;
  if (isParticipant && game.white && game.black) {
    const playable: PlayableGame = { ...game, white: game.white, black: game.black };
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
          {formatTimeControl(game.initial_seconds, game.increment_seconds)} ·{" "}
          {formatPowers(game.powers_per_player)} · you play {game.white ? "white" : "black"} · share this link —
          the first person who opens it while signed in joins as your opponent.
        </p>
        <label htmlFor="invite-link" className="hint">
          Invite link
        </label>
        <input id="invite-link" type="text" readOnly value={link} onFocus={(event) => event.target.select()} />
        {/* Icon-only, side by side: copying the link and abandoning the
            invite are the only two things this screen can do, and the
            accessible name lives on the button rather than in visible text. */}
        <div className="modal-actions">
          <button
            type="button"
            className="icon-button primary"
            title={copied ? "Copied" : "Copy link"}
            aria-label={copied ? "Invite link copied" : "Copy invite link"}
            onClick={() => void copyLink()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button
            type="button"
            className="icon-button danger"
            title="Cancel invite"
            aria-label="Cancel invite"
            onClick={onCancel}
            disabled={busy}
          >
            <CloseIcon />
          </button>
        </div>
        <p className="hint action-caption" role="status">
          {busy ? "Cancelling…" : copied ? "Link copied" : "Copy the link · cancel the invite"}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function JoinPrompt({
  game,
  creator,
  busy,
  error,
  onJoin,
  onLeaveToLobby,
}: {
  game: Game;
  /** The one filled seat of a waiting invite — passed in rather than derived
   *  again here, since the caller has already narrowed it. */
  creator: PublicUser;
  busy: boolean;
  error: string | null;
  onJoin: () => void;
  onLeaveToLobby: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="join-heading">
        <span className="spinner-pawn" aria-hidden="true">
          ♟
        </span>
        <h3 id="join-heading">{creator.display_name} invited you to play</h3>
        {/* The power budget and the creator's colour are both fixed already,
            so this is what the joiner is agreeing to — shown before they
            accept, not after. */}
        <p className="hint">
          {formatTimeControl(game.initial_seconds, game.increment_seconds)} ·{" "}
          {formatPowers(game.powers_per_player)} · you play {game.white ? "black" : "white"} · @
          {creator.username} · {creator.rating}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="pill" onClick={onJoin} disabled={busy}>
          {busy ? "Joining…" : "Join game"}
        </button>
        {/* A refused join is usually "you are already in a game"; the lobby is
            where the way back into that one is. */}
        {error && (
          <button type="button" className="ghost" onClick={onLeaveToLobby}>
            Back to lobby
          </button>
        )}
      </div>
    </div>
  );
}
