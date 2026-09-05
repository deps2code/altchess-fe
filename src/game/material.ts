/** Which pieces each side has captured, derived from a FEN.
 *
 *  There is no capture list on the wire — the server sends positions, not
 *  events — so this is reconstructed by comparing what is on the board against
 *  a full starting set. That makes promotions read slightly oddly (a promoted
 *  queen looks like an uncaptured one), which is the standard tradeoff every
 *  board UI makes for this display; counts are clamped at zero so a player
 *  with two queens never shows a negative capture. */

export type PieceRole = "p" | "n" | "b" | "r" | "q";
export type Color = "white" | "black";

export type CapturedPiece = { role: PieceRole; color: Color };

export type Material = {
  /** Black pieces White has taken, cheapest first. */
  byWhite: CapturedPiece[];
  /** White pieces Black has taken, cheapest first. */
  byBlack: CapturedPiece[];
  /** Positive when White leads on material, in pawns. */
  whiteAdvantage: number;
};

/** Cheapest first, which is also the order captures are listed in. */
const ROLES: PieceRole[] = ["p", "n", "b", "r", "q"];

const STARTING_COUNT: Record<PieceRole, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<PieceRole, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Solid glyphs for both colors — the outline (white) set all but disappears
 *  against a dark board, so color is carried by CSS instead of by shape. */
export const PIECE_GLYPH: Record<PieceRole, string> = {
  p: "♟",
  n: "♞",
  b: "♝",
  r: "♜",
  q: "♛",
};

function countPieces(fen: string): { white: Record<PieceRole, number>; black: Record<PieceRole, number> } {
  const white: Record<PieceRole, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  const black: Record<PieceRole, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };

  const board = fen.split(" ")[0] ?? "";
  for (const char of board) {
    const lower = char.toLowerCase() as PieceRole;
    if (!ROLES.includes(lower)) {
      continue; // digits, slashes, and the kings, which are never captured
    }
    const side = char === char.toUpperCase() ? white : black;
    side[lower] += 1;
  }
  return { white, black };
}

function missing(present: Record<PieceRole, number>, color: Color): CapturedPiece[] {
  const captured: CapturedPiece[] = [];
  for (const role of ROLES) {
    const gone = Math.max(0, STARTING_COUNT[role] - present[role]);
    for (let i = 0; i < gone; i += 1) {
      captured.push({ role, color });
    }
  }
  return captured;
}

function total(pieces: CapturedPiece[]): number {
  return pieces.reduce((sum, piece) => sum + VALUE[piece.role], 0);
}

export function capturedMaterial(fen: string): Material {
  // No position yet (the snapshot hasn't landed): nothing has been captured,
  // rather than an empty board reading as every piece taken.
  if (!fen.trim()) {
    return { byWhite: [], byBlack: [], whiteAdvantage: 0 };
  }
  const { white, black } = countPieces(fen);
  const byWhite = missing(black, "black");
  const byBlack = missing(white, "white");
  return { byWhite, byBlack, whiteAdvantage: total(byWhite) - total(byBlack) };
}
