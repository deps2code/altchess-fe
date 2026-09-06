import type { PowerUsedFrame } from "./protocol";

/** Just the two score fields, so both a live `power_used` frame and anything
 *  reconstructed from a snapshot can be formatted by the same functions. */
export type Evaluation = Pick<PowerUsedFrame, "score_cp" | "mate_in">;

/** The engine's verdict, always from White's point of view — the same
 *  convention every engine UI uses, and stated as such in the panel. */
export function formatEvaluation(frame: Evaluation): string {
  if (frame.mate_in !== undefined) {
    return `M${Math.abs(frame.mate_in)}${frame.mate_in < 0 ? " for Black" : " for White"}`;
  }
  if (frame.score_cp === undefined) {
    return "—";
  }
  const pawns = frame.score_cp / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

/** The same verdict at the width of the eval bar: a couple of glyphs, with
 *  the side it favours read off which end of the bar is full rather than
 *  spelled out. */
export function formatEvaluationShort(frame: Evaluation): string {
  if (frame.mate_in !== undefined) {
    return `M${Math.abs(frame.mate_in)}`;
  }
  if (frame.score_cp === undefined) {
    return "—";
  }
  const pawns = frame.score_cp / 100;
  // A tenth of a pawn stops meaning anything once a side is up a rook, and
  // the bar is two characters wide before it starts clipping — so the
  // decimal is dropped exactly where it stops being information.
  const magnitude = Math.abs(pawns) >= 10 ? Math.round(Math.abs(pawns)).toString() : Math.abs(pawns).toFixed(1);
  return `${pawns > 0 ? "+" : pawns < 0 ? "-" : ""}${magnitude}`;
}

/** White's share of the bar, 0..1, from a centipawn score.
 *
 *  A raw centipawn scale is unusable as a bar: +900 and +2500 are both simply
 *  winning, but linearly the second would be nearly three times the first.
 *  The logistic below is the winning-chances curve every engine UI uses — it
 *  moves fast around equality, where a tenth of a pawn actually means
 *  something, and flattens out once a position is decided. A mate score is
 *  the end of the scale by definition. Clamped just short of the ends so a
 *  sliver of the losing side always stays visible. */
export function whiteShare(frame: Evaluation): number {
  if (frame.mate_in !== undefined) {
    return frame.mate_in > 0 ? 1 : 0;
  }
  if (frame.score_cp === undefined) {
    return 0.5;
  }
  const chances = 2 / (1 + Math.exp(-0.00368208 * frame.score_cp)) - 1;
  return Math.min(0.985, Math.max(0.015, (chances + 1) / 2));
}
