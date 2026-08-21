'use client';

import { clsx } from 'clsx';
import { useMemo, useState } from 'react';

import { API_BASE, chainParams } from '@/lib/api';
import {
  formatDateShort,
  formatExposure,
  formatExposureAuto,
  formatIv,
  formatNumber,
  formatPct,
  formatPrice,
  formatRatio,
  formatTime,
  toneForValue,
} from '@/lib/format';
import { usePanel } from '@/lib/hooks';
import type {
  DashboardSettings,
  Dte0Response,
  ExpiryGex,
  FlowResponse,
  GexSnapshot,
  HistoryPoint,
  IvResponse,
  LevelsResponse,
  OiResponse,
  StrikeGex,
  VolumeResponse,
  WatchlistRow,
} from '@/lib/types';
import { GexByExpiryChart, IntradayGexChart, OiVolumeChart, SkewChart, TermStructureChart } from './charts/MiniCharts';
import { EmptyBlock, ErrorBlock, Info, LoadingBlock, Panel, SegmentedControl } from './ui';
import { LevelReadout } from './SummaryBar';

/* ------------------------------------------------------------------ 0DTE */

export function Dte0Panel({
  symbol,
  settings,
}: {
  symbol: string;
  settings: DashboardSettings;
}) {
  const { data, error, isLoading, mutate } = usePanel<Dte0Response>(
    `/api/gex/${symbol}/0dte`,
    settings,
  );

  return (
    <Panel title="0DTE — Same Session Expiry" right={data?.expiration ? <span className="text-2xs text-faint">{formatDateShort(data.expiration)}</span> : null}>
      {isLoading && !data ? <LoadingBlock rows={5} /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => mutate()} /> : null}
      {data && !data.available ? <EmptyBlock message={data.reason ?? 'No same-day expiry.'} /> : null}
      {data?.available && data.totals ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric
              label="0DTE Net GEX"
              value={formatExposure(data.totals.net_gex, settings.units)}
              tone={toneForValue(data.totals.net_gex)}
              sub={
                data.share_of_total_gex != null
                  ? `${(data.share_of_total_gex * 100).toFixed(0)}% of chain`
                  : undefined
              }
            />
            <Metric
              label="0DTE Call GEX"
              value={formatExposure(data.totals.call_gex, settings.units)}
              tone="text-pos"
            />
            <Metric
              label="0DTE Put GEX"
              value={formatExposure(data.totals.put_gex, settings.units)}
              tone="text-neg"
            />
            <Metric
              label="0DTE P/C"
              value={formatRatio(data.ratios?.volume_ratio)}
              sub={`OI ${formatRatio(data.ratios?.oi_ratio)}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-line pt-3 sm:grid-cols-3">
            <Metric label="Call OI" value={formatNumber(data.totals.call_oi)} />
            <Metric label="Put OI" value={formatNumber(data.totals.put_oi)} />
            <Metric
              label="Call / Put Volume"
              value={`${formatNumber(data.totals.call_volume)} / ${formatNumber(data.totals.put_volume)}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-line pt-3 sm:grid-cols-3">
            {data.key_strikes
              ? Object.entries(data.key_strikes).map(([key, level]) => (
                  <LevelReadout
                    key={key}
                    label={level.label}
                    level={level}
                    spot={data.spot}
                    tone={key.includes('call') ? 'text-pos' : 'text-neg'}
                  />
                ))
              : null}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="stat-label truncate">{label}</div>
      <div className={clsx('tnum mt-0.5 truncate text-base font-semibold', tone)}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-2xs text-faint">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ levels */

export function LevelsPanel({
  symbol,
  settings,
}: {
  symbol: string;
  settings: DashboardSettings;
}) {
  const { data, error, isLoading, mutate } = usePanel<LevelsResponse>(
    `/api/gex/${symbol}/levels`,
    settings,
  );

  return (
    <Panel title="Major Gamma Levels & Concentration">
      {isLoading && !data ? <LoadingBlock rows={6} /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => mutate()} /> : null}
      {data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {(['positive', 'negative'] as const).map((side) => (
              <div key={side}>
                <div className="stat-label mb-1.5">
                  Top 5 {side === 'positive' ? 'Positive' : 'Negative'} Gamma
                </div>
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Strike</th>
                      <th className="text-right">GEX</th>
                      <th className="text-right">OI</th>
                      <th className="text-right">Vol</th>
                      <th className="text-right">Dist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_gamma[side].length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-faint">
                          none
                        </td>
                      </tr>
                    ) : (
                      data.top_gamma[side].map((lvl) => (
                        <tr key={lvl.label}>
                          <td className="tnum font-semibold">{formatPrice(lvl.price)}</td>
                          <td
                            className={clsx('tnum text-right', side === 'positive' ? 'text-pos' : 'text-neg')}
                          >
                            {formatExposure(lvl.gex, settings.units)}
                          </td>
                          <td className="tnum text-right text-muted">{formatNumber(lvl.open_interest)}</td>
                          <td className="tnum text-right text-muted">{formatNumber(lvl.volume)}</td>
                          <td className="tnum text-right text-faint">
                            {formatPct(lvl.distance_pct, 2, true)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="border-t border-line pt-3">
            <div className="mb-2 flex items-center gap-1">
              <span className="stat-label">Gamma concentration around spot</span>
              <Info term="concentration" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.concentration.map((band) => (
                <div key={band.band_pct} className="rounded border border-line bg-raised p-2.5">
                  <div className="stat-label">±{band.band_pct}%</div>
                  <div className="tnum mt-0.5 text-base font-semibold">
                    {band.share_of_absolute.toFixed(1)}%
                  </div>
                  <div className="tnum mt-0.5 text-2xs text-faint">
                    net {formatExposure(band.net_gex, settings.units)}
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-line">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.min(100, band.share_of_absolute)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="stat-label">Pin Risk</span>
              <Info term="pin_risk" />
              <span
                className={clsx(
                  'chip',
                  data.pin_risk.level === 'High'
                    ? 'border-neg/40 bg-neg/10 text-neg'
                    : data.pin_risk.level === 'Medium'
                      ? 'border-warn/40 bg-warn/10 text-warn'
                      : 'border-pos/40 bg-pos/10 text-pos',
                )}
              >
                {data.pin_risk.level}
              </span>
              <span className="tnum text-2xs text-faint">score {data.pin_risk.score.toFixed(2)}</span>
            </div>
            <p className="text-2xs leading-relaxed text-muted">{data.pin_risk.explanation}</p>
          </div>

          <div className="border-t border-line pt-3">
            <p className="text-2xs leading-relaxed text-muted">
              <span className="font-semibold text-ink">Regime:</span> {data.regime.explanation}
            </p>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ by expiry */

export function ByExpiryPanel({
  symbol,
  settings,
  theme,
}: {
  symbol: string;
  settings: DashboardSettings;
  theme: string;
}) {
  const { data, error, isLoading, mutate } = usePanel<{
    rows: ExpiryGex[];
    buckets: Record<string, { net_gex: number; call_gex: number; put_gex: number; expirations: number }>;
  }>(`/api/gex/${symbol}/by-expiry`, settings);

  return (
    <Panel
      title="GEX by Expiration"
      right={
        <a
          href={`${API_BASE}/api/options/${symbol}/export${chainParams(settings)}${chainParams(settings) ? '&' : '?'}dataset=by-expiry`}
          className="btn"
        >
          CSV
        </a>
      }
    >
      {isLoading && !data ? <LoadingBlock rows={5} /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => mutate()} /> : null}
      {data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['dte0', '0DTE'],
                ['dte1', '≤ 1DTE'],
                ['weekly', '≤ 7DTE'],
                ['monthly', '≤ 35DTE'],
              ] as const
            ).map(([key, label]) => {
              const bucket = data.buckets[key];
              return (
                <div key={key} className="rounded border border-line bg-raised p-2.5">
                  <div className="stat-label">{label}</div>
                  <div className={clsx('tnum mt-0.5 text-base font-semibold', toneForValue(bucket?.net_gex))}>
                    {formatExposure(bucket?.net_gex, settings.units)}
                  </div>
                  <div className="mt-0.5 text-2xs text-faint">
                    {bucket?.expirations ?? 0} expiries
                  </div>
                </div>
              );
            })}
          </div>
          <GexByExpiryChart rows={data.rows} theme={theme} />
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ OI / volume */

export function OiVolumePanel({
  symbol,
  settings,
  theme,
  byStrike,
}: {
  symbol: string;
  settings: DashboardSettings;
  theme: string;
  byStrike: StrikeGex[];
  }) {
  const [mode, setMode] = useState<'oi' | 'volume'>('oi');
  const oi = usePanel<OiResponse>(`/api/options/${symbol}/oi`, settings);
  const vol = usePanel<VolumeResponse>(`/api/options/${symbol}/volume`, settings);

  const active = mode === 'oi' ? oi : vol;
  const spot = oi.data?.spot ?? vol.data?.spot ?? 0;

  return (
    <Panel
      title="Open Interest & Volume"
      term={mode === 'oi' ? 'open_interest' : 'volume'}
      right={
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { label: 'Open Interest', value: 'oi' },
              { label: 'Volume', value: 'volume' },
            ]}
          />
          <a
            href={`${API_BASE}/api/options/${symbol}/export${chainParams(settings)}${chainParams(settings) ? '&' : '?'}dataset=${mode}`}
            className="btn"
          >
            CSV
          </a>
        </div>
      }
    >
      {active.isLoading && !active.data ? <LoadingBlock rows={5} /> : null}
      {active.error ? <ErrorBlock error={active.error} onRetry={() => active.mutate()} /> : null}

      {mode === 'oi' && oi.data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Call OI" value={formatNumber(oi.data.call_oi)} tone="text-pos" />
            <Metric label="Put OI" value={formatNumber(oi.data.put_oi)} tone="text-neg" />
            <Metric label="Total OI" value={formatNumber(oi.data.total_oi)} />
            <Metric label="P/C OI Ratio" value={formatRatio(oi.data.put_call_oi_ratio)} />
          </div>
          <div className="rounded border border-warn/25 bg-warn/5 p-2 text-2xs leading-relaxed text-muted">
            <span className="font-semibold uppercase tracking-wider text-warn">
              OI as of {oi.data.oi_as_of ? formatTime(oi.data.oi_as_of, settings.timezone) : 'previous session'}
            </span>{' '}
            — {oi.data.oi_note}
          </div>
          {oi.data.change.available ? (
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-3 sm:grid-cols-4">
              <Metric
                label="Call OI Δ"
                value={formatNumber(oi.data.change.call_oi_change)}
                tone={toneForValue(oi.data.change.call_oi_change)}
                sub={`vs ${oi.data.change.previous_session}`}
              />
              <Metric
                label="Put OI Δ"
                value={formatNumber(oi.data.change.put_oi_change)}
                tone={toneForValue(oi.data.change.put_oi_change)}
              />
              <Metric label="Additions" value={formatNumber(oi.data.change.additions)} />
              <Metric label="Reductions" value={formatNumber(oi.data.change.reductions)} />
            </div>
          ) : (
            <p className="text-2xs text-faint">{oi.data.change.reason}</p>
          )}
          <OiVolumeChart rows={byStrike} spot={spot} mode="oi" theme={theme} />
        </div>
      ) : null}

      {mode === 'volume' && vol.data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Call Volume" value={formatNumber(vol.data.call_volume)} tone="text-pos" />
            <Metric label="Put Volume" value={formatNumber(vol.data.put_volume)} tone="text-neg" />
            <Metric label="Total Volume" value={formatNumber(vol.data.total_volume)} />
            <Metric label="P/C Vol Ratio" value={formatRatio(vol.data.put_call_volume_ratio)} />
          </div>
          <OiVolumeChart rows={byStrike} spot={spot} mode="volume" theme={theme} />
          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <span className="stat-label">Unusual activity (volume above open interest)</span>
              <Info term="volume_oi" />
            </div>
            <div className="max-h-56 overflow-auto rounded border border-line">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Strike</th>
                    <th>Type</th>
                    <th>Expiry</th>
                    <th className="text-right">Volume</th>
                    <th className="text-right">OI</th>
                    <th className="text-right">Vol/OI</th>
                  </tr>
                </thead>
                <tbody>
                  {vol.data.unusual.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-3 text-center text-faint">
                        Nothing above the threshold.
                      </td>
                    </tr>
                  ) : (
                    vol.data.unusual.slice(0, 25).map((r, i) => (
                      <tr key={`${r.strike}-${r.type}-${r.expiration}-${i}`}>
                        <td className="tnum font-semibold">{formatPrice(r.strike)}</td>
                        <td className={r.type === 'call' ? 'text-pos' : 'text-neg'}>
                          {r.type.toUpperCase()}
                        </td>
                        <td className="text-muted">{formatDateShort(r.expiration)}</td>
                        <td className="tnum text-right">{formatNumber(r.volume)}</td>
                        <td className="tnum text-right text-muted">{formatNumber(r.open_interest)}</td>
                        <td className="tnum text-right font-semibold text-warn">
                          {r.volume_oi_ratio.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ IV */

export function IvPanel({
  symbol,
  settings,
  theme,
}: {
  symbol: string;
  settings: DashboardSettings;
  theme: string;
}) {
  const [xMode, setXMode] = useState<'strike' | 'delta'>('strike');
  const { data, error, isLoading, mutate } = usePanel<IvResponse>(
    `/api/options/${symbol}/iv`,
    settings,
  );

  return (
    <Panel
      title="Volatility Analytics"
      term="skew"
      right={
        <SegmentedControl
          value={xMode}
          onChange={setXMode}
          options={[
            { label: 'By Strike', value: 'strike' },
            { label: 'By Delta', value: 'delta' },
          ]}
        />
      }
    >
      {isLoading && !data ? <LoadingBlock rows={5} /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => mutate()} /> : null}
      {data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Metric label="ATM IV" value={formatIv(data.atm_iv)} />
            <Metric label="Call ATM IV" value={formatIv(data.call_atm_iv)} tone="text-pos" />
            <Metric label="Put ATM IV" value={formatIv(data.put_atm_iv)} tone="text-neg" />
            <Metric label="25Δ Put / Call" value={`${formatIv(data.iv_25d_put)} / ${formatIv(data.iv_25d_call)}`} />
            <Metric
              label="25Δ Risk Reversal"
              value={data.risk_reversal_25d != null ? formatIv(data.risk_reversal_25d, 2) : '--'}
              tone={toneForValue(data.risk_reversal_25d)}
            />
          </div>

          <div>
            <div className="stat-label mb-1">Skew — front expiry</div>
            <SkewChart data={data} xMode={xMode} theme={theme} />
          </div>

          <div className="border-t border-line pt-3">
            <div className="mb-1 flex items-center gap-1">
              <span className="stat-label">Term structure</span>
              <Info term="term_structure" />
            </div>
            <TermStructureChart data={data.term_structure} theme={theme} />
          </div>

          {data.historical ? (
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-3 sm:grid-cols-4">
              {Object.entries(data.historical).map(([k, v]) => (
                <Metric key={k} label={k.replace(/_/g, ' ')} value={v == null ? '--' : String(v)} />
              ))}
            </div>
          ) : (
            <p className="border-t border-line pt-3 text-2xs text-faint">{data.historical_note}</p>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ flow */

const PREMIUM_FILTERS = [0, 50_000, 100_000, 250_000, 500_000, 1_000_000];

export function FlowPanel({ symbol, settings }: { symbol: string; settings: DashboardSettings }) {
  const [minPremium, setMinPremium] = useState(0);
  const [custom, setCustom] = useState('');

  const threshold = custom.trim() ? Number(custom) || 0 : minPremium;
  const { data, error, isLoading, mutate } = usePanel<FlowResponse>(
    `/api/options/${symbol}/flow`,
    settings,
    { limit: 300, min_premium: threshold },
    15_000,
  );

  return (
    <Panel
      title="Options Flow"
      term="aggressor"
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          <SegmentedControl
            value={minPremium}
            onChange={(v) => {
              setMinPremium(v);
              setCustom('');
            }}
            size="xs"
            options={PREMIUM_FILTERS.map((v) => ({
              label: v === 0 ? 'All' : `>$${v >= 1e6 ? `${v / 1e6}M` : `${v / 1e3}K`}`,
              value: v,
            }))}
          />
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="custom $"
            aria-label="Custom premium threshold"
            className="w-24 rounded border border-line bg-raised px-2 py-0.5 text-2xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
      }
    >
      {isLoading && !data ? <LoadingBlock rows={6} /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => mutate()} /> : null}
      {data && !data.available ? <EmptyBlock message={data.reason ?? 'Flow unavailable.'} /> : null}
      {data?.available ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Prints" value={formatNumber(data.summary?.count)} />
            <Metric
              label="Total Premium"
              value={formatExposure(data.summary?.total_premium, 'millions')}
            />
            <Metric
              label="Call Premium"
              value={formatExposure(data.summary?.call_premium, 'millions')}
              tone="text-pos"
            />
            <Metric
              label="Put Premium"
              value={formatExposure(data.summary?.put_premium, 'millions')}
              tone="text-neg"
            />
          </div>

          <div className="max-h-96 overflow-auto rounded border border-line">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Contract</th>
                  <th>C/P</th>
                  <th className="text-right">Strike</th>
                  <th>Expiry</th>
                  <th className="text-right">DTE</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Size</th>
                  <th className="text-right">Premium</th>
                  <th className="text-right">Bid/Ask</th>
                  <th>Print</th>
                </tr>
              </thead>
              <tbody>
                {data.trades.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-4 text-center text-faint">
                      No prints above this premium threshold.
                    </td>
                  </tr>
                ) : (
                  data.trades.map((t, i) => (
                    <tr key={`${t.option_symbol}-${t.timestamp}-${i}`} className="hover:bg-raised">
                      <td className="tnum text-faint">{formatTime(t.timestamp, settings.timezone)}</td>
                      <td className="max-w-[150px] truncate font-mono text-2xs text-muted">
                        {t.option_symbol}
                      </td>
                      <td className={t.type === 'call' ? 'font-semibold text-pos' : 'font-semibold text-neg'}>
                        {t.type === 'call' ? 'C' : 'P'}
                      </td>
                      <td className="tnum text-right">{formatPrice(t.strike)}</td>
                      <td className="text-muted">{formatDateShort(t.expiration)}</td>
                      <td className="tnum text-right text-faint">
                        {t.dte < 1 ? '0' : Math.round(t.dte)}
                      </td>
                      <td className="tnum text-right">{formatPrice(t.price)}</td>
                      <td className="tnum text-right">{formatNumber(t.size)}</td>
                      <td
                        className={clsx(
                          'tnum text-right font-semibold',
                          t.premium >= 1_000_000
                            ? 'text-warn'
                            : t.premium >= 250_000
                              ? 'text-ink'
                              : 'text-muted',
                        )}
                      >
                        {formatExposureAuto(t.premium)}
                      </td>
                      <td className="tnum text-right text-2xs text-faint">
                        {formatPrice(t.bid)} / {formatPrice(t.ask)}
                      </td>
                      <td>
                        <span
                          className={clsx(
                            'chip',
                            t.aggressor === 'at_ask'
                              ? 'border-pos/40 bg-pos/10 text-pos'
                              : t.aggressor === 'at_bid'
                                ? 'border-neg/40 bg-neg/10 text-neg'
                                : 'border-line bg-raised text-muted',
                          )}
                        >
                          {t.aggressor.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-2xs leading-relaxed text-faint">{data.note}</p>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ watchlist */

export function WatchlistPanel({
  symbols,
  active,
  onSelect,
  settings,
}: {
  symbols: string[];
  active: string;
  onSelect: (s: string) => void;
  settings: DashboardSettings;
}) {
  const query = useMemo(() => ({ symbols: symbols.join(',') }), [symbols]);
  const { data, error, isLoading, mutate } = usePanel<{ rows: WatchlistRow[] }>(
    '/api/watchlist',
    settings,
    query,
    60_000,
  );

  return (
    <Panel title="Watchlist" bodyClassName="p-0">
      {isLoading && !data ? (
        <div className="p-4">
          <LoadingBlock rows={5} />
        </div>
      ) : null}
      {error ? (
        <div className="p-4">
          <ErrorBlock error={error} onRetry={() => mutate()} />
        </div>
      ) : null}
      {data ? (
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="text-right">Price</th>
                <th className="text-right">Net GEX</th>
                <th>Regime</th>
                <th className="text-right">Flip</th>
                <th className="text-right">Δ to Flip</th>
                <th className="text-right">Call Wall</th>
                <th className="text-right">Put Wall</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.symbol}
                  onClick={() => onSelect(row.symbol)}
                  className={clsx(
                    'cursor-pointer transition-colors hover:bg-raised',
                    row.symbol === active && 'bg-accent/5',
                  )}
                >
                  <td className="font-semibold">{row.symbol}</td>
                  {row.ok ? (
                    <>
                      <td className="tnum text-right">{formatPrice(row.spot)}</td>
                      <td className={clsx('tnum text-right', toneForValue(row.net_gex))}>
                        {formatExposure(row.net_gex, settings.units)}
                      </td>
                      <td>
                        <span
                          className={clsx(
                            'text-2xs font-semibold',
                            row.regime?.includes('POSITIVE')
                              ? 'text-pos'
                              : row.regime?.includes('NEGATIVE')
                                ? 'text-neg'
                                : 'text-warn',
                          )}
                        >
                          {row.regime?.replace(' GAMMA', '').replace('NEUTRAL / NEAR FLIP', 'NEAR FLIP')}
                        </span>
                      </td>
                      <td className="tnum text-right text-warn">{formatPrice(row.gamma_flip)}</td>
                      <td
                        className={clsx('tnum text-right', toneForValue(row.gamma_flip_distance_pct))}
                      >
                        {formatPct(row.gamma_flip_distance_pct, 2, true)}
                      </td>
                      <td className="tnum text-right text-pos">{formatPrice(row.call_wall)}</td>
                      <td className="tnum text-right text-neg">{formatPrice(row.put_wall)}</td>
                    </>
                  ) : (
                    <td colSpan={7} className="text-2xs text-neg" title={row.error}>
                      unavailable — {row.error?.slice(0, 80)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ history */

export function IntradayPanel({
  symbol,
  settings,
  theme,
}: {
  symbol: string;
  settings: DashboardSettings;
  theme: string;
}) {
  const { data, error, isLoading, mutate } = usePanel<{
    points: HistoryPoint[];
    count: number;
    note: string;
  }>(`/api/history/${symbol}/gex`, settings, { hours: 8 }, 60_000);

  return (
    <Panel
      title="Intraday GEX Evolution"
      right={data ? <span className="text-2xs text-faint">{data.count} captures</span> : null}
    >
      {isLoading && !data ? <LoadingBlock rows={4} /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => mutate()} /> : null}
      {data && data.points.length < 2 ? <EmptyBlock message={data.note} /> : null}
      {data && data.points.length >= 2 ? (
        <div>
          <IntradayGexChart points={data.points} theme={theme} />
          {data.points.length < 5 ? (
            <p className="px-3 pb-3 text-2xs text-faint">
              Limited history: {data.count} captures. The trend becomes more meaningful after 5+ refreshes.
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ exposure detail */

export function ExposureDetailPanel({
  snapshot,
  settings,
}: {
  snapshot: GexSnapshot;
  settings: DashboardSettings;
}) {
  return (
    <Panel title="Delta · Vanna · Charm Exposure">
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-1">
            <span className="stat-label">Net DEX</span>
            <Info term="dex" />
          </div>
          <div className={clsx('tnum mt-0.5 text-lg font-semibold', toneForValue(snapshot.totals.net_dex))}>
            {formatExposure(snapshot.totals.net_dex, settings.units)}
          </div>
          <div className="mt-0.5 text-2xs text-faint">
            call {formatExposure(snapshot.totals.call_dex, settings.units)} · put{' '}
            {formatExposure(snapshot.totals.put_dex, settings.units)}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1">
            <span className="stat-label">Net Vanna</span>
            <Info term="vanna" />
          </div>
          <div className={clsx('tnum mt-0.5 text-lg font-semibold', toneForValue(snapshot.totals.net_vanna))}>
            {formatExposure(snapshot.totals.net_vanna, settings.units)}
          </div>
          <div className="mt-0.5 text-2xs text-faint">per 1 vol point of IV</div>
        </div>
        <div>
          <div className="flex items-center gap-1">
            <span className="stat-label">Net Charm</span>
            <Info term="charm" />
          </div>
          <div className={clsx('tnum mt-0.5 text-lg font-semibold', toneForValue(snapshot.totals.net_charm))}>
            {formatExposure(snapshot.totals.net_charm, settings.units)}
          </div>
          <div className="mt-0.5 text-2xs text-faint">per calendar day of decay</div>
        </div>
        <div>
          <div className="stat-label">Absolute GEX</div>
          <div className="tnum mt-0.5 text-lg font-semibold">
            {formatExposure(snapshot.totals.absolute_gex, settings.units)}
          </div>
          <div className="mt-0.5 text-2xs text-faint">
            {formatNumber(snapshot.totals.contract_count)} contracts in scope
          </div>
        </div>
        <div>
          <div className="stat-label">Call / Put GEX</div>
          <div className="tnum mt-0.5 text-sm font-semibold">
            <span className="text-pos">{formatExposure(snapshot.totals.call_gex, settings.units)}</span>
            <span className="mx-1 text-faint">/</span>
            <span className="text-neg">{formatExposure(snapshot.totals.put_gex, settings.units)}</span>
          </div>
        </div>
        <div>
          <div className="stat-label">Sign convention</div>
          <div className="mt-0.5 text-xs font-medium text-muted">
            {snapshot.sign_convention.replace(/_/g, ' ')}
          </div>
          <div className="mt-0.5 text-2xs text-faint">configurable in Settings</div>
        </div>
      </div>
    </Panel>
  );
}

