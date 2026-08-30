const REFRESH_TOKEN_KEY = "altchess.refresh_token";

/** The refresh token is the only credential that outlives a page load. The
 *  access token stays in memory so it is never written to disk. */
export function readRefreshToken(): string | null {
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeRefreshToken(token: string): void {
  try {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    // Private browsing modes reject writes; the session then lasts until reload.
  }
}

export function clearRefreshToken(): void {
  try {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Nothing to do: the token was never persisted.
  }
}
