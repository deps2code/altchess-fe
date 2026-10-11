import { useState } from "react";

const DISMISSED_KEY = "altchess.storage_notice_dismissed";

/** The only thing this app keeps in the browser is the refresh token, which is
 *  strictly necessary for staying signed in — so under ePrivacy there is nothing
 *  to consent to, and this is a notice rather than an accept/reject prompt.
 *  Adding anything non-essential (analytics, embeds) means turning it into a
 *  real choice and loading that script only after an accept. */
export function CookieNotice() {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private browsing rejects writes; the notice then returns on reload.
    }
    setDismissed(true);
  }

  return (
    <div className="cookie-notice-backdrop">
      <aside className="cookie-notice" role="region" aria-label="Browser storage notice">
        <p>
          Altchess keeps one item in your browser: a sign-in token, so you stay signed in between
          visits. No tracking, analytics, or advertising cookies.
        </p>
        <button type="button" className="ghost" onClick={dismiss}>
          Got it
        </button>
      </aside>
    </div>
  );
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
