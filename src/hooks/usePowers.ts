import { useEffect, useState } from "react";
import { getPowers, type Power } from "../api/client";

type PowersState =
  | { status: "loading"; powers: Power[]; error: null }
  | { status: "ready"; powers: Power[]; error: null }
  | { status: "error"; powers: Power[]; error: string };

export function usePowers(): PowersState {
  const [state, setState] = useState<PowersState>({ status: "loading", powers: [], error: null });

  useEffect(() => {
    const controller = new AbortController();

    getPowers(controller.signal)
      .then((powers) => setState({ status: "ready", powers, error: null }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "Unable to load powers";
          setState({ status: "error", powers: [], error: message });
        }
      });

    return () => controller.abort();
  }, []);

  return state;
}

