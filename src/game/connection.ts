import type {
  ClientMessage,
  ErrorFrame,
  PowerNoticeFrame,
  PowerUsedFrame,
  ServerFrame,
  StateFrame,
} from "./protocol";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;

/** Close code the server sends to a connection the same player displaced by
 *  opening this game somewhere else — one game runs in one session at a time.
 *  Mirrors game.StatusSessionReplaced in backend/internal/game/hub.go, and is
 *  in the application-private 4000-4999 range precisely so it can be told
 *  apart from an ordinary drop. */
const SESSION_REPLACED_CODE = 4001;

export type GameConnection = {
  send: (message: ClientMessage) => void;
  close: () => void;
};

/** Opens a live connection to one game and keeps it open, reconnecting with
 *  capped backoff on any drop. getToken is called on every (re)connect
 *  attempt since the access token is short-lived and may have rotated.
 *  onSessionReplaced fires at most once, and the connection is finished when
 *  it does — call openGameConnection again to take the game back. */
export function openGameConnection(
  gameID: string,
  getToken: () => Promise<string>,
  handlers: {
    onState: (frame: StateFrame) => void;
    onError: (frame: ErrorFrame) => void;
    onPowerUsed?: (frame: PowerUsedFrame) => void;
    onPowerNotice?: (frame: PowerNoticeFrame) => void;
    onSessionReplaced?: () => void;
  },
): GameConnection {
  let closed = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: number | undefined;

  function wsURL(token: string): string {
    const base = import.meta.env.VITE_API_BASE;
    const origin = base
      ? base.replace(/^http/, "ws") // https:// -> wss://
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    return `${origin}/api/v1/games/${encodeURIComponent(gameID)}/ws?token=${encodeURIComponent(token)}`;
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
      } else if (frame.type === "power_used") {
        handlers.onPowerUsed?.(frame);
      } else if (frame.type === "power_notice") {
        handlers.onPowerNotice?.(frame);
      }
    };

    ws.onclose = (event) => {
      if (socket === ws) {
        socket = null;
      }
      if (event.code === SESSION_REPLACED_CODE) {
        // Reconnecting would displace the session that just took over, which
        // would displace this one straight back — two devices evicting each
        // other forever. Stay closed and let the UI offer the choice.
        closed = true;
        handlers.onSessionReplaced?.();
        return;
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
