/**
 * Settings live outside React and are read with useSyncExternalStore.
 *
 * localStorage is an external system, so subscribing to it is the correct
 * primitive here — hydrating it inside an effect would trigger a cascading
 * re-render on every mount.
 */

import type { DashboardSettings } from './types';

export const DEFAULT_SETTINGS: DashboardSettings = {
  provider: null,
  refreshSeconds: 30,
  convention: 'calls_positive_puts_negative',
  maxDte: 30,
  strikeBandPct: 0.05,
  include0dte: true,
  units: 'billions',
  theme: 'dark',
  timezone: 'America/New_York',
};

const STORAGE_KEY = 'gex.settings.v1';

let snapshot: DashboardSettings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();

function readStorage(): DashboardSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DashboardSettings>) };
  } catch {
    // Private mode, blocked site data, or corrupt JSON: defaults are fine.
    return DEFAULT_SETTINGS;
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing settings should update this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    snapshot = readStorage();
    for (const l of listeners) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Must return a referentially stable object between changes. */
export function getSnapshot(): DashboardSettings {
  if (!hydrated) {
    snapshot = readStorage();
    hydrated = true;
  }
  return snapshot;
}

export function getServerSnapshot(): DashboardSettings {
  return DEFAULT_SETTINGS;
}

export function isHydrated(): boolean {
  return hydrated;
}

export function updateSettings(patch: Partial<DashboardSettings>): void {
  snapshot = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Persisting is best-effort; the in-memory value still applies this session.
  }
  for (const l of listeners) l();
}

/* ------------------------------------------------------------------ mount */

/**
 * Client-only flag read through the same external-store mechanism.
 *
 * Returning `typeof window !== "undefined"` directly from a render would differ
 * between the server HTML and the hydrating client render, which React reports
 * as a hydration mismatch. useSyncExternalStore is the supported way to say
 * "server says false, client says true".
 */
const noopSubscribe = () => () => {};

export function subscribeClient(): () => void {
  return noopSubscribe();
}

export function getClientSnapshot(): boolean {
  return true;
}

export function getClientServerSnapshot(): boolean {
  return false;
}
