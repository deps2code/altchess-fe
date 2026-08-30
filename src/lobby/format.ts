export function formatTimeControl(initialSeconds: number, incrementSeconds: number): string {
  return `${Math.round(initialSeconds / 60)}+${incrementSeconds}`;
}
