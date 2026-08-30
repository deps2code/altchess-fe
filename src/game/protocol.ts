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
};

export type ErrorFrame = {
  type: "error";
  command_id?: string;
  code: string;
  message: string;
};

export type ServerFrame = StateFrame | ErrorFrame;
