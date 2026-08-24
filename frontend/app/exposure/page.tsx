'use client';

import { clsx } from 'clsx';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { API_BASE, STATIC_DEMO, apiGet } from '@/lib/api';
import { formatDateShort, formatNumber, formatPrice, formatTime } from '@/lib/format';
import { useApi, useSettings, useSymbolStream } from '@/lib/hooks';
import { getServerStars, getStars, subscribeStars, toggleStar } from '@/lib/starStore';
import type {
  ExpirationMode,
  LadderMetric,
  LadderResponse,
  LadderRow,
  LadderView,
  MarketStatus,
} from '@/lib/types';

import { AnalyticsPanel } from '@/components/exposure/AnalyticsPanel';
import { LadderTable, type SortKey } from '@/components/exposure/LadderTable';
import { StrikeDrawer } from '@/components/exposure/StrikeDrawer';
import { MainNav } from '@/components/MainNav';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import {
  ErrorBlock,
  FreshnessBadge,
  Info,
  LoadingBlock,
  QualityIndicator,
  SegmentedControl,
} from '@/components/ui';

const SYMBOLS = ['SPX', 'SPY', 'QQQ', 'NDX', 'IWM', 'DIA', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'MSFT', 'AMZN', 'META'];

const EXPIRY_MODES: { label: string; value: ExpirationMode }[] = [
  { label: '0DTE', value: '0dte' },
  { label: '1DTE', value: '1dte' },
  { label: '≤7D', value: 'weekly' },
  { label: '≤30D', value: 'monthly' },
  { label: 'All', value: 'all' },
];
const STRIKE_RANGES = [1, 2, 3, 5, 10];
const METRICS: { label: string; value: LadderMetric }[] = [
  { label: 'All', value: 'all' },
  { label: 'GEX', value: 'gex' },
  { label: 'DEX', value: 'dex' },
  { label: 'Vanna', value: 'vanna' },
  { label: 'Charm', value: 'charm' },
  { label: 'OI', value: 'oi' },
  { label: 'Volume', value: 'volume' },
];

export default function ExposureLadderPage() {
  return (
    <Suspense fallback={<div className="p-6"><LoadingBlock rows={10} label="Loading Exposure Ladder" /></div>}>
      <ExposureLadder />
    </Suspense>
  );
}

