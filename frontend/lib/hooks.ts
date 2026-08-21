'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import useSWR, { type SWRConfiguration } from 'swr';

import { ApiError, STATIC_DEMO, apiGet, chainParams, wsUrl } from './api';
import {
  DEFAULT_SETTINGS,
  getClientServerSnapshot,
  getClientSnapshot,
  getServerSnapshot,
  getSnapshot,
  subscribeClient,
  subscribe,
  updateSettings,
} from './settingsStore';
import type { DashboardSettings, GexSnapshot, Underlying } from './types';

export { DEFAULT_SETTINGS };

/** Reads persisted settings from the external store; no effect, no cascade. */
export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const update = useCallback((patch: Partial<DashboardSettings>) => updateSettings(patch), []);
  // False on the server and during hydration, true immediately after. Read via
  // the store so React does not see a hydration mismatch.
  const loaded = useSyncExternalStore(
    subscribeClient,
    getClientSnapshot,
    getClientServerSnapshot,
  );
  return { settings, update, loaded };
}

export function useApi<T>(path: string | null, options?: SWRConfiguration) {
  return useSWR<T, ApiError>(path, (p: string) => apiGet<T>(p), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    // Deliberately NOT keepPreviousData: on a symbol switch that would serve the
    // previous symbol's numbers under the new symbol's name. A loading state is
    // the honest answer.
    keepPreviousData: false,
    ...options,
  });
}

/** Panel data keyed to the shared chain filters, so every panel agrees. */
export function usePanel<T>(
  base: string | null,
  settings: DashboardSettings,
  extra?: Record<string, string | number>,
  refreshMs?: number,
) {
  const path = useMemo(() => {
    if (!base) return null;
    const params = chainParams(settings);
    if (!extra) return `${base}${params}`;
    const sep = params ? '&' : '?';
    const q = new URLSearchParams(
      Object.entries(extra).map(([k, v]) => [k, String(v)]),
    ).toString();
    return `${base}${params}${sep}${q}`;
  }, [base, settings, extra]);

  return useApi<T>(path, { refreshInterval: refreshMs ?? settings.refreshSeconds * 1000 });
}

export type StreamState = 'connecting' | 'open' | 'closed' | 'error';

/**
 * WebSocket push with exponential-backoff reconnect.
 *
 * The socket is a supplement to polling, never the only source: if it drops,
 * SWR keeps the panels current, and the header shows the degraded state rather
 * than silently displaying an old snapshot as if it were live.
 */
export function useSymbolStream(symbol: string, enabled: boolean) {
  // The symbol is stored WITH the payload. Without it, a symbol switch would
  // leave the previous symbol's spot and levels on screen under the new name
  // until the first frame arrives - the worst kind of wrong number.
  const [feed, setFeed] = useState<{
    symbol: string;
    underlying: Underlying | null;
    snapshot: GexSnapshot | null;
  }>({ symbol, underlying: null, snapshot: null });
  const [state, setState] = useState<StreamState>('closed');
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (STATIC_DEMO || !enabled || !symbol) return;

    // Owned by THIS effect run, not shared across runs. A shared ref would be
    // reset by the next effect before the old socket's async onclose fired, so
    // the previous symbol's socket would reconnect itself and keep pushing
    // frames for an instrument the user has already navigated away from.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setState('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl(symbol));
      } catch {
        setState('error');
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        retryRef.current = 0;
        setState('open');
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        setLastMessageAt(Date.now());
        try {
          const msg = JSON.parse(event.data as string) as { type: string; data?: unknown };
          if (msg.type === 'underlying') {
            const u = msg.data as Underlying;
            setFeed((prev) =>
              u.symbol === symbol ? { symbol, underlying: u, snapshot: prev.snapshot } : prev,
            );
          } else if (msg.type === 'gex') {
            const g = msg.data as GexSnapshot;
            setFeed((prev) =>
              g.symbol === symbol ? { symbol, underlying: prev.underlying, snapshot: g } : prev,
            );
          }
        } catch {
          /* a malformed frame must not kill the socket */
        }
      };

      ws.onerror = () => {
        if (!cancelled) setState('error');
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (cancelled) return;
        setState('closed');
        // Back off up to 30s so a dead backend is not hammered.
        const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
        retryRef.current += 1;
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [symbol, enabled]);

  // Derived, so a stale symbol never leaks into the current view.
  const fresh = feed.symbol === symbol;
  return {
    underlying: fresh ? feed.underlying : null,
    snapshot: fresh ? feed.snapshot : null,
    state: enabled ? state : ('closed' as StreamState),
    lastMessageAt,
  };
}

/** Ticks once a second so "updated Ns ago" stays honest without re-fetching. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
