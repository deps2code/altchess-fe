/** Inline SVG icons for the icon-only buttons in the invite and result
 *  modals. Kept as plain components rather than a dependency: there are a
 *  handful of them, they inherit `currentColor`, and every caller supplies
 *  the accessible name on the button itself — so each icon is aria-hidden. */

import type { ReactNode } from "react";

type IconProps = { className?: string };

function Svg({ children, className }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 12.5 5 5L20 6.5" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1" />
      <path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" />
    </Svg>
  );
}

export function ThumbsUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" />
      <path d="M7 10.5 11.5 3a2.5 2.5 0 0 1 2.5 2.5V9h4.6a1.8 1.8 0 0 1 1.76 2.2l-1.3 6A1.8 1.8 0 0 1 17.3 20H7" />
    </Svg>
  );
}

export function ThumbsDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 14V4H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1z" />
      <path d="M7 13.5 11.5 21a2.5 2.5 0 0 0 2.5-2.5V15h4.6a1.8 1.8 0 0 0 1.76-2.2l-1.3-6A1.8 1.8 0 0 0 17.3 4H7" />
    </Svg>
  );
}

/** The two powers, as marks rather than words: a lamp for `best_move` (the
 *  engine's suggestion) and a dial for `current_eval` (its verdict). Used
 *  wherever a budget is shown as a count of charges rather than named. */
export function BulbIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.9 1 1 1.7l.1.5h5l.1-.5c.1-.7.5-1.3 1-1.7A6 6 0 0 0 12 3z" />
    </Svg>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 17a9 9 0 1 1 17 0" />
      <path d="M12 17l4.2-5.2" />
      <circle cx="12" cy="17" r="1.1" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 2" />
    </Svg>
  );
}

/** The upward tick in front of the selector's live summary line. */
export function TrendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 15.5 9 10l3.5 3.5L20.5 5.5" />
      <path d="M15.5 5.5h5v5" />
    </Svg>
  );
}
