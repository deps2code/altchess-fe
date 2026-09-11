import type { ClockFrame, PowerID } from "../api/client";

// Mirrors backend/internal/game/protocol.go. A generic {"type": ...}
// envelope, so a new power adds fields rather than messages.

export type ClientMessage = {
  type: "move" | "resign" | "use_power";
  command_id: string;
  expected_ply: number;
  /** Meaningful for "move", and for a "use_power" whose power takes a
   *  candidate (try_move). Ignored, not rejected, by a use_power for any
   *  other power. */
  uci?: string;
  power?: PowerID;
};

export type StateFrame = {
  type: "state";
  fen: string;
  turn: "white" | "black";
  ply: number;
  status: "pending" | "live" | "finished" | "aborted";
  last_move?: string;
  clocks: ClockFrame;
  result?: "white" | "black" | "draw";
  end_reason?: string;
  /** Only set on the terminal frame for a decisive/drawn game — never for
   *  an abort, which isn't rated. */
  white_rating_change?: number;
  black_rating_change?: number;
};

/** The engine's answer, sent only to the player who asked. `remaining` is
 *  that player's own count for that power after the spend, and is the only
 *  charge count that ever crosses the wire.
 *
 *  `fen`/`score_cp`/`mate_in` keep their plain meaning for every power — the
 *  live position and its eval — which for try_move is the *before* reading.
 *  The `after_*` fields are try_move only: the candidate that was tried, the
 *  position it leads to, and either its eval (`after_score_cp`/
 *  `after_mate_in`) or, when the candidate ends the game, `after_outcome`
 *  instead (never both — a mate score alone can't say who mated whom for an
 *  already-decided position). */
export type PowerUsedFrame = {
  type: "power_used";
  command_id: string;
  power: PowerID;
  ply: number;
  fen: string;
  remaining: number;
  best_move?: string;
  score_cp?: number;
  mate_in?: number;
  candidate_uci?: string;
  after_fen?: string;
  after_score_cp?: number;
  after_mate_in?: number;
  after_outcome?: "checkmate" | "stalemate" | "draw";
};

/** Sent only to the opponent, and only for a power that actually succeeded:
 *  no count, no power name, no result. Ephemeral — nothing re-delivers it on
 *  reconnect. */
export type PowerNoticeFrame = {
  type: "power_notice";
  ply: number;
};

export type ErrorFrame = {
  type: "error";
  command_id?: string;
  code: string;
  message: string;
};

export type ServerFrame = StateFrame | ErrorFrame | PowerUsedFrame | PowerNoticeFrame;
