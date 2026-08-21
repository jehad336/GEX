'use client';

import { useEffect, useMemo, useState } from 'react';

import { API_BASE, chainParams } from '@/lib/api';
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
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel, SegmentedControl } from '@/components/ui';

const QUICK_SYMBOLS = ['SPX', 'SPY', 'QQQ', 'NDX', 'IWM', 'DIA', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'MSFT', 'AMZN', 'META'];
const WATCHLIST = ['SPX', 'SPY', 'QQQ', 'NVDA', 'TSLA'];
const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '1D'] as const;

export default function Dashboard() {
  const { settings, update, loaded } = useSettings();
  const [symbol, setSymbol] = useState('SPY');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>('5m');
  const [heatmapMetric, setHeatmapMetric] = useState<'net' | 'call' | 'put'>('net');
  const [strikeMetric, setStrikeMetric] = useState<'gex' | 'dex' | 'vanna' | 'charm'>('gex');

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
      <TopNav
        symbol={symbol}
        onSymbolChange={setSymbol}
        settings={settings}
        onOpenSettings={() => setSettingsOpen(true)}
        streamState={stream.state}
        lastUpdated={snapshot?.computed_at ?? null}
        latencyMs={snapshot?.calculation_ms ?? null}
        quickSymbols={QUICK_SYMBOLS}
      />

      {demoBanner ? (
        <div className="border-b border-accent/40 bg-accent/10 px-4 py-2">
          <p className="text-center text-xs font-semibold text-accent">
            DEMO DATA — {demoBanner.message}
          </p>
        </div>
      ) : null}

      <main className="mx-auto max-w-[1920px] space-y-4 p-4">
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

        {/* ---- price chart + main GEX ---- */}
        <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
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
        </div>

        {/* ---- gamma profile + levels ---- */}
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
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
        </div>

        {/* ---- heatmap ---- */}
        <Panel
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
        </Panel>

        {/* ---- 0DTE + exposures ---- */}
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Dte0Panel symbol={symbol} settings={settings} />
          {snapshot ? (
            <ExposureDetailPanel snapshot={snapshot} settings={settings} />
          ) : (
            <Panel title="Delta · Vanna · Charm Exposure">
              <LoadingBlock rows={4} />
            </Panel>
          )}
        </div>

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
        <FlowPanel symbol={symbol} settings={settings} />

        {/* ---- volatility + intraday ---- */}
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <IvPanel symbol={symbol} settings={settings} theme={theme} />
          <div className="space-y-4">
            <IntradayPanel symbol={symbol} settings={settings} theme={theme} />
            <WatchlistPanel
              symbols={WATCHLIST}
              active={symbol}
              onSelect={setSymbol}
              settings={settings}
            />
          </div>
        </div>

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
