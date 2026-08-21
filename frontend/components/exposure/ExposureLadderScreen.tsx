'use client';

import { clsx } from 'clsx';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatPrice, formatTime } from '@/lib/format';
import { useApi, useSettings, useSymbolStream } from '@/lib/hooks';
import type { ExpirationMode, ExposureLadderResponse, ExposureLadderRow } from '@/lib/types';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { TopNav } from '@/components/TopNav';
import { EmptyBlock, ErrorBlock, FreshnessBadge, LoadingBlock, SegmentedControl } from '@/components/ui';
import { ExposureAnalytics } from './ExposureAnalytics';
import {
  StrikeDetailsDrawer,
  StrikeLadder,
  type LadderDensity,
  type LadderMetric,
  type LadderSort,
} from './StrikeLadder';

const QUICK_SYMBOLS = ['SPX', 'SPY', 'QQQ', 'NDX', 'IWM', 'NVDA', 'TSLA'];
const MODES: { label: string; value: ExpirationMode }[] = [
  { label: '0DTE', value: '0dte' },
  { label: '1DTE', value: '1dte' },
  { label: '≤ 7DTE', value: 'le7' },
  { label: '≤ 30DTE', value: 'le30' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'All', value: 'all' },
  { label: 'Custom', value: 'multiple' },
];
const MODE_VALUES = new Set(MODES.map((mode) => mode.value).concat(['single', 'custom']));
const RANGES = ['1', '2', '3', '5', '10', 'all'] as const;
const METRICS: { label: string; value: LadderMetric }[] = [
  { label: 'ALL', value: 'all' },
  { label: 'GEX', value: 'gex' },
  { label: 'DEX', value: 'dex' },
  { label: 'VANNA', value: 'vanna' },
  { label: 'CHARM', value: 'charm' },
  { label: 'OI', value: 'oi' },
  { label: 'VOLUME', value: 'volume' },
];

type QueryPatch = Record<string, string | null>;

