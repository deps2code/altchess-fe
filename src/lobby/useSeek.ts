import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SeekRequest, type SeekResult } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

/** How often a parked seek asks the server whether it has been paired. The
 *  server pairs synchronously, so this only bounds how late the news arrives. */
const POLL_INTERVAL_MS = 2000;

const EMPTY: SeekResult = { status: "none", seek: null, game: null };

type UseSeek = {
  result: SeekResult;
  error: string | null;
  busy: boolean;
  create: (request: SeekRequest) => Promise<void>;
  cancel: () => Promise<void>;
  /** Re-reads the current seek from the server. Used after an out-of-band
   *  change, such as aborting the matched game, to pick up the new status. */
  refresh: () => Promise<void>;
};

export function useSeek(): UseSeek {
  const { authorized } = useAuth();
  const [result, setResult] = useState<SeekResult>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (call: () => Promise<SeekResult>) => {
      setBusy(true);
      setError(null);
      try {
        const next = await call();
        if (mounted.current) {
          setResult(next);
        }
      } catch (cause) {
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : "Something went wrong");
        }
      } finally {
        if (mounted.current) {
          setBusy(false);
        }
      }
    },
    [],
  );

  // Load whatever seek the player already had, so a refresh mid-search resumes.
  useEffect(() => {
    const controller = new AbortController();

    authorized((token) => api.currentSeek(token, controller.signal))
      .then((current) => {
        if (!controller.signal.aborted && mounted.current) {
          setResult(current);
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [authorized]);

  // Poll only while parked; a matched or absent seek needs no further requests.
  useEffect(() => {
    if (result.status !== "pending") {
      return;
    }

    const controller = new AbortController();
    const timer = window.setInterval(() => {
      authorized((token) => api.currentSeek(token, controller.signal))
        .then((current) => {
          if (!controller.signal.aborted && mounted.current) {
            setResult(current);
          }
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [result.status, authorized]);

  const create = useCallback(
    (request: SeekRequest) => run(() => authorized((token) => api.createSeek(token, request))),
    [authorized, run],
  );

  const cancel = useCallback(
    () =>
      run(async () => {
        await authorized((token) => api.cancelSeek(token));
        return EMPTY;
      }),
    [authorized, run],
  );

  const refresh = useCallback(
    () => run(() => authorized((token) => api.currentSeek(token))),
    [authorized, run],
  );

  return { result, error, busy, create, cancel, refresh };
}
