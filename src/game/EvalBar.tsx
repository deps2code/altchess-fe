import { formatEvaluationShort, whiteShare, type Evaluation } from "./evaluation";

/** The `current_eval` power, drawn beside the board instead of only spelled
 *  out in the side panel: a vertical bar whose fill is the viewer's own side,
 *  growing from the bottom the way that side sits on the board.
 *
 *  It is rendered for the whole game whenever the match has any power budget
 *  at all, rather than appearing with the first verdict — a bar that came and
 *  went would resize the board under a live game. With no verdict to show it
 *  sits dimmed at the halfway mark, and every later reading animates from
 *  wherever the last one left it.
 *
 *  Private, like every other power result: this only ever renders the
 *  viewer's own `power_used` frame, and the opponent is told nothing. */
export function EvalBar({
  viewerColor,
  evaluation,
}: {
  viewerColor: "white" | "black";
  /** null between verdicts — a reading belongs to the position it was asked
   *  about, so the next move clears it. */
  evaluation: Evaluation | null;
}) {
  const white = evaluation ? whiteShare(evaluation) : 0.5;
  const bottom = viewerColor === "white" ? white : 1 - white;
  const label = evaluation ? formatEvaluationShort(evaluation) : "—";
  const classes = [
    "eval-rail",
    viewerColor === "white" ? "white-bottom" : "black-bottom",
    evaluation ? "live" : "idle",
  ].join(" ");

  return (
    <div
      className={classes}
      role="img"
      aria-label={
        evaluation
          ? `Evaluation ${label}, from White's point of view`
          : "Evaluation — spend a power to see it"
      }
      title={evaluation ? `${label} for White` : "Evaluation"}
    >
      {/* The height is the datum itself, not styling, so it is the one thing
          here that cannot live in styles.css. */}
      <div className="eval-fill" style={{ height: `${(bottom * 100).toFixed(1)}%` }} />
      {/* Keyed by the reading so each new verdict replays its own entrance. */}
      <span key={label} className="eval-value">
        {label}
      </span>
    </div>
  );
}
