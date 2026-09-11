import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { Key } from "@lichess-org/chessground/types";
import { Chess } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { parseFen } from "chessops/fen";
import { parseSquare } from "chessops/util";

function chessFromFen(fen: string): Chess {
  const setup = parseFen(fen).unwrap();
  return Chess.fromSetup(setup).unwrap();
}

function moveKeys(uci: string | undefined): [Key, Key] | undefined {
  if (!uci || uci.length < 4) {
    return undefined;
  }
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
}

// A pawn reaching the back rank always promotes to a queen. A promotion
// picker (lichess shows one) is a real feature this slice doesn't build;
// auto-queening covers the overwhelming majority of real promotions.
function withAutoQueen(chess: Chess, orig: Key, dest: Key): string {
  const from = parseSquare(orig);
  const backRank = dest.endsWith("1") || dest.endsWith("8");
  const piece = from === undefined ? undefined : chess.board.get(from);
  return piece?.role === "pawn" && backRank ? `${orig}${dest}q` : `${orig}${dest}`;
}

export type BoardStateUpdate = {
  fen: string;
  turn: "white" | "black";
  ply: number;
  status: string;
  lastMove?: string;
};

export type BoardHandle = {
  applyState: (update: BoardStateUpdate) => void;
  /** Draws the arrow for a `best_move` answer, or clears it with null. The
   *  hint is private to this viewer — it is drawn from a frame only they
   *  received — and is cleared by the next authoritative state. */
  showHint: (uci: string | null) => void;
  /** Arms (or disarms) candidate capture for try_move: while armed, the next
   *  legal drag is reported to onCandidate instead of being played, and
   *  consumes the arm. Unarmed board behaviour (a drag plays a move) is
   *  unchanged. */
  armCandidate: (armed: boolean) => void;
  /** Freezes the board on afterFEN — the position a try_move candidate leads
   *  to — with the candidate drawn as the last move, view-only. Stays frozen
   *  until clearPreview or the next applyState, whichever comes first. */
  showPreview: (afterFEN: string, candidateUCI: string) => void;
  /** Restores the last authoritative position (whatever applyState last set)
   *  and unfreezes the board. A no-op when there is no preview up. */
  clearPreview: () => void;
  destroy: () => void;
};

/** Mounts a live chessground board into el. Legal destinations and promotion
 *  detection run client-side via chessops purely for UX (highlighting,
 *  auto-queening); the server is the only authority on whether a move is
 *  actually legal — a rejected move just snaps back once its error frame
 *  or the next authoritative state frame arrives. */
export function mountGameBoard(
  el: HTMLElement,
  playerColor: "white" | "black",
  initial: BoardStateUpdate,
  onMove: (uci: string, expectedPly: number) => void,
  onCandidate: (uci: string, expectedPly: number) => void,
): BoardHandle {
  // chessground's destroy() unbinds its handlers but leaves its markup in
  // place, so a remount into the same node (taking a displaced session back)
  // would stack a second board on top of the first.
  el.replaceChildren();

  // The authoritative position, mirrored here so a try_move preview can be
  // torn down without asking GameScreen for the last state it saw —
  // GameScreen's own LiveState carries no lastMove, so restoring from there
  // would wipe the real last-move highlight along with the preview.
  let current = initial;
  let ply = initial.ply;
  let chess = chessFromFen(initial.fen);
  // While armed, the next drag is a try_move candidate instead of a move;
  // consumed by the first drag either way. previewing tracks whether the
  // board is currently frozen on a candidate's resulting position, which is
  // what clearPreview and the next applyState both need to know to act.
  let armed = false;
  let previewing = false;

  function movable(status: string): Config["movable"] {
    const live = status === "pending" || status === "live";
    return {
      color: live ? playerColor : undefined,
      free: false,
      // chessgroundDests deliberately includes both castling destinations —
      // the visual square and the king-takes-own-rook square — so chessground
      // can support either drag style. rookCastle: false is what makes it
      // pick the visual one: without it a king dropped on its own rook sends
      // "e8a8" for the UCI move, which the server's UCI parser rejects since
      // it expects the king's actual destination square ("e8c8").
      dests: live ? chessgroundDests(chess) : new Map(),
      rookCastle: false,
      events: {
        after: (orig, dest) => {
          const uci = withAutoQueen(chess, orig, dest);
          if (armed) {
            armed = false;
            // Freeze on the drag the player just made: chessground has
            // already applied it visually, so this stays a continuous
            // picture while the engine thinks rather than a snap-back.
            // showPreview (once the power_used frame lands) replaces this
            // with the server's own after-position; onCandidate can also
            // simply never resolve into one, in which case this is what the
            // player sees for as long as they wait.
            api.set({ viewOnly: true });
            onCandidate(uci, ply);
            return;
          }
          onMove(uci, ply);
        },
      },
    };
  }

  const api: Api = Chessground(el, {
    fen: initial.fen,
    orientation: playerColor,
    turnColor: initial.turn,
    lastMove: moveKeys(initial.lastMove),
    highlight: { lastMove: true, check: true },
    viewOnly: initial.status !== "pending" && initial.status !== "live",
    movable: movable(initial.status),
  });

  function showHint(uci: string | null) {
    const keys = moveKeys(uci ?? undefined);
    api.setAutoShapes(keys ? [{ orig: keys[0], dest: keys[1], brush: "green" }] : []);
  }

  function render(update: BoardStateUpdate) {
    ply = update.ply;
    chess = chessFromFen(update.fen);
    const live = update.status === "pending" || update.status === "live";
    // The position moved on, so any hint drawn for the previous one is
    // stale by definition.
    showHint(null);
    api.set({
      fen: update.fen,
      turnColor: update.turn,
      lastMove: moveKeys(update.lastMove),
      check: chess.isCheck() ? update.turn : undefined,
      viewOnly: !live,
      movable: movable(update.status),
    });
  }

  return {
    applyState(update) {
      current = update;
      // An authoritative frame always wins: it tears down any preview and
      // any still-armed candidate for free, the same way it already clears
      // a stale hint.
      armed = false;
      previewing = false;
      render(update);
    },
    showHint,
    armCandidate(next) {
      armed = next;
    },
    showPreview(afterFEN, candidateUCI) {
      previewing = true;
      const previewChess = chessFromFen(afterFEN);
      api.set({
        fen: afterFEN,
        lastMove: moveKeys(candidateUCI),
        check: previewChess.isCheck() ? previewChess.turn : undefined,
        viewOnly: true,
        movable: { color: undefined, dests: new Map() },
      });
    },
    clearPreview() {
      if (!previewing) {
        return;
      }
      previewing = false;
      render(current);
    },
    destroy() {
      api.destroy();
    },
  };
}