export function ExposureLadderScreen() {
  const search = useSearchParams();
  const router = useRouter();
  const { settings, update, loaded } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState<LadderSort>('strike');
  const [drawerRow, setDrawerRow] = useState<ExposureLadderRow | null>(null);
  const [centerSignal, setCenterSignal] = useState(0);
  const [followSpot, setFollowSpot] = useState(false);
  const [favorites, setFavorites] = useState<number[]>([]);

  const symbol = (search.get('symbol') || 'SPY').toUpperCase();
  const modeParam = search.get('expiry') || 'all';
  const mode = (MODE_VALUES.has(modeParam as ExpirationMode) ? modeParam : 'all') as ExpirationMode;
  const rangeParam = search.get('range') || '3';
  const parsedRange = Number(rangeParam);
  const range = rangeParam === 'all' || (Number.isFinite(parsedRange) && parsedRange > 0 && parsedRange <= 100)
    ? rangeParam
    : '3';
  const customRange = !RANGES.includes(range as (typeof RANGES)[number]);
  const metricParam = search.get('metric') || 'all';
  const metric = (METRICS.some((item) => item.value === metricParam) ? metricParam : 'all') as LadderMetric;
  const density = (search.get('view') === 'compact' ? 'compact' : 'advanced') as LadderDensity;
  const selectedExpirations = useMemo(
    () => (search.get('expirations') || '').split(',').filter(Boolean),
    [search],
  );
  const multiExpiration = mode === 'multiple' || mode === 'custom';

  const updateQuery = useCallback((patch: QueryPatch) => {
    const next = new URLSearchParams(search.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    router.replace(`/exposure?${next.toString()}`, { scroll: false });
  }, [router, search]);

  const apiPath = useMemo(() => {
    if (!loaded) return null;
    const params = new URLSearchParams({
      expirationMode: mode,
      strikeRange: range === 'all' ? '0' : range,
      include0dte: String(settings.include0dte),
      metric,
      convention: settings.convention,
    });
    if (selectedExpirations.length) params.set('expiration', selectedExpirations.join(','));
    if (settings.provider) params.set('provider', settings.provider);
    return `/api/exposure/${encodeURIComponent(symbol)}/ladder?${params.toString()}`;
  }, [loaded, metric, mode, range, selectedExpirations, settings.convention, settings.include0dte, settings.provider, symbol]);

  const query = useApi<ExposureLadderResponse>(apiPath, {
    refreshInterval: settings.refreshSeconds * 1000,
  });
  const stream = useSymbolStream(symbol, loaded);
  const data = query.data;
  const mutateLadder = query.mutate;

  useEffect(() => {
    if (!loaded) return;
    document.documentElement.classList.toggle('light', settings.theme === 'light');
  }, [loaded, settings.theme]);

  useEffect(() => {
    if (!stream.snapshot?.computed_at) return;
    const timer = setTimeout(() => mutateLadder(), 1200);
    return () => clearTimeout(timer);
  }, [mutateLadder, stream.snapshot?.computed_at]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem(`gex.exposure.favorites.${symbol}`);
        setFavorites(stored ? (JSON.parse(stored) as number[]) : []);
      } catch {
        setFavorites([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [symbol]);

  const toggleFavorite = (strike: number) => {
    setFavorites((current) => {
      const next = current.includes(strike)
        ? current.filter((value) => value !== strike)
        : [...current, strike].sort((a, b) => b - a);
      localStorage.setItem(`gex.exposure.favorites.${symbol}`, JSON.stringify(next));
      return next;
    });
  };

  const setMode = useCallback((nextMode: ExpirationMode) => {
    if (nextMode === 'multiple' && !selectedExpirations.length) {
      const first = data?.expiration_selection.available[0]?.expiration;
      if (first) updateQuery({ expiry: 'multiple', expirations: first });
      return;
    }
    updateQuery({
      expiry: nextMode,
      expirations: ['single', 'multiple', 'custom'].includes(nextMode)
        ? selectedExpirations.join(',') || null
        : null,
    });
  }, [data?.expiration_selection.available, selectedExpirations, updateQuery]);

  const selectExpiration = (expiration: string) => {
    if (multiExpiration) {
      const exists = selectedExpirations.includes(expiration);
      const next = exists
        ? selectedExpirations.filter((value) => value !== expiration)
        : [...selectedExpirations, expiration];
      if (next.length) updateQuery({ expiry: 'multiple', expirations: next.join(',') });
      return;
    }
    updateQuery({ expiry: 'single', expirations: expiration });
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === 'c') setCenterSignal((value) => value + 1);
      if (key === '0') setMode('0dte');
      if (key === 'a') setMode('all');
      if (key === 'g') updateQuery({ metric: 'gex' });
      if (key === 'd') updateQuery({ metric: 'dex' });
      if (key === 'v') updateQuery({ metric: 'vanna' });
      if (key === 'h') updateQuery({ metric: 'charm' });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setMode, updateQuery]);

  if (!loaded) return <main className="p-6"><LoadingBlock rows={10} /></main>;

  return (
    <div className="min-h-screen overflow-x-clip">
      <TopNav
        symbol={symbol}
        onSymbolChange={(next) => updateQuery({ symbol: next })}
        settings={settings}
        onOpenSettings={() => setSettingsOpen(true)}
        streamState={stream.state}
        lastUpdated={data?.timestamp ?? null}
        latencyMs={data?.latency_ms ?? null}
        quickSymbols={QUICK_SYMBOLS}
        activeView="exposure"
      />

      {data?.demo_banner ? (
        <div className="border-b border-accent/40 bg-accent/10 px-4 py-1.5 text-center text-xs font-semibold text-accent">
          DEMO DATA — evaluation only; synthetic options chain, not market data.
        </div>
      ) : null}

      <main className="mx-auto max-w-[2560px] space-y-3 p-3">
        <section className="panel p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-1">
              <div className="stat-label">Exposure Ladder</div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold">{symbol}</span>
                <span className="tnum text-sm font-semibold text-accent">SPOT {formatPrice(data?.spot)}</span>
              </div>
            </div>

            <ToolbarGroup label="Expiration">
              <SegmentedControl value={mode} onChange={setMode} size="xs" options={MODES} />
            </ToolbarGroup>

            <ToolbarGroup label="Strike range">
              <SegmentedControl
                value={range}
                onChange={(value) => updateQuery({ range: value })}
                size="xs"
                options={RANGES.map((value) => ({ label: value === 'all' ? 'All' : `±${value}%`, value }))}
              />
              <label className="flex items-center gap-1 text-[9px] text-faint">
                <span>Custom</span>
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.5"
                  inputMode="decimal"
                  aria-label="Custom strike range percent"
                  placeholder="%"
                  value={customRange ? range : ''}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (value > 0 && value <= 100) updateQuery({ range: event.target.value });
                  }}
                  className="h-7 w-14 rounded border border-line bg-bg px-1.5 tnum text-[10px] text-ink outline-none focus:border-accent"
                />
              </label>
            </ToolbarGroup>

            <div className="h-0 basis-full" aria-hidden="true" />

            <ToolbarGroup label="Exposure mode">
              <SegmentedControl
                value={metric}
                onChange={(value) => updateQuery({ metric: value })}
                size="xs"
                options={METRICS}
              />
            </ToolbarGroup>

            <div className="ml-auto flex flex-wrap items-end gap-2">
              <button type="button" onClick={() => setCenterSignal((value) => value + 1)} className="btn">Center on Spot <span className="text-faint">C</span></button>
              <button type="button" onClick={() => setFollowSpot((value) => !value)} className={clsx('btn', followSpot && 'btn-active')}>Follow Spot {followSpot ? 'ON' : 'OFF'}</button>
              <SegmentedControl
                value={density}
                onChange={(value) => updateQuery({ view: value })}
                size="xs"
                options={[{ label: 'Compact', value: 'compact' }, { label: 'Advanced', value: 'advanced' }]}
              />
              {data ? <FreshnessBadge status={data.freshness.quotes} asOf={data.freshness.greeks_as_of} /> : null}
              <button type="button" onClick={() => mutateLadder()} className="btn">Refresh</button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-2 text-[10px] text-faint">
            <span>Provider: <b className="uppercase text-muted">{data?.provider ?? '--'}</b></span>
            <span>Entitlement: <b className="uppercase text-muted">{data?.freshness.quotes ?? '--'}</b></span>
            <span>Latency: <b className="tnum text-muted">{data ? `${Math.round(data.latency_ms)} ms` : '--'}</b></span>
            <span>Quote: <b className="tnum text-muted">{formatTime(data?.freshness.quote_as_of, settings.timezone)}</b></span>
            <span>Greeks: <b className="text-muted">{data?.freshness.greeks_source ?? '--'}</b></span>
            <span>OI as-of: <b className="text-muted">{data?.freshness.oi_as_of?.slice(0, 10) ?? 'previous reporting session'}</b></span>
            <span>Excluded: <b className="tnum text-muted">{data?.freshness.excluded_contracts ?? 0} contracts</b></span>
            <span className="rounded border border-warn/30 bg-warn/5 px-1.5 text-warn">Dealer sign: <b>{conventionLabel(data?.sign_convention)}</b></span>
            <span>Keyboard: <b className="text-muted">0 / A / G / D / V / H</b></span>
          </div>
        </section>

        {query.error ? (
          <div className="panel p-4"><ErrorBlock error={query.error} onRetry={() => mutateLadder()} lastUpdated={data?.timestamp} /></div>
        ) : !data ? (
          <div className="grid gap-3 2xl:grid-cols-[minmax(0,4fr)_minmax(320px,1fr)]">
            <div className="panel p-4"><LoadingBlock rows={18} label="Loading strike ladder" /></div>
            <div className="panel p-4"><LoadingBlock rows={12} label="Loading market structure" /></div>
          </div>
        ) : data.rows.length === 0 ? (
          <div className="panel"><EmptyBlock message="No option contracts available for the selected expiration and strike range." /></div>
        ) : (
          <div className="grid min-w-0 items-start gap-3 2xl:grid-cols-[minmax(0,4fr)_minmax(320px,1fr)]">
            <div className="min-w-0"><StrikeLadder
              rows={data.rows}
              spot={data.spot}
              levels={data.key_levels}
              metric={metric}
              density={density}
              sort={sort}
              onSort={setSort}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              onOpenRow={setDrawerRow}
              centerSignal={centerSignal}
              followSpot={followSpot}
              signConvention={data.sign_convention}
            /></div>
            <div className="min-w-0"><ExposureAnalytics
              data={data}
              rows={data.rows}
              multiExpiration={multiExpiration}
              onMultiExpirationChange={(enabled) => {
                if (enabled) setMode('multiple');
                else if (selectedExpirations[0]) updateQuery({ expiry: 'single', expirations: selectedExpirations[0] });
                else setMode('all');
              }}
              onExpirationSelect={selectExpiration}
            /></div>
          </div>
        )}

        {data ? (
          <footer className="panel p-3 text-[9px] leading-relaxed text-faint">
            <p>{data.disclaimer}</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(data.methodology).map(([key, value]) => <p key={key}><b className="uppercase text-muted">{key}:</b> {value}</p>)}
            </div>
          </footer>
        ) : null}
      </main>

      <StrikeDetailsDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} update={update} />
    </div>
  );
}

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="stat-label mb-1">{label}</div>{children}</div>;
}

function conventionLabel(value: string | undefined): string {
  if (value === 'calls_positive_puts_negative') return 'Calls + / Puts −';
  if (value === 'put_positive_call_negative') return 'Calls − / Puts +';
  if (value === 'all_positive') return 'All positions +';
  return '--';
}
