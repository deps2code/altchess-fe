import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { BulbIcon } from "./icons";

export type PowerBarItem = {
  id: string;
  label: string;
  Icon: typeof BulbIcon;
  remaining: number;
  /** Why this power can't be played right now, or null when it can. A
   *  blocked tile still opens its label on a tap — it just can't be dragged. */
  blocked: string | null;
  armed: boolean;
};

/** Where a drag is, for the board's own highlight: nothing in hand, a power
 *  lifted anywhere, or a power held over the board itself. */
export type PowerDragState = "idle" | "lifted" | "over";

/** Pointer travel before a press counts as a drag rather than a tap. */
const DRAG_SLOP = 8;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The phone-sized power picker: a bar along the bottom of the screen whose
 *  tiles are dragged onto the board to play them. A tap only opens the tile's
 *  name — it never plays. CSS hides the whole bar above the breakpoint where
 *  the aside's own panel is on screen. */
export function PowerBar({
  items,
  getBoard,
  onDrop,
  onDragState,
}: {
  items: PowerBarItem[];
  getBoard: () => HTMLElement | null;
  onDrop: (id: string) => void;
  onDragState: (state: PowerDragState) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // The ghost under the finger. "settling" is the short animation after
  // release — into the board on a drop, back to its tile otherwise — during
  // which the ghost is still drawn but no longer follows the pointer.
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    over: boolean;
    settling: boolean;
  } | null>(null);
  const press = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
    tile: HTMLElement;
  } | null>(null);
  const ghost = useRef<HTMLSpanElement | null>(null);

  function overBoard(x: number, y: number): boolean {
    const rect = getBoard()?.getBoundingClientRect();
    return rect !== undefined && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, item: PowerBarItem) {
    if ((event.pointerType === "mouse" && event.button !== 0) || drag?.settling) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = {
      id: item.id,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      tile: event.currentTarget,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>, item: PowerBarItem) {
    const current = press.current;
    if (!current || current.id !== item.id) {
      return;
    }
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_SLOP) {
      return;
    }
    current.moved = true;
    if (item.blocked !== null) {
      return;
    }
    const over = overBoard(event.clientX, event.clientY);
    setOpen(null);
    setDrag({
      id: item.id,
      x: event.clientX,
      y: event.clientY,
      over,
      settling: false,
    });
    onDragState(over ? "over" : "lifted");
  }

  /** Plays the release animation on the ghost, then removes it. Keyframes
   *  leave out their start, so each one begins from wherever the ghost's CSS
   *  has it (tilted in the air, or grown over the board). With reduced
   *  motion, or no ghost to animate, it is removed at once. */
  function settle(keyframes: Keyframe[], duration: number) {
    const element = ghost.current;
    if (!element || prefersReducedMotion()) {
      setDrag(null);
      return;
    }
    setDrag((previous) => (previous ? { ...previous, settling: true } : previous));
    const animation = element.animate(keyframes, {
      duration,
      easing: "cubic-bezier(.3, .7, .4, 1)",
      fill: "forwards",
    });
    animation.onfinish = () => setDrag(null);
    animation.oncancel = () => setDrag(null);
  }

  function end(event: ReactPointerEvent<HTMLButtonElement>, item: PowerBarItem, cancelled: boolean) {
    const current = press.current;
    press.current = null;
    onDragState("idle");
    if (!current || current.id !== item.id) {
      return;
    }
    if (!current.moved) {
      if (!cancelled) {
        setOpen((previous) => (previous === item.id ? null : item.id));
      }
      return;
    }
    if (!drag) {
      return;
    }
    if (!cancelled && item.blocked === null && overBoard(event.clientX, event.clientY)) {
      // Pressed into the board: the ghost drops onto the point and sinks in,
      // and the power's own stamp takes over from there.
      settle(
        [
          {
            transform: "translate(-50%, -50%) scale(1.2)",
            opacity: 1,
            offset: 0.45,
          },
          { transform: "translate(-50%, -50%) scale(.2)", opacity: 0 },
        ],
        320,
      );
      onDrop(item.id);
      return;
    }
    // Let go anywhere else: it flies back into its tile.
    const home = current.tile.getBoundingClientRect();
    const dx = home.left + home.height / 2 - event.clientX;
    const dy = home.top + home.height / 2 - event.clientY;
    settle(
      [
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.7)`,
          opacity: 0.2,
        },
      ],
      280,
    );
  }

  const dragged = drag ? items.find((candidate) => candidate.id === drag.id) : undefined;

  return (
    <div className={drag ? "power-bar holding" : "power-bar"} role="group" aria-label="Your powers">
      {items.map((item) => {
        const expanded = open === item.id;
        const classes = ["power-bar-tile"];
        if (expanded) classes.push("expanded");
        if (item.armed) classes.push("armed");
        if (item.blocked !== null) classes.push("blocked");
        if (drag?.id === item.id) classes.push("lifted");
        // The name always; a second line saying what to do with it — or why
        // it can't be done right now.
        const note = item.blocked ?? (item.armed ? "Drag a piece to try" : "Drag to the board");
        return (
          <button
            key={item.id}
            type="button"
            className={classes.join(" ")}
            aria-expanded={expanded}
            aria-label={`${item.label} — ${item.remaining} left`}
            onPointerDown={(event) => onPointerDown(event, item)}
            onPointerMove={(event) => onPointerMove(event, item)}
            onPointerUp={(event) => end(event, item, false)}
            onPointerCancel={(event) => end(event, item, true)}
            onContextMenu={(event) => event.preventDefault()}
            onClick={(event) => {
              // Pointer taps are handled on release; a click with no pointer
              // behind it is the keyboard, which can't drag: first press
              // opens the name, second plays.
              if (event.detail !== 0) {
                return;
              }
              if (expanded && item.blocked === null) {
                setOpen(null);
                onDrop(item.id);
              } else {
                setOpen(expanded ? null : item.id);
              }
            }}
          >
            <span className="power-bar-disc">
              <item.Icon />
              <span className="power-bar-count" aria-hidden="true">
                {item.remaining}
              </span>
            </span>
            <span className="power-bar-text" aria-hidden={!expanded}>
              <strong>{item.label}</strong>
              <small>{note}</small>
            </span>
          </button>
        );
      })}
      {/* Portalled out: the bar is centred with a transform, and a fixed
          element inside a transformed one is positioned against it rather
          than the viewport. */}
      {drag &&
        dragged &&
        createPortal(
          <span
            ref={ghost}
            className={drag.over ? "power-bar-ghost over" : "power-bar-ghost"}
            style={{ left: drag.x, top: drag.y }}
            aria-hidden="true"
          >
            <dragged.Icon />
          </span>,
          document.body,
        )}
    </div>
  );
}
