import type { ClockFrame } from "../api/client";

// Mirrors backend/internal/game/protocol.go. A generic {"type": ...}
// envelope so a future use_power/power_used pair doesn't need a redesign.

export type ClientMessage = {
  type: "move" | "resign";
  command_id: string;
  expected_ply: number;
  uci?: string;
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

export type ErrorFrame = {
  type: "error";
  command_id?: string;
  code: string;
  message: string;
};

export type ServerFrame = StateFrame | ErrorFrame;
