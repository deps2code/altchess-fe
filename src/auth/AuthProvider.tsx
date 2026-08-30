import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type Registration, type Session, type User } from "../api/client";
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from "./storage";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: User };

type AuthContextValue = {
  state: AuthState;
  signIn: (login: string, password: string) => Promise<void>;
  signUp: (registration: Registration) => Promise<void>;
  signOut: () => Promise<void>;
  /** Runs an authenticated call, refreshing the access token once and retrying
   *  if the server rejects it. A failed refresh signs the player out. */
  authorized: <T>(call: (token: string) => Promise<T>) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  // Kept in refs because authorized() must read the current values without being
  // re-created on every token rotation.
  const accessToken = useRef<string | null>(null);
  const refreshToken = useRef<string | null>(null);
  const pendingRefresh = useRef<Promise<string> | null>(null);

  const adopt = useCallback((session: Session) => {
    accessToken.current = session.tokens.access_token;
    refreshToken.current = session.tokens.refresh_token;
    writeRefreshToken(session.tokens.refresh_token);
    setState({ status: "authenticated", user: session.user });
  }, []);

  const forget = useCallback(() => {
    accessToken.current = null;
    refreshToken.current = null;
    clearRefreshToken();
    setState({ status: "anonymous", user: null });
  }, []);

  /** Concurrent calls share one refresh so a page full of requests — or
   *  StrictMode's double-invoked effects in dev — cannot rotate the token
   *  twice and trip the server's replay detection against themselves. */
  const renew = useCallback(async (): Promise<string> => {
    if (pendingRefresh.current) {
      return pendingRefresh.current;
    }

    const stored = refreshToken.current ?? readRefreshToken();
    if (!stored) {
      forget();
      throw new ApiError(401, "unauthorized", "Your session has ended. Sign in again.");
    }

    const attempt = api
      .refresh(stored)
      .then((session) => {
        adopt(session);
        return session.tokens.access_token;
      })
      .catch((error: unknown) => {
        forget();
        throw error;
      })
      .finally(() => {
        pendingRefresh.current = null;
      });

    pendingRefresh.current = attempt;
    return attempt;
  }, [adopt, forget]);

  // Restore the session from the stored refresh token on first load. Routed
  // through renew() rather than calling api.refresh directly so its
  // in-flight dedup absorbs StrictMode's double-invoked effect in dev —
  // otherwise two real rotations race the same stored token, and the one
  // that loses reports a spurious 401 and signs the still-valid session out.
  useEffect(() => {
    if (!readRefreshToken()) {
      setState({ status: "anonymous", user: null });
      return;
    }
    renew().catch(() => {
      // Failure already reflected into state by renew()'s own forget();
      // this only stops an unhandled promise rejection warning.
    });
  }, [renew]);

  const authorized = useCallback(
    async <T,>(call: (token: string) => Promise<T>): Promise<T> => {
      const token = accessToken.current ?? (await renew());

      try {
        return await call(token);
      } catch (error) {
        if (!(error instanceof ApiError) || !error.isAuthFailure) {
          throw error;
        }
        return call(await renew());
      }
    },
    [renew],
  );

  const signIn = useCallback(
    async (login: string, password: string) => {
      adopt(await api.login(login, password));
    },
    [adopt],
  );

  const signUp = useCallback(
    async (registration: Registration) => {
      adopt(await api.register(registration));
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    const stored = refreshToken.current ?? readRefreshToken();
    forget();
    if (stored) {
      // The local session is already gone; a failed revoke must not block the UI.
      await api.logout(stored).catch(() => undefined);
    }
  }, [forget]);

  const value = useMemo(
    () => ({ state, signIn, signUp, signOut, authorized }),
    [state, signIn, signUp, signOut, authorized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return value;
}
