import { useEffect, useState } from "react";
import { api, type BotLevel } from "../api/client";

/** `available` is whether the server has an engine configured — the same flag
 *  usePowers reports, since both features run on the one Stockfish. It is
 *  false while loading and after an error too, so a caller can treat it as
 *  "can a bot game be started right now" without checking status first. */
type BotsState =
  | { status: "loading"; levels: BotLevel[]; available: false; error: null }
  | { status: "ready"; levels: BotLevel[]; available: boolean; error: null }
  | { status: "error"; levels: BotLevel[]; available: false; error: string };

export function useBots(): BotsState {
  const [state, setState] = useState<BotsState>({
    status: "loading",
    levels: [],
    available: false,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    api
      .bots(controller.signal)
      .then((catalog) =>
        setState({ status: "ready", levels: catalog.levels, available: catalog.available, error: null }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "Unable to load opponents";
          setState({ status: "error", levels: [], available: false, error: message });
        }
      });

    return () => controller.abort();
  }, []);

  return state;
}
