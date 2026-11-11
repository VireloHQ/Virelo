export function validateShortsSearch(input: Record<string, unknown>): { startId?: number } {
  const value = input.startId;
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? { startId: id } : {};
}
