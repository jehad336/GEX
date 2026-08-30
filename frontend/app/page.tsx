'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { API_BASE, STATIC_DEMO, chainParams, demoSymbols } from '@/lib/api';
import { formatNumber, formatPrice } from '@/lib/format';
import { useApi, usePanel, useSettings, useSymbolStream } from '@/lib/hooks';
import type {
  Bar,
  DemoBanner,
  GammaProfileResponse,
  GexSnapshot,
  HeatmapResponse,
  StrikeGex,
  Underlying,
} from '@/lib/types';

import { GammaProfileChart } from '@/components/charts/GammaProfileChart';
import { GexByStrikeChart } from '@/components/charts/GexByStrikeChart';
import { GexHeatmap } from '@/components/charts/GexHeatmap';
import { PriceChart, buildPriceLevels } from '@/components/charts/PriceChart';
import {
  ByExpiryPanel,
  Dte0Panel,
  ExposureDetailPanel,
  FlowPanel,
  IntradayPanel,
  IvPanel,
  LevelsPanel,
  OiVolumePanel,
  WatchlistPanel,
} from '@/components/panels';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { SummaryBar } from '@/components/SummaryBar';
import { TopNav } from '@/components/TopNav';
import { OpportunityPanel } from '@/components/OpportunityPanel';
import { AnalysisTabs, SidebarNav } from '@/components/SidebarNav';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel, SegmentedControl } from '@/components/ui';

const ALL_SYMBOLS = ['SPX', 'SPY', 'QQQ', 'NDX', 'IWM', 'DIA', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'MSFT', 'AMZN', 'META'];
const ALL_WATCHLIST = ['SPX', 'SPY', 'QQQ', 'NVDA', 'TSLA'];

// The static demo ships captured fixtures. Offering a symbol it does not hold
// would put an unavailable panel behind every click, so the switcher is narrowed
// to what was actually captured rather than falling back to another symbol.
const CAPTURED = STATIC_DEMO ? demoSymbols() : [];
const QUICK_SYMBOLS = STATIC_DEMO && CAPTURED.length ? CAPTURED : ALL_SYMBOLS;
const WATCHLIST = STATIC_DEMO && CAPTURED.length
  ? ALL_WATCHLIST.filter((s) => CAPTURED.includes(s))
  : ALL_WATCHLIST;
const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '1D'] as const;

