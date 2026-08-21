/**
 * Starred strikes, per symbol, persisted in localStorage.
 *
 * Read through useSyncExternalStore for the same reason the settings store is:
 * hydrating browser storage inside an effect triggers a cascading render on
 * every mount and every symbol change.
 */

const KEY = 'gex.ladder.stars.v1';

const EMPTY: ReadonlySet<number> = new Set<number>();

// Snapshots must be referentially stable between changes, so each symbol's set
// is cached and only replaced when it actually changes.
const cache = new Map<string, ReadonlySet<number>>();
const listeners = new Set<() => void>();

function read(symbol: string): ReadonlySet<number> {
  try {
    const raw = window.localStorage.getItem(`${KEY}.${symbol}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'number') : []);
  } catch {
    // Private mode, blocked storage, or corrupt JSON: no stars is fine.
    return new Set<number>();
  }
}

export function subscribeStars(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (!e.key?.startsWith(KEY)) return;
    cache.clear();
    for (const l of listeners) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getStars(symbol: string): ReadonlySet<number> {
  let set = cache.get(symbol);
  if (!set) {
    set = read(symbol);
    cache.set(symbol, set);
  }
  return set;
}

export function getServerStars(): ReadonlySet<number> {
  return EMPTY;
}

export function toggleStar(symbol: string, strike: number): void {
  const next = new Set(getStars(symbol));
  if (next.has(strike)) next.delete(strike);
  else next.add(strike);
  cache.set(symbol, next);
  try {
    window.localStorage.setItem(`${KEY}.${symbol}`, JSON.stringify([...next]));
  } catch {
    // Persisting is best-effort; the in-memory set still applies this session.
  }
  for (const l of listeners) l();
}
