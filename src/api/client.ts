export type Power = {
  id: "best_move" | "current_eval";
  name: string;
  description: string;
  visibility: "private";
};

export type User = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  rating: number;
  rating_deviation: number;
  wins: number;
  losses: number;
  draws: number;
  created_at: string;
};

export type PublicUser = {
  id: string;
  username: string;
  display_name: string;
  rating: number;
};

/** One row of a user's game history, from that user's own perspective. */
export type GameSummary = {
  id: string;
  opponent: PublicUser;
  played_white: boolean;
  result: "win" | "loss" | "draw" | "aborted";
  end_reason?: string;
  rating_change?: number;
  initial_seconds: number;
  increment_seconds: number;
  ended_at: string;
};

export type RecentGamesPage = {
  games: GameSummary[];
  page: number;
  has_more: boolean;
};

export type Tokens = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

export type Session = { user: User; tokens: Tokens };

export type Registration = {
  username: string;
  email: string;
  password: string;
  display_name?: string;
  invite_code?: string;
};

export type Seek = {
  id: string;
  initial_seconds: number;
  increment_seconds: number;
  rating_band: number;
  created_at: string;
  expires_at: string;
};

/** black is null while status is "waiting" — an invite link with no
 *  opponent yet. Every other status guarantees it's populated. */
export type Game = {
  id: string;
  white: PublicUser;
  black: PublicUser | null;
  initial_seconds: number;
  increment_seconds: number;
  status: string;
  created_at: string;
};

export type SeekRequest = {
  initial_seconds: number;
  increment_seconds: number;
  rating_band?: number;
};

export type InviteRequest = {
  initial_seconds: number;
  increment_seconds: number;
};

export type SeekResult = {
  status: "none" | "pending" | "waiting" | "matched";
  seek: Seek | null;
  game: Game | null;
};

export type ClockFrame = { white_ms: number; black_ms: number };

/** Redis is the live authority for a game in progress (see backend
 *  CLAUDE.md), so a game's move history only exists two ways: `moves` (UCI
 *  strings, from Redis) while it's live, or `pgn` (a full transcript) once
 *  it's finished — never both, and a game that hasn't started yet has
 *  neither. A "waiting" invite (no opponent yet) carries none of the board
 *  fields at all — there's no actor and no Redis live state for it. */
export type GameSnapshot = {
  game: Game;
  status: string;
  fen?: string;
  turn?: "white" | "black";
  ply?: number;
  clocks?: ClockFrame;
  moves?: string[];
  result?: "white" | "black" | "draw";
  end_reason?: string;
  pgn?: string;
  /** Only set for a decisive/drawn finished game — never for an abort. */
  white_rating_change?: number;
  black_rating_change?: number;
};

/** ApiError carries the server's machine-readable code so callers can branch on
 *  the reason rather than on message text. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }

  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

// Empty in dev, where vite.config.ts proxies /api to :8080. Set at build time
// on Cloudflare Pages, where the API is a different origin.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (signal?.aborted) {
      throw cause;
    }
    throw new ApiError(0, "network_error", "Cannot reach the server. Is the backend running?");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const problem = (payload ?? {}) as { error?: string; code?: string; field?: string };
    throw new ApiError(
      response.status,
      problem.code ?? "unknown_error",
      problem.error ?? `Request failed (${response.status})`,
      problem.field,
    );
  }

  return payload as T;
}

export const api = {
  powers: (signal?: AbortSignal) =>
    request<{ powers: Power[] }>("/api/v1/powers", { signal }).then((body) => body.powers),

  register: (registration: Registration) =>
    request<Session>("/api/v1/auth/register", { method: "POST", body: registration }),

  login: (login: string, password: string) =>
    request<Session>("/api/v1/auth/login", { method: "POST", body: { login, password } }),

  refresh: (refreshToken: string) =>
    request<Session>("/api/v1/auth/refresh", { method: "POST", body: { refresh_token: refreshToken } }),

  logout: (refreshToken: string) =>
    request<void>("/api/v1/auth/logout", { method: "POST", body: { refresh_token: refreshToken } }),

  me: (token: string, signal?: AbortSignal) => request<User>("/api/v1/me", { token, signal }),

  recentGames: (token: string, page: number, signal?: AbortSignal) =>
    request<RecentGamesPage>(`/api/v1/me/games?page=${page}`, { token, signal }),

  createSeek: (token: string, seek: SeekRequest) =>
    request<SeekResult>("/api/v1/seeks", { method: "POST", token, body: seek }),

  currentSeek: (token: string, signal?: AbortSignal) =>
    request<SeekResult>("/api/v1/seeks/me", { token, signal }),

  cancelSeek: (token: string) => request<void>("/api/v1/seeks/me", { method: "DELETE", token }),

  createInvite: (token: string, invite: InviteRequest) =>
    request<Game>("/api/v1/games/invite", { method: "POST", token, body: invite }),

  joinGame: (token: string, gameID: string) =>
    request<Game>(`/api/v1/games/${encodeURIComponent(gameID)}/join`, { method: "POST", token }),

  abortGame: (token: string, gameID: string) =>
    request<Game>(`/api/v1/games/${encodeURIComponent(gameID)}/abort`, { method: "POST", token }),

  gameSnapshot: (token: string, gameID: string, signal?: AbortSignal) =>
    request<GameSnapshot>(`/api/v1/games/${encodeURIComponent(gameID)}`, { token, signal }),
};
