'use client';

import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

import { apiGet } from '@/lib/api';
import { formatTime, secondsSince } from '@/lib/format';
import { useDebounced, useNow, type StreamState } from '@/lib/hooks';
import type { DashboardSettings, MarketStatus, ProvidersResponse } from '@/lib/types';
import { FreshnessBadge } from './ui';

const MARKET_STATE_META: Record<MarketStatus['state'], { label: string; className: string }> = {
  OPEN: { label: 'Market Open', className: 'border-pos/40 bg-pos/10 text-pos' },
  PRE_MARKET: { label: 'Pre-Market', className: 'border-warn/40 bg-warn/10 text-warn' },
  AFTER_HOURS: { label: 'After Hours', className: 'border-warn/40 bg-warn/10 text-warn' },
  CLOSED: { label: 'Market Closed', className: 'border-faint/40 bg-raised text-muted' },
};

const STREAM_META: Record<StreamState, { label: string; className: string; help: string }> = {
  open: { label: 'STREAM', className: 'text-pos', help: 'WebSocket connected; pushes are live.' },
  connecting: { label: 'CONNECTING', className: 'text-warn', help: 'Opening the WebSocket.' },
  closed: {
    label: 'POLLING',
    className: 'text-muted',
    help: 'WebSocket closed. Panels are refreshing on the polling interval instead.',
  },
  error: {
    label: 'STREAM DOWN',
    className: 'text-neg',
    help: 'WebSocket failed. Falling back to polling; data may lag.',
  },
};

interface SearchResult {
  symbol: string;
  name: string;
  type: string;
}

export function TopNav({
  symbol,
  onSymbolChange,
  settings,
  onOpenSettings,
  streamState,
  lastUpdated,
  latencyMs,
  quickSymbols,
}: {
  symbol: string;
  onSymbolChange: (s: string) => void;
  settings: DashboardSettings;
  onOpenSettings: () => void;
  streamState: StreamState;
  lastUpdated: string | null;
  latencyMs: number | null;
  quickSymbols: string[];
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const debounced = useDebounced(query, 220);
  const now = useNow(1000);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [s, p] = await Promise.all([
          apiGet<MarketStatus>('/api/market/status'),
          apiGet<ProvidersResponse>('/api/providers'),
        ]);
        if (!cancelled) {
          setStatus(s);
          setProviders(p);
        }
      } catch {
        /* the header degrades quietly; the panels report the real error */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const term = debounced.trim();
    if (term.length < 1) return;
    let cancelled = false;
    apiGet<{ results: SearchResult[] }>(`/api/symbols/search?q=${encodeURIComponent(term)}`)
      .then((r) => !cancelled && setFetched(r.results))
      .catch(() => !cancelled && setFetched([]));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  // Derived: an empty box shows nothing without needing a state write.
  const results = debounced.trim().length < 1 ? [] : fetched;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const select = (s: string) => {
    onSymbolChange(s.toUpperCase());
    setQuery('');
    setOpen(false);
  };

  // `now` ticks every second, so this recomputes and the age stays truthful
  // even when no new snapshot has arrived.
  const age = useMemo(() => {
    void now;
    const secs = secondsSince(lastUpdated);
    return secs === null ? null : Math.round(secs);
  }, [lastUpdated, now]);

  const activeProvider = providers?.active ?? '--';
  const providerDetail = providers?.providers.find((p) => p.name === activeProvider);
  const stream = STREAM_META[streamState];
  const marketMeta = status ? MARKET_STATE_META[status.state] : null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        {/* brand */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-accent/15 text-sm font-black text-accent">
            Γ
          </div>
          <div className="leading-none">
            <div className="text-sm font-bold tracking-tight">GEX Dashboard</div>
            <div className="text-2xs text-faint">Options positioning</div>
          </div>
        </div>

        {/* search */}
        <div ref={boxRef} className="relative w-56">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) select(query.trim());
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Search any US ticker…"
            aria-label="Symbol search"
            className="w-full rounded border border-line bg-raised px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
          {open && results.length > 0 ? (
            <ul className="absolute left-0 top-full z-50 mt-1 max-h-72 w-72 overflow-auto rounded border border-line bg-surface shadow-xl">
              {results.map((r) => (
                <li key={r.symbol}>
                  <button
                    type="button"
                    onClick={() => select(r.symbol)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-raised"
                  >
                    <span className="font-semibold">{r.symbol}</span>
                    <span className="truncate text-2xs text-faint">{r.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* quick symbols */}
        <div className="flex flex-wrap items-center gap-1">
          {quickSymbols.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => select(s)}
              className={clsx('btn', s === symbol && 'btn-active')}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {marketMeta && status ? (
            <span
              className={clsx('chip', marketMeta.className)}
              title={`${status.timezone}: ${formatTime(status.local_time)}\n${status.note}`}
            >
              {marketMeta.label}
            </span>
          ) : null}

          {providers?.demo_banner ? <FreshnessBadge status="DEMO" /> : null}

          <div className="text-2xs leading-tight">
            <div className="text-faint">Provider</div>
            <div
              className="font-semibold uppercase text-muted"
              title={providerDetail?.message ?? undefined}
            >
              {activeProvider}
              {providerDetail && !providerDetail.available ? (
                <span className="ml-1 text-neg">offline</span>
              ) : null}
            </div>
          </div>

          <div className="text-2xs leading-tight">
            <div className="text-faint">Latency</div>
            <div className="tnum font-semibold text-muted">
              {latencyMs !== null ? `${Math.round(latencyMs)} ms` : '--'}
            </div>
          </div>

          <div className="text-2xs leading-tight">
            <div className="text-faint">Updated</div>
            <div className="tnum font-semibold text-muted">
              {lastUpdated ? `${formatTime(lastUpdated, settings.timezone)}` : '--'}
              {age !== null ? (
                <span className="ml-1 text-faint">({age}s)</span>
              ) : null}
            </div>
          </div>

          <span className={clsx('chip border-line bg-raised', stream.className)} title={stream.help}>
            {stream.label}
          </span>

          <button type="button" onClick={onOpenSettings} className="btn" aria-label="Open settings">
            Settings
          </button>
        </div>
      </div>
    </header>
  );
}