function ExposureLadder() {
  const router = useRouter();
  const params = useSearchParams();
  const { settings, update, loaded } = useSettings();

  // ---- URL is the source of truth for the shareable filters ----------------
  const symbol = (params.get('symbol') ?? 'SPX').toUpperCase();
  const expiryMode = (params.get('expiry') ?? 'all') as ExpirationMode;
  const singleExpiry = params.get('exp');
  const rangeParam = params.get('range');
  const strikeRange = rangeParam === 'all' ? null : Number(rangeParam ?? 3);
  const metric = (params.get('metric') ?? 'all') as LadderMetric;
  const view = (params.get('view') ?? 'advanced') as LadderView;

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/exposure?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const [sortKey, setSortKey] = useState<SortKey>('strike');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedRow, setSelectedRow] = useState<LadderRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [followSpot, setFollowSpot] = useState(false);
  const [status, setStatus] = useState<MarketStatus | null>(null);

  const spotRowRef = useRef<HTMLTableRowElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('light', settings.theme === 'light');
  }, [settings.theme]);

  // Read through the external store, so a symbol change does not cascade.
  const starred = useSyncExternalStore(
    subscribeStars,
    () => getStars(symbol),
    getServerStars,
  );

  useEffect(() => {
    apiGet<MarketStatus>('/api/market/status').then(setStatus).catch(() => setStatus(null));
  }, []);

  const onToggleStar = useCallback((strike: number) => toggleStar(symbol, strike), [symbol]);

  // ---- data ---------------------------------------------------------------
  const query = useMemo(() => {
    const q = new URLSearchParams({ expirationMode: expiryMode });
    if (expiryMode === 'single' && singleExpiry) q.set('expiration', singleExpiry);
    if (strikeRange !== null) q.set('strikeRange', String(strikeRange));
    if (settings.convention) q.set('convention', settings.convention);
    if (settings.provider) q.set('provider', settings.provider);
    return q.toString();
  }, [expiryMode, singleExpiry, strikeRange, settings.convention, settings.provider]);

  const { data, error, isLoading, mutate } = useApi<LadderResponse>(
    loaded ? `/api/exposure/${symbol}/ladder?${query}` : null,
    { refreshInterval: settings.refreshSeconds * 1000 },
  );

  // The socket updates spot between chain refreshes; the ladder itself is
  // recomputed on the polling interval rather than on every tick.
  const stream = useSymbolStream(symbol, loaded);
  const liveSpot =
    stream.underlying?.symbol === symbol ? stream.underlying.price : (data?.spot ?? null);

  const ladder = data?.symbol === symbol ? data : null;

  const rows = useMemo(() => {
    if (!ladder) return [];
    const copy = [...ladder.rows];
    copy.sort((a, b) => {
      const av = a[sortKey as keyof LadderRow] as number;
      const bv = b[sortKey as keyof LadderRow] as number;
      return sortAsc ? av - bv : bv - av;
    });
    return copy;
  }, [ladder, sortKey, sortAsc]);

  const onSort = useCallback((k: SortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setSortAsc((a) => !a);
        return prev;
      }
      setSortAsc(false);
      return k;
    });
  }, []);

  const centerOnSpot = useCallback(() => {
    spotRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // Centre once the first payload lands, and again on each refresh when Follow
  // Spot is on. Default off so it does not yank the view during analysis.
  const centeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ladder) return;
    const key = `${symbol}:${expiryMode}:${strikeRange}`;
    if (centeredFor.current !== key) {
      centeredFor.current = key;
      requestAnimationFrame(centerOnSpot);
    } else if (followSpot) {
      requestAnimationFrame(centerOnSpot);
    }
  }, [ladder, symbol, expiryMode, strikeRange, followSpot, centerOnSpot]);

  // ---- keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, () => void> = {
        c: centerOnSpot,
        '0': () => setParams({ expiry: '0dte', exp: null }),
        a: () => setParams({ expiry: 'all', exp: null }),
        g: () => setParams({ metric: 'gex' }),
        d: () => setParams({ metric: 'dex' }),
        v: () => setParams({ metric: 'vanna' }),
        h: () => setParams({ metric: 'charm' }),
      };
      const fn = map[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [centerOnSpot, setParams]);

  const onSelectExpiration = useCallback(
    (iso: string) => {
      if (expiryMode === 'single' && singleExpiry === iso) setParams({ expiry: 'all', exp: null });
      else setParams({ expiry: 'single', exp: iso });
    },
    [expiryMode, singleExpiry, setParams],
  );

  const freshness = ladder?.freshness;

  return (
    <div className="min-h-screen">
      {/* ---------------- toolbar ---------------- */}
      <header className="z-40 border-b border-line/90 bg-bg/90 shadow-[0_12px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl md:sticky md:top-0">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-gradient-to-br from-accent/25 to-exposurePos/5 text-base font-black text-accent">
              Γ
            </div>
            <div className="min-w-0 leading-none">
              <div className="truncate text-sm font-bold tracking-tight"><span className="sm:hidden">Ladder</span><span className="hidden sm:inline">Exposure Ladder</span></div>
              <div className="mt-1 hidden text-[9px] font-medium uppercase tracking-[0.16em] text-faint sm:block">GEX / Greeks matrix</div>
            </div>
            <span className="tnum rounded-lg border border-accent/25 bg-accent/10 px-2 py-1 text-sm font-bold text-accent">{symbol}</span>
          </div>

          <MainNav className="hidden lg:flex" symbol={symbol} />

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {status ? (
              <span className={clsx('chip', status.state === 'OPEN'
                ? 'border-pos/40 bg-pos/10 text-pos'
                : status.state === 'CLOSED'
                  ? 'border-line bg-raised text-muted'
                  : 'border-warn/40 bg-warn/10 text-warn')}>
                {status.state.replace('_', '-')}
              </span>
            ) : null}
            {/* Freshness already reports DEMO; a second chip would just repeat it. */}
            {freshness ? (
              <FreshnessBadge status={freshness.status} asOf={freshness.asOf} />
            ) : null}
            <span className="hidden sm:inline-flex"><QualityIndicator quality={ladder?.quality} /></span>
            <div className="hidden items-center gap-4 xl:flex">
              <Meta label="Provider" value={ladder?.provider ?? '–'} />
              <Meta
                label="Latency"
                value={ladder ? `${Math.round(ladder.latencyMs)} ms` : '–'}
                title="Time to fetch and normalize the chain"
              />
              <Meta
                label="Updated"
                value={ladder ? formatTime(ladder.timestamp, settings.timezone) : '–'}
              />
            </div>
            <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
              <span className="sm:hidden">Tune</span><span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>

        <div className="no-scrollbar overflow-x-auto border-t border-line/80 px-2 py-1.5 lg:hidden">
          <MainNav className="min-w-max" symbol={symbol} />
        </div>

        {/* symbol + spot */}
        <div className="flex flex-col gap-2 border-t border-line/80 px-3 py-2 sm:flex-row sm:items-center sm:px-4">
          <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
            {SYMBOLS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setParams({ symbol: s })}
                className={clsx('btn shrink-0', s === symbol && 'btn-active')}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-baseline justify-between gap-2 sm:ml-auto sm:justify-start">
            <span className="stat-label">Spot</span>
            <span className="tnum text-lg font-bold sm:text-xl">
              {liveSpot != null ? formatPrice(liveSpot) : '–'}
            </span>
            {ladder ? (
              <span className="tnum truncate text-[9px] text-faint sm:text-2xs">
                {formatNumber(ladder.expirationSelection.contractsInScope)} contracts ·{' '}
                {ladder.expirationSelection.strikesVisible} of{' '}
                {ladder.expirationSelection.strikesInScope} strikes
              </span>
            ) : null}
          </div>
        </div>

        {/* filters */}
        <div className="no-scrollbar flex items-end gap-4 overflow-x-auto border-t border-line/80 px-3 py-2 sm:px-4">
          <Filter label="Expiration">
            <SegmentedControl
              size="xs"
              value={expiryMode === 'single' ? 'single' : expiryMode}
              onChange={(v) => setParams({ expiry: String(v), exp: null })}
              options={[
                ...EXPIRY_MODES,
                ...(expiryMode === 'single'
                  ? [{ label: singleExpiry ? formatDateShort(singleExpiry) : 'Single', value: 'single' as ExpirationMode }]
                  : []),
              ]}
            />
          </Filter>

          <Filter label="Strike range">
            <SegmentedControl
              size="xs"
              value={strikeRange === null ? 'all' : strikeRange}
              onChange={(v) => setParams({ range: String(v) })}
              options={[
                ...STRIKE_RANGES.map((r) => ({ label: `±${r}%`, value: r })),
                { label: 'All', value: 'all' as const },
              ]}
            />
          </Filter>

          <Filter label="Exposure">
            <SegmentedControl
              size="xs"
              value={metric}
              onChange={(v) => setParams({ metric: String(v) })}
              options={METRICS}
            />
          </Filter>

          <Filter label="View">
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => setParams({ view: String(v) })}
              options={[
                { label: 'Compact', value: 'compact' as LadderView },
                { label: 'Advanced', value: 'advanced' as LadderView },
              ]}
            />
          </Filter>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button type="button" className="btn" onClick={centerOnSpot} title="Shortcut: C">
              Center on Spot
            </button>
            <button
              type="button"
              onClick={() => setFollowSpot((v) => !v)}
              aria-pressed={followSpot}
              className={clsx('btn', followSpot && 'btn-active')}
              title="Re-centre the ladder on every refresh"
            >
              Follow Spot
            </button>
            {sortKey !== 'strike' ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSortKey('strike');
                  setSortAsc(false);
                }}
              >
                Reset to Strike Ladder
              </button>
            ) : null}
            {!STATIC_DEMO ? (
              <a
                href={`${API_BASE}/api/exposure/${symbol}/ladder?${query}`}
                target="_blank"
                rel="noreferrer"
                className="btn"
                title="Raw JSON from the backend"
              >
                API
              </a>
            ) : null}
          </div>
        </div>
      </header>

      {ladder?.demoBanner ? (
        <div className="border-b border-accent/40 bg-accent/10 px-4 py-1.5">
          <p className="text-center text-2xs font-semibold text-accent">
            <span className="sm:hidden">DEMO DATA — synthetic evaluation feed, not market data.</span>
            <span className="hidden sm:inline">DEMO DATA — {ladder.demoBanner.message}</span>
          </p>
        </div>
      ) : null}

      {/* ---------------- body ---------------- */}
      <main className="grid gap-2.5 p-2.5 sm:gap-3 sm:p-3 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="panel min-w-0">
          <header className="panel-head">
            <div className="flex items-center gap-1.5">
              <h2 className="panel-title">Strike Ladder</h2>
              <Info term="gex" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {freshness?.openInterestAsOf ? (
                <span className="chip border-warn/35 bg-warn/5 text-warn" title={freshness.note ?? undefined}>
                  OI as of {formatTime(freshness.openInterestAsOf, settings.timezone)}
                </span>
              ) : null}
              <span className="text-2xs text-faint">
                {ladder ? `${ladder.calculationMs.toFixed(0)} ms calc` : ''}
              </span>
            </div>
          </header>

          {/* The single scroll container for the ladder, so the sticky header
              and sticky strike column anchor to it on both axes. */}
          <div ref={scrollRef} className="max-h-[calc(100vh-250px)] min-h-[320px] overflow-auto">
            {error ? (
              <div className="p-4">
                <ErrorBlock
                  error={error}
                  onRetry={() => mutate()}
                  lastUpdated={ladder?.timestamp ?? null}
                />
              </div>
            ) : isLoading && !ladder ? (
              <LadderSkeleton />
            ) : ladder ? (
              <LadderTable
                rows={rows}
                spot={liveSpot ?? ladder.spot}
                keyLevels={ladder.keyLevels}
                metric={metric}
                view={view}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                oiQuartiles={ladder.oiQuartiles}
                starred={starred}
                onToggleStar={onToggleStar}
                onSelectStrike={setSelectedRow}
                spotRowRef={spotRowRef}
              />
            ) : (
              <LadderSkeleton />
            )}
          </div>
        </section>

        <aside className="min-w-0">
          {ladder ? (
            <AnalyticsPanel
              data={ladder}
              units={settings.units}
              onSelectExpiration={onSelectExpiration}
              selectedExpirations={expiryMode === 'single' && singleExpiry ? [singleExpiry] : []}
            />
          ) : (
            <div className="panel p-4">
              <LoadingBlock rows={8} />
            </div>
          )}
        </aside>
      </main>

      <footer className="px-4 pb-8 text-center text-2xs leading-relaxed text-faint">
        <p className="mx-auto max-w-4xl">
          {ladder?.disclaimer ??
            'Signed exposure is model-derived; open interest, volume and IV are observed.'}{' '}
          Shortcuts: C centre on spot · 0 same-day · A all expirations · G/D/V/H switch exposure.
        </p>
      </footer>

      <StrikeDrawer
        row={selectedRow}
        symbol={symbol}
        spot={liveSpot ?? ladder?.spot ?? 0}
        settings={settings}
        onClose={() => setSelectedRow(null)}
      />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={update}
      />
    </div>
  );
}

function Meta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="text-2xs leading-tight" title={title}>
      <div className="text-faint">{label}</div>
      <div className="tnum font-semibold uppercase text-muted">{value}</div>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="stat-label whitespace-nowrap">{label}</span>
      {children}
    </div>
  );
}

/** Skeleton shaped like the ladder, so the layout does not jump when data lands. */
function LadderSkeleton() {
  return (
    <div className="space-y-1 p-3" role="status" aria-label="Loading ladder">
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-16 animate-pulse rounded bg-raised" />
          <div className="h-4 w-12 animate-pulse rounded bg-raised" />
          <div className="h-4 flex-1 animate-pulse rounded bg-raised" />
          <div className="h-4 flex-1 animate-pulse rounded bg-raised" />
          <div className="h-4 w-20 animate-pulse rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}
