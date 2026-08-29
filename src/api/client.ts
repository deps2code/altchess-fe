export type Power = {
  id: "best_move" | "current_eval";
  name: string;
  description: string;
  visibility: "private";
};

type PowersResponse = { powers: Power[] };

export async function getPowers(signal?: AbortSignal): Promise<Power[]> {
  const response = await fetch("/api/v1/powers", {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Power catalogue request failed (${response.status})`);
  }

  const data = (await response.json()) as PowersResponse;
  return data.powers;
}

