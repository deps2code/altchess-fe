import { useEffect, useState } from "react";
import { ApiError, api, type RecentGamesPage } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { formatTimeControl } from "./format";

const resultLabels: Record<string, string> = {
  win: "Win",
  loss: "Loss",
  draw: "Draw",
  aborted: "Aborted",
};

function formatRatingChange(change: number | undefined): string {
  if (change === undefined) {
    return "—";
  }
  return change > 0 ? `+${change}` : `${change}`;
}

function formatEndedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A paginated (page size fixed at 5, set by the server) list of the
 *  signed-in user's past games, opened from their profile card. */
export function RecentGamesModal({ onClose }: { onClose: () => void }) {
  const { authorized } = useAuth();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RecentGamesPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    authorized((token) => api.recentGames(token, page, controller.signal))
      .then((next) => {
        if (!cancelled) {
          setData(next);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : "Could not load your games.");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [page, authorized]);

  return (
    <div className="modal-backdrop">
      <div className="modal games-modal" role="dialog" aria-modal="true" aria-labelledby="games-heading">
        <h3 id="games-heading">Recent games</h3>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p className="hint">Loading…</p>}

        {data && data.games.length === 0 && <p className="hint">No games yet.</p>}

        {data && data.games.length > 0 && (
          <ul className="game-history">
            {data.games.map((game) => (
              <li key={game.id}>
                <span className={`result-badge result-${game.result}`}>{resultLabels[game.result]}</span>
                <span className="game-history-opponent">
                  vs {game.opponent.display_name} ({game.played_white ? "White" : "Black"})
                </span>
                <span className="game-history-meta">
                  {formatTimeControl(game.initial_seconds, game.increment_seconds)} ·{" "}
                  {formatRatingChange(game.rating_change)} · {formatEndedAt(game.ended_at)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {data && (
          <div className="pagination">
            <button type="button" className="ghost" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
              ← Newer
            </button>
            <span>Page {page}</span>
            <button type="button" className="ghost" onClick={() => setPage((p) => p + 1)} disabled={!data.has_more}>
              Older →
            </button>
          </div>
        )}

        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
