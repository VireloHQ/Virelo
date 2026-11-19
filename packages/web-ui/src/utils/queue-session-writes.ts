interface WriteScope {
  active: boolean;
  generation: number;
  tails: Map<string, Promise<void>>;
}
const scopes = new WeakMap<object, WriteScope>();
function scopeFor(client: object) {
  let scope = scopes.get(client);
  if (!scope) {
    scope = { active: true, generation: 0, tails: new Map() };
    scopes.set(client, scope);
  }
  return scope;
}

export function stopQueueSessionWrites(client: object) {
  const scope = scopeFor(client);
  scope.active = false;
  scope.generation++;
}

export function activateQueueSessionWrites(client: object) {
  scopeFor(client).active = true;
  // Cleanup must stop the current lifetime, including recovery after a failed logout.
  return () => stopQueueSessionWrites(client);
}

export function enqueueQueueSessionWrite(client: object, key: string, operation: () => Promise<unknown>): Promise<boolean> {
  const scope = scopeFor(client), generation = scope.generation;
  if (!scope.active) return Promise.resolve(false);
  const current = () => scope.active && scope.generation === generation;
  const result = (scope.tails.get(key) ?? Promise.resolve()).then(async () => {
    if (!current()) return false;
    try { await operation(); }
    catch (error) { if (!current()) return false; throw error; }
    return current();
  });
  // A failed write is reported to its caller, but cannot poison subsequent saves/deletes.
  const tail = result.then(() => {}, () => {});
  scope.tails.set(key, tail);
  void tail.then(() => { if (scope.tails.get(key) === tail) scope.tails.delete(key); });
  return result;
}

export async function waitForQueueSessionWrites(client: object, key: string): Promise<void> {
  const scope = scopeFor(client), generation = scope.generation;
  for (;;) {
    if (!scope.active || scope.generation !== generation) throw new Error('Queue session writes stopped.');
    const tail = scope.tails.get(key);
    if (!tail) return;
    await tail;
  }
}
