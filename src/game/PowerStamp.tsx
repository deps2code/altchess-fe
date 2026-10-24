import { useEffect, type AnimationEvent } from "react";
import type { BulbIcon } from "./icons";

/** Longest the stamp may stay mounted. The animation's own end event is what
 *  normally removes it; this only covers a browser that never fires one
 *  (animations disabled by a user stylesheet), which would otherwise leave
 *  the board locked until the player clicked. */
const FALLBACK_MS = 3500;

type Props = {
  /** The power's own mark — or a generic one, for the opponent's. */
  icon: typeof BulbIcon;
  /** Its name, stamped under the icon. The opponent's carries no power name,
   *  only that one was used. */
  label: string;
  onDone: () => void;
};

/** The 3s "a power was played" moment: a stamper comes down onto the board
 *  and leaves the power's icon as an ink impression. It is only the layer on
 *  top — the board's own tilt is `.board-tilt.stamping` in GameScreen, and
 *  both are driven by the same keyframes in styles.css. Purely decorative, so
 *  aria-hidden; the opponent's notice has its own live region. */
export function PowerStamp({ icon: Icon, label, onDone }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, FALLBACK_MS);
    return () => window.clearTimeout(timer);
    // onDone is a fresh closure every render and only ever clears this very
    // stamp, so the timer is set once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    // Children animate too, and their events bubble; only the layer's own
    // clock says the whole thing is over.
    if (event.target === event.currentTarget && event.animationName === "stamp-clock") {
      onDone();
    }
  }

  return (
    <div className="stamp-layer" aria-hidden="true" onAnimationEnd={onAnimationEnd}>
      {/* Worn-ink texture: displace the edges a little and knock holes out of
          the fill with thresholded noise, so the impression reads as rubber
          on paper rather than a vector outline. */}
      <svg className="stamp-defs" width="0" height="0" focusable="false">
        <filter id="stamp-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" result="rough" />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -9 0 0 0 5.9"
            result="speckle"
          />
          <feComposite in="rough" in2="speckle" operator="in" />
        </filter>
      </svg>
      <div className="stamp-shadow" />
      <div className="stamp-ink">
        <Icon className="stamp-icon" />
        <span className="stamp-label">{label}</span>
      </div>
      <div className="stamper">
        <div className="stamper-front" />
        <div className="stamper-top">
          <Icon className="stamp-icon" />
        </div>
      </div>
    </div>
  );
}
