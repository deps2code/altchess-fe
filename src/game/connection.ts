import type { ClientMessage, ErrorFrame, ServerFrame, StateFrame } from "./protocol";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;

export type GameConnection = {
  send: (message: ClientMessage) => void;
  close: () => void;
};

/** Opens a live connection to one game and keeps it open, reconnecting with
 *  capped backoff on any drop. getToken is called on every (re)connect
 *  attempt since the access token is short-lived and may have rotated. */
export function openGameConnection(
  gameID: string,
  getToken: () => Promise<string>,
  handlers: { onState: (frame: StateFrame) => void; onError: (frame: ErrorFrame) => void },
): GameConnection {
  let closed = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: number | undefined;

  function wsURL(token: string): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/v1/games/${encodeURIComponent(gameID)}/ws?token=${encodeURIComponent(token)}`;
  }

  function scheduleReconnect() {
    if (closed) {
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    attempt += 1;
    reconnectTimer = window.setTimeout(() => void connect(), delay);
  }

  async function connect() {
    if (closed) {
      return;
    }

    let token: string;
    try {
      token = await getToken();
    } catch {
      scheduleReconnect();
      return;
    }
    if (closed) {
      return;
    }

    const ws = new WebSocket(wsURL(token));
    socket = ws;

    ws.onopen = () => {
      attempt = 0;
    };

    ws.onmessage = (event) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data as string) as ServerFrame;
      } catch {
        return;
      }
      if (frame.type === "state") {
        handlers.onState(frame);
      } else if (frame.type === "error") {
        handlers.onError(frame);
      }
    };

    ws.onclose = () => {
      if (socket === ws) {
        socket = null;
      }
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  void connect();

  return {
    send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    close() {
      closed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
