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
): BoardHandle {
  let ply = initial.ply;
  let chess = chessFromFen(initial.fen);

  function movable(status: string): Config["movable"] {
    const live = status === "pending" || status === "live";
    return {
      color: live ? playerColor : undefined,
      free: false,
      dests: live ? chessgroundDests(chess) : new Map(),
      events: {
        after: (orig, dest) => {
          onMove(withAutoQueen(chess, orig, dest), ply);
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

  return {
    applyState(update) {
      ply = update.ply;
      chess = chessFromFen(update.fen);
      const live = update.status === "pending" || update.status === "live";
      api.set({
        fen: update.fen,
        turnColor: update.turn,
        lastMove: moveKeys(update.lastMove),
        check: chess.isCheck() ? update.turn : undefined,
        viewOnly: !live,
        movable: movable(update.status),
      });
    },
    destroy() {
      api.destroy();
    },
  };
}
