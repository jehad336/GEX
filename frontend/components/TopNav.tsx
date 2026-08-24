'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
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

const SCREEN_LINKS = [
  { label: 'Overview', short: 'Home', anchor: 'market-overview' },
  { label: 'Chart', short: 'Chart', anchor: 'chart' },
  { label: 'Gamma Profile', short: 'Gamma', anchor: 'gamma-profile' },
  { label: '0DTE', short: '0DTE', anchor: 'zero-dte' },
  { label: 'Flow', short: 'Flow', anchor: 'flow' },
  { label: 'Volatility', short: 'Vol', anchor: 'volatility' },
  { label: 'History', short: 'History', anchor: 'history' },
  { label: 'Watchlist', short: 'Watch', anchor: 'watchlist' },
  { label: 'Opportunities', short: 'Scanner', anchor: 'opportunities' },
] as const;

export function TopNav({
  symbol,
  onSymbolChange,
  settings,
  onOpenSettings,
  streamState,
  lastUpdated,
  latencyMs,
  quickSymbols,
  activeView = 'dashboard',
}: {
  symbol: string;
  onSymbolChange: (s: string) => void;
  settings: DashboardSettings;
  onOpenSettings: () => void;
  streamState: StreamState;
  lastUpdated: string | null;
  latencyMs: number | null;
  quickSymbols: string[];
  activeView?: 'dashboard' | 'exposure';
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
    <header className="sticky top-0 z-40 border-b border-line/90 bg-bg/90 shadow-[0_12px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl">
      <div className="mx-auto max-w-[1920px]">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <div className="flex min-w-0 shrink-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-gradient-to-br from-accent/25 to-exposurePos/5 text-base font-black text-accent shadow-[0_0_24px_rgba(96,165,250,0.12)]">
              Γ
            </div>
            <div className="hidden leading-none sm:block">
              <div className="text-sm font-bold tracking-tight">GEX Terminal</div>
              <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.18em] text-faint">
                Options intelligence
              </div>
            </div>
            <span className="tnum rounded-lg border border-accent/25 bg-accent/10 px-2 py-1 text-sm font-bold text-accent">
              {symbol}
            </span>
          </div>

          <div ref={boxRef} className="relative order-3 w-full md:order-none md:min-w-[240px] md:max-w-xl md:flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint" aria-hidden="true">
              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.7">
                <circle cx="8.5" cy="8.5" r="5.25" />
                <path d="m12.5 12.5 4 4" />
              </svg>
            </span>
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
              placeholder="Search symbol or company…"
              aria-label="Symbol search"
              className="h-10 w-full rounded-xl border border-line bg-raised/80 pl-9 pr-12 text-sm text-ink shadow-inner outline-none placeholder:text-faint transition focus:border-accent/70 focus:ring-2 focus:ring-accent/10"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-bg px-1.5 py-0.5 text-[9px] text-faint sm:block">
              ↵
            </kbd>
            {open && results.length > 0 ? (
              <ul className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-72 overflow-auto rounded-xl border border-line bg-surface/98 p-1 shadow-2xl backdrop-blur">
                {results.map((result) => (
                  <li key={result.symbol}>
                    <button
                      type="button"
                      onClick={() => select(result.symbol)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-raised"
                    >
                      <span className="font-bold text-ink">{result.symbol}</span>
                      <span className="truncate text-2xs text-faint">{result.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {marketMeta && status ? (
              <span
                className={clsx('chip h-7', marketMeta.className)}
                title={`${status.timezone}: ${formatTime(status.local_time)}\n${status.note}`}
              >
                <span className="sm:hidden">{status.state === 'OPEN' ? 'Open' : status.state.replace('_', ' ')}</span>
                <span className="hidden sm:inline">{marketMeta.label}</span>
              </span>
            ) : null}
            {providers?.demo_banner ? <FreshnessBadge status="DEMO" /> : null}
            <span className={clsx('hidden h-7 items-center gap-1.5 rounded-lg border border-line bg-raised px-2 text-[10px] font-semibold lg:inline-flex', stream.className)} title={stream.help}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {stream.label}
            </span>
            <div className="hidden min-w-[92px] text-right text-[10px] leading-tight xl:block">
              <div className="font-semibold text-muted">
                {lastUpdated ? formatTime(lastUpdated, settings.timezone) : '--'}
                {age !== null ? <span className="ml-1 text-faint">{age}s</span> : null}
              </div>
              <div className="mt-0.5 text-faint">
                {activeProvider.toUpperCase()} · {latencyMs !== null ? `${Math.round(latencyMs)}ms` : '--'}
                {providerDetail && !providerDetail.available ? <span className="ml-1 text-neg">offline</span> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-raised text-muted transition hover:border-accent/50 hover:text-ink"
              aria-label="Open settings"
              title="Settings"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.6" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h14" />
                <circle cx="7" cy="5" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="13" cy="10" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="8" cy="15" r="1.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line/80 px-2 sm:px-4">
          <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5" aria-label="Primary screens">
            {SCREEN_LINKS.map(({ label, short, anchor }) => (
              <Link
                key={anchor}
                href={`/?symbol=${encodeURIComponent(symbol)}#${anchor}`}
                className={clsx(
                  'shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition sm:text-[11px]',
                  activeView === 'dashboard' && anchor === 'market-overview'
                    ? 'bg-accent/15 text-accent'
                    : 'text-muted hover:bg-raised hover:text-ink',
                )}
              >
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
            <Link
              href={`/exposure?symbol=${encodeURIComponent(symbol)}`}
              className={clsx(
                'shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition sm:text-[11px]',
                activeView === 'exposure' ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-raised hover:text-ink',
              )}
            >
              <span className="sm:hidden">Ladder</span>
              <span className="hidden sm:inline">Exposure Ladder</span>
            </Link>
          </nav>

          <div className="no-scrollbar hidden max-w-[42vw] shrink-0 items-center gap-1 overflow-x-auto border-l border-line pl-2 lg:flex">
            {quickSymbols.map((quickSymbol) => (
              <button
                key={quickSymbol}
                type="button"
                onClick={() => select(quickSymbol)}
                className={clsx(
                  'shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold transition',
                  quickSymbol === symbol
                    ? 'bg-accent/15 text-accent'
                    : 'text-faint hover:bg-raised hover:text-ink',
                )}
              >
                {quickSymbol}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
