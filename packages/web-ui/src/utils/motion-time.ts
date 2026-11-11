export function cssTimeToMilliseconds(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/);
  return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : 0;
}
