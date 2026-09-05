export function formatTimeControl(initialSeconds: number, incrementSeconds: number): string {
  return `${Math.round(initialSeconds / 60)}+${incrementSeconds}`;
}

/** The agreed power budget, phrased the way the lobby picker offers it: N
 *  charges of *each* power, per player, or plain chess at 0. */
export function formatPowers(powersPerPlayer: number): string {
  if (powersPerPlayer <= 0) {
    return "no powers";
  }
  return `${powersPerPlayer} of each power`;
}
