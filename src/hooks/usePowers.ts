import { useEffect, useState } from "react";
import { api, type Power } from "../api/client";

/** `available` is whether the server has an engine configured. It is false
 *  while loading and after an error too, so a caller can treat it as "can a
 *  power be spent right now" without checking status first. */
type PowersState =
  | { status: "loading"; powers: Power[]; available: false; error: null }
  | { status: "ready"; powers: Power[]; available: boolean; error: null }
  | { status: "error"; powers: Power[]; available: false; error: string };

export function usePowers(): PowersState {
  const [state, setState] = useState<PowersState>({
    status: "loading",
    powers: [],
    available: false,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    api
      .powers(controller.signal)
      .then((catalog) =>
        setState({ status: "ready", powers: catalog.powers, available: catalog.available, error: null }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "Unable to load powers";
          setState({ status: "error", powers: [], available: false, error: message });
        }
      });

    return () => controller.abort();
  }, []);

  return state;
}
