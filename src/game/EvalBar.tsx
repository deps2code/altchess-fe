import { formatEvaluationShort, whiteShare, type Evaluation } from "./evaluation";

/** The `current_eval` power, drawn beside the board instead of only spelled
 *  out in the side panel: a vertical bar whose fill is the viewer's own side,
 *  growing from the bottom the way that side sits on the board.
 *
 *  Visible only while its reading is still fresh for the position it was
 *  asked about — the next move clears `evaluation` and the bar fades out
 *  with it, rather than sitting on screen as a stale or placeholder value.
 *  The rail's own box stays in the layout either way (`opacity`, not
 *  `display`/unmounting), so the board never resizes as it comes and goes. */
export function EvalBar({
  viewerColor,
  evaluation,
}: {
  viewerColor: "white" | "black";
  /** null between verdicts — a reading belongs to the position it was asked
   *  about, so the next move clears it, and with it the bar. */
  evaluation: Evaluation | null;
}) {
  const visible = evaluation !== null;
  const white = evaluation ? whiteShare(evaluation) : 0.5;
  const bottom = viewerColor === "white" ? white : 1 - white;
  const label = evaluation ? formatEvaluationShort(evaluation) : "";
  const classes = [
    "eval-rail",
    viewerColor === "white" ? "white-bottom" : "black-bottom",
    visible ? "is-live" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      role={visible ? "img" : undefined}
      aria-hidden={!visible}
      aria-label={visible ? `Evaluation ${label}, from White's point of view` : undefined}
      title={visible ? `${label} for White` : undefined}
    >
      {/* The height is the datum itself, not styling, so it is the one thing
          here that cannot live in styles.css. */}
      <div className="eval-fill" style={{ height: `${(bottom * 100).toFixed(1)}%` }} />
      {/* Keyed by the reading so each new verdict replays its own entrance. */}
      {visible && (
        <span key={label} className="eval-value">
          {label}
        </span>
      )}
    </div>
  );
}