export default function DashboardPage() {
  return (
    <Suspense fallback={<main className="p-6"><LoadingBlock rows={8} label="Loading dashboard" /></main>}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const search = useSearchParams();
  const router = useRouter();
  const { settings, update, loaded } = useSettings();
  const symbol = (search.get('symbol') || 'SPY').toUpperCase();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>('5m');
  const [heatmapMetric, setHeatmapMetric] = useState<'net' | 'call' | 'put'>('net');
  const [strikeMetric, setStrikeMetric] = useState<'gex' | 'dex' | 'vanna' | 'charm'>('gex');
  const selectSymbol = useCallback((nextSymbol: string) => {
    const params = new URLSearchParams(search.toString());
    params.set('symbol', nextSymbol.toUpperCase());
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [router, search]);

  // Theme is applied on <html> so both Tailwind and the chart colour readers see it.
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.classList.toggle('light', settings.theme === 'light');
  }, [settings.theme, loaded]);

  const refreshMs = settings.refreshSeconds * 1000;

  const snapshotQuery = usePanel<GexSnapshot>(loaded ? `/api/gex/${symbol}` : null, settings);
  const strikeQuery = usePanel<{ rows: StrikeGex[]; spot: number }>(
    loaded ? `/api/gex/${symbol}/by-strike` : null,
    settings,
  );
  const profileQuery = usePanel<GammaProfileResponse>(
    loaded ? `/api/gex/${symbol}/profile` : null,
    settings,
    { band_pct: 0.1, steps: 121 },
  );
  const heatmapQuery = usePanel<HeatmapResponse>(
    loaded ? `/api/gex/${symbol}/heatmap` : null,
    settings,
    { metric: heatmapMetric, max_strikes: 50 },
  );
  const underlyingQuery = useApi<Underlying>(loaded ? `/api/market/${symbol}` : null, {
    refreshInterval: Math.min(refreshMs, 15_000),
  });
  const barsQuery = useApi<Bar[]>(
    loaded ? `/api/market/${symbol}/bars?interval=${interval}&limit=240` : null,
    { refreshInterval: refreshMs },
  );

  const stream = useSymbolStream(symbol, loaded);

  // WebSocket pushes take precedence when they arrive; polling is the floor.
  // Both are checked against the selected symbol so a switch can never render
  // one instrument's exposure under another's name.
  const rawSnapshot = stream.snapshot ?? snapshotQuery.data ?? null;
  const snapshot = rawSnapshot?.symbol === symbol ? rawSnapshot : null;
  const rawUnderlying = stream.underlying ?? underlyingQuery.data ?? null;
  const underlying = rawUnderlying?.symbol === symbol ? rawUnderlying : null;
  const demoBanner: DemoBanner | null = snapshot?.demo_banner ?? null;
  const theme = settings.theme;

  const priceLevels = useMemo(
    () => buildPriceLevels(snapshot?.levels, underlying, snapshot?.expected_move ?? null, theme),
    [snapshot?.levels, snapshot?.expected_move, underlying, theme],
  );

  const exportHref = useMemo(() => {
    const params = chainParams(settings);
    return `${API_BASE}/api/options/${symbol}/export${params}${params ? '&' : '?'}dataset=by-strike`;
  }, [symbol, settings]);

  if (!loaded) {
    return (
      <main className="p-6">
        <LoadingBlock rows={8} label="Loading dashboard" />
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <SidebarNav symbol={symbol} />
      <div className="min-h-screen xl:pl-60">
        <TopNav
        symbol={symbol}
        onSymbolChange={selectSymbol}
        settings={settings}
        onOpenSettings={() => setSettingsOpen(true)}
        streamState={stream.state}
        lastUpdated={snapshot?.computed_at ?? null}
        latencyMs={snapshot?.calculation_ms ?? null}
        quickSymbols={QUICK_SYMBOLS}
        activeView="dashboard"
      />

        {demoBanner ? (
        <div className="border-b border-accent/40 bg-accent/10 px-4 py-2">
          <p className="text-center text-xs font-semibold text-accent">
            <span className="sm:hidden">DEMO DATA — synthetic evaluation feed, not market data.</span>
            <span className="hidden sm:inline">DEMO DATA — {demoBanner.message}</span>
          </p>
        </div>
      ) : null}

        <main id="market-overview" className="mx-auto max-w-[1920px] scroll-mt-32 space-y-3 p-2.5 sm:scroll-mt-24 sm:space-y-4 sm:p-4">
        <section className="flex flex-col gap-3 pt-1 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
              <span className="h-px w-5 bg-accent" /> Live workspace
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">GEX Market Intelligence</h1>
            <p className="mt-1 max-w-2xl text-xs text-faint">Gamma structure, dealer positioning and actionable options context in one workspace.</p>
          </div>
          <AnalysisTabs symbol={symbol} />
        </section>
        {/* ---- summary ---- */}
        {snapshotQuery.error && !snapshot ? (
          <div className="panel p-4">
            <ErrorBlock error={snapshotQuery.error} onRetry={() => snapshotQuery.mutate()} />
          </div>
        ) : snapshot ? (
          <SummaryBar snapshot={snapshot} underlying={underlying} settings={settings} />
        ) : (
          <div className="panel p-4">
            <LoadingBlock rows={3} />
          </div>
        )}

        <section id="opportunities" className="scroll-mt-24">
          <OpportunityPanel symbol={symbol} settings={settings} />
        </section>

        {/* ---- price chart + main GEX ---- */}
        <section id="chart" className="grid scroll-mt-24 gap-4 xl:grid-cols-[1.15fr_1fr]">
          <Panel
            title="Price & Options Levels"
            bodyClassName="p-2"
            right={
              <SegmentedControl
                value={interval}
                onChange={setInterval}
                size="xs"
                options={INTERVALS.map((i) => ({ label: i, value: i }))}
              />
            }
          >
            {barsQuery.error ? (
              <div className="p-3">
                <ErrorBlock error={barsQuery.error} onRetry={() => barsQuery.mutate()} />
              </div>
            ) : barsQuery.data && barsQuery.data.length > 0 ? (
              <>
                <PriceChart bars={barsQuery.data} levels={priceLevels} height={400} theme={theme} />
                <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 pb-1 pt-2">
                  {priceLevels.map((l) => (
                    <span key={l.label} className="flex items-center gap-1 text-2xs text-faint">
                      <span
                        className="inline-block h-0.5 w-3"
                        style={{ backgroundColor: l.color }}
                      />
                      {l.label} {formatPrice(l.price)}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="p-3">
                <LoadingBlock rows={6} />
              </div>
            )}
          </Panel>

          <Panel
            title="GEX by Strike"
            term="gex"
            bodyClassName="p-2"
            right={
              <div className="flex items-center gap-2">
                <SegmentedControl
                  value={strikeMetric}
                  onChange={setStrikeMetric}
                  size="xs"
                  options={[
                    { label: 'GEX', value: 'gex' },
                    { label: 'DEX', value: 'dex' },
                    { label: 'Vanna', value: 'vanna' },
                    { label: 'Charm', value: 'charm' },
                  ]}
                />
                <a href={exportHref} className="btn">
                  CSV
                </a>
              </div>
            }
          >
            {strikeQuery.error ? (
              <div className="p-3">
                <ErrorBlock error={strikeQuery.error} onRetry={() => strikeQuery.mutate()} />
              </div>
            ) : strikeQuery.data && strikeQuery.data.rows.length > 0 ? (
              <GexByStrikeChart
                rows={strikeQuery.data.rows}
                spot={strikeQuery.data.spot}
                levels={snapshot?.levels}
                metric={strikeMetric}
                height={400}
                theme={theme}
              />
            ) : strikeQuery.data ? (
              <EmptyBlock message="No strikes match the current filters." />
            ) : (
              <div className="p-3">
                <LoadingBlock rows={6} />
              </div>
            )}
          </Panel>
        </section>

        {/* ---- gamma profile + levels ---- */}
        <section id="gamma-profile" className="grid scroll-mt-24 gap-4 xl:grid-cols-[1fr_1fr]">
          <Panel
            title="Gamma Exposure Profile"
            term="gamma_flip"
            bodyClassName="p-2"
            right={
              profileQuery.data ? (
                <span className="text-2xs text-faint" title={profileQuery.data.method}>
                  Black-Scholes reprice · ±10%
                </span>
              ) : null
            }
          >
            {profileQuery.error ? (
              <div className="p-3">
                <ErrorBlock error={profileQuery.error} onRetry={() => profileQuery.mutate()} />
              </div>
            ) : profileQuery.data ? (
              <>
                <GammaProfileChart data={profileQuery.data} height={340} theme={theme} />
                <div className="grid grid-cols-3 gap-3 px-3 pb-2 pt-1">
                  <MiniLevel
                    label="Zero Gamma"
                    value={profileQuery.data.zero_gamma}
                    spot={profileQuery.data.spot}
                    tone="text-warn"
                  />
                  <MiniLevel
                    label="Call Wall"
                    value={profileQuery.data.call_wall.price}
                    spot={profileQuery.data.spot}
                    tone="text-pos"
                  />
                  <MiniLevel
                    label="Put Wall"
                    value={profileQuery.data.put_wall.price}
                    spot={profileQuery.data.spot}
                    tone="text-neg"
                  />
                </div>
              </>
            ) : (
              <div className="p-3">
                <LoadingBlock rows={6} />
              </div>
            )}
          </Panel>

          <LevelsPanel symbol={symbol} settings={settings} />
        </section>

        {/* ---- heatmap ---- */}
        <section id="heatmap" className="scroll-mt-24"><Panel
          title="Strike × Expiration Gamma Heatmap"
          bodyClassName="p-2"
          right={
            <SegmentedControl
              value={heatmapMetric}
              onChange={setHeatmapMetric}
              size="xs"
              options={[
                { label: 'Net', value: 'net' },
                { label: 'Call', value: 'call' },
                { label: 'Put', value: 'put' },
              ]}
            />
          }
        >
          {heatmapQuery.error ? (
            <div className="p-3">
              <ErrorBlock error={heatmapQuery.error} onRetry={() => heatmapQuery.mutate()} />
            </div>
          ) : heatmapQuery.data && heatmapQuery.data.cells.length > 0 ? (
            <GexHeatmap data={heatmapQuery.data} height={440} theme={theme} />
          ) : heatmapQuery.data ? (
            <EmptyBlock message="No gamma in the selected strike and expiry range." />
          ) : (
            <div className="p-3">
              <LoadingBlock rows={8} />
            </div>
          )}
        </Panel></section>

        {/* ---- 0DTE + exposures ---- */}
        <section id="zero-dte" className="grid scroll-mt-24 gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Dte0Panel symbol={symbol} settings={settings} />
          {snapshot ? (
            <ExposureDetailPanel snapshot={snapshot} settings={settings} />
          ) : (
            <Panel title="Delta · Vanna · Charm Exposure">
              <LoadingBlock rows={4} />
            </Panel>
          )}
        </section>

        {/* ---- expiry + OI/volume ---- */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ByExpiryPanel symbol={symbol} settings={settings} theme={theme} />
          <OiVolumePanel
            symbol={symbol}
            settings={settings}
            theme={theme}
            byStrike={strikeQuery.data?.rows ?? []}
          />
        </div>

        {/* ---- flow ---- */}
        <section id="flow" className="scroll-mt-24"><FlowPanel symbol={symbol} settings={settings} /></section>

        {/* ---- volatility + intraday ---- */}
        <section id="volatility" className="grid scroll-mt-24 gap-4 xl:grid-cols-[1.3fr_1fr]">
          <IvPanel symbol={symbol} settings={settings} theme={theme} />
          <div className="space-y-4">
            <div id="history" className="scroll-mt-24"><IntradayPanel symbol={symbol} settings={settings} theme={theme} /></div>
            <div id="watchlist" className="scroll-mt-24"><WatchlistPanel
              symbols={WATCHLIST}
              active={symbol}
              onSelect={selectSymbol}
              settings={settings}
            /></div>
          </div>
        </section>

        {/* ---- underlying detail ---- */}
        {underlying ? (
          <Panel title="Underlying Session Data">
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4 lg:grid-cols-8">
              <SessionStat label="Last" value={formatPrice(underlying.price)} />
              <SessionStat label="Prev Close" value={formatPrice(underlying.previous_close)} />
              <SessionStat label="Open" value={formatPrice(underlying.open)} />
              <SessionStat label="High" value={formatPrice(underlying.high)} />
              <SessionStat label="Low" value={formatPrice(underlying.low)} />
              <SessionStat label="VWAP" value={formatPrice(underlying.vwap)} />
              <SessionStat label="Volume" value={formatNumber(underlying.volume)} />
              <SessionStat
                label="Day Change"
                value={`${underlying.change_pct != null ? `${underlying.change_pct > 0 ? '+' : ''}${underlying.change_pct.toFixed(2)}%` : '--'}`}
                tone={
                  underlying.change_pct == null
                    ? undefined
                    : underlying.change_pct >= 0
                      ? 'text-pos'
                      : 'text-neg'
                }
              />
            </div>
          </Panel>
        ) : null}

        <footer className="pb-8 pt-2 text-center text-2xs leading-relaxed text-faint">
          <p className="mx-auto max-w-4xl">
            Open interest, volume, implied volatility and vendor greeks are observed data. Signed
            GEX, dealer positioning, gamma flip, call and put walls, and pin risk are model-derived
            estimates produced by this application from a public option chain. Dealer inventory is
            not published and cannot be recovered exactly. Nothing here is investment advice.
          </p>
        </footer>
        </main>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={update}
      />
    </div>
  );
}

function MiniLevel({
  label,
  value,
  spot,
  tone,
}: {
  label: string;
  value: number | null;
  spot: number;
  tone: string;
}) {
  const distance = value != null ? value - spot : null;
  const pct = value != null && spot ? ((value - spot) / spot) * 100 : null;
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={`tnum text-sm font-semibold ${tone}`}>
        {value != null ? formatPrice(value) : '--'}
      </div>
      <div className="tnum text-2xs text-faint">
        {distance != null && pct != null
          ? `${distance >= 0 ? '+' : '-'}$${Math.abs(distance).toFixed(2)} · ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
          : '--'}
      </div>
    </div>
  );
}

function SessionStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={`tnum mt-0.5 text-sm font-semibold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}
