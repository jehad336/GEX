'use client';

import { clsx } from 'clsx';
import { useMemo, useState } from 'react';

import {
  formatDateShort,
  formatExposureAuto,
  formatNumber,
  formatPct,
  formatPrice,
  formatRatio,
} from '@/lib/format';
import type { ExpirationChoice, ExposureLadderResponse, ExposureLadderRow } from '@/lib/types';
import { FreshnessBadge, Info, Panel } from '@/components/ui';

export function ExposureAnalytics({
  data,
  rows,
  multiExpiration,
  onMultiExpirationChange,
  onExpirationSelect,
}: {
  data: ExposureLadderResponse;
  rows: ExposureLadderRow[];
  multiExpiration: boolean;
  onMultiExpirationChange: (enabled: boolean) => void;
  onExpirationSelect: (expiration: string) => void;
}) {
  const [contributionMetric, setContributionMetric] = useState<'net' | 'absolute'>('absolute');
  const maxContribution = Math.max(
    ...data.expiration_contributions.map((row) =>
      Math.abs(contributionMetric === 'net' ? row.net_gex : row.absolute_gex),
    ),
    1,
  );
  const oiValues = useMemo(() => rows.map((row) => row.total_oi).sort((a, b) => a - b), [rows]);
  const q1 = oiValues[Math.floor((oiValues.length - 1) * 0.25)] ?? 0;
  const q3 = oiValues[Math.floor((oiValues.length - 1) * 0.75)] ?? 0;
  const levels = data.key_levels;

  return (
    <aside className="space-y-3">
      <Panel title="Gamma / OI Summary" term="gex">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Metric label="Net GEX" value={formatExposureAuto(data.summary.net_gex)} tone={data.summary.net_gex >= 0 ? 'text-exposurePos' : 'text-exposureNeg'} />
          <Metric label="Total OI" value={formatNumber(data.summary.total_oi)} />
          <Metric label="Call OI" value={formatNumber(data.summary.call_oi)} tone="text-exposurePos" />
          <Metric label="Put OI" value={formatNumber(data.summary.put_oi)} tone="text-exposureNeg" />
          <Metric label="Put/Call OI" value={formatRatio(data.summary.put_call_oi_ratio)} />
          <Metric label="Put/Call Volume" value={formatRatio(data.summary.put_call_volume_ratio)} />
        </div>
        {data.expiration_selection.mode === '0dte' ? (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-2xs">
            <Metric label="0DTE Net GEX" value={formatExposureAuto(data.dte0_summary.net_gex)} />
            <Metric label="0DTE Volume" value={formatNumber(data.dte0_summary.total_volume)} />
          </div>
        ) : null}
      </Panel>

      <Panel
        title={`Expected Move — ${['all', 'multiple', 'custom'].includes(data.expiration_selection.mode) ? 'Nearest Expiry' : 'Selected Expiry'}${data.expected_move ? ` (${formatDateShort(data.expected_move.expiration)})` : ''}`}
        term="expected_move"
      >
        {data.expected_move?.move_abs != null ? (
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <div className="tnum text-2xl font-bold text-accent">{formatPct(data.expected_move.move_pct, 2)}</div>
                <div className="text-2xs text-faint">{formatPrice(data.expected_move.move_abs)} pts · ATM straddle</div>
              </div>
              <span className="chip border-line bg-raised text-muted">{formatDateShort(data.expected_move.expiration)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded border border-line bg-raised/50 p-2 text-center">
              <Metric label="Bottom" value={formatPrice(data.expected_move.lower)} tone="text-exposureNeg" />
              <Metric label="Spot" value={formatPrice(data.spot)} tone="text-ink" />
              <Metric label="Top" value={formatPrice(data.expected_move.upper)} tone="text-exposurePos" />
            </div>
          </div>
        ) : <p className="text-xs text-faint">ATM call and put quotes are unavailable for this selection.</p>}
      </Panel>

      <Panel title="Gamma Condition" term="regime">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <span className={clsx('chip', data.gamma_condition.gamma_regime.includes('Positive') ? 'border-exposurePos/40 bg-exposurePos/10 text-exposurePos' : 'border-exposureNeg/40 bg-exposureNeg/10 text-exposureNeg')}>
              {data.gamma_condition.label}
            </span>
            <span className="chip border-line bg-raised text-muted">{data.gamma_condition.positioning}</span>
            {data.gamma_condition.flip_proximity_warning ? (
              <span className="chip border-warn/50 bg-warn/10 text-warn" title="The nearest gamma-profile crossing is within 0.05% of spot. A small quote or spot update can change the displayed regime.">
                Quote-sensitive flip
              </span>
            ) : null}
          </div>
          <p className="text-2xs leading-relaxed text-muted">{data.gamma_condition.explanation}</p>
          <div className="h-1.5 overflow-hidden rounded bg-exposureNeg/30" title={data.gamma_condition.methodology}>
            <div className="h-full bg-exposurePos" style={{ width: `${data.gamma_condition.call_dominance_score * 100}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-faint"><span>Put dominated</span><span>Call dominated</span></div>
        </div>
      </Panel>

      <Panel title="Key Levels">
        <div className="space-y-1.5">
          {([
            ['gamma_flip', 'GF'],
            ['call_wall', 'CW*'],
            ['put_wall', 'PW*'],
            ['largest_call_gamma', '+GEX'],
            ['largest_put_gamma', '−GEX'],
            ['largest_call_oi', 'COI'],
            ['largest_put_oi', 'POI'],
            ['lower_gamma_transition', 'Lower transition'],
            ['upper_gamma_transition', 'Upper transition'],
          ] as const).map(([key, short]) => {
            const level = levels[key];
            if (level?.price == null) return null;
            return (
              <div
                key={key}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-raised"
                title={level.note ? `${level.label}\nConfidence: ${level.confidence ?? 'n/a'}\n${level.note}` : level.label}
              >
                <span className="text-faint">{short}</span>
                <span className="tnum font-semibold text-ink">{formatPrice(level.price)}</span>
                <span className={clsx('tnum w-16 text-right', (level.distance_pct ?? 0) >= 0 ? 'text-exposurePos' : 'text-exposureNeg')}>
                  {formatLevelDistance(level.distance_pct)}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="GEX by Expiration"
        right={
          <div className="inline-flex rounded border border-line text-[9px]">
            <button type="button" onClick={() => setContributionMetric('net')} className={clsx('px-1.5 py-0.5', contributionMetric === 'net' ? 'bg-accent/15 text-accent' : 'text-faint')}>Net</button>
            <button type="button" onClick={() => setContributionMetric('absolute')} className={clsx('px-1.5 py-0.5', contributionMetric === 'absolute' ? 'bg-accent/15 text-accent' : 'text-faint')}>Absolute</button>
          </div>
        }
      >
        <div className="max-h-56 space-y-1 overflow-auto pr-1">
          {data.expiration_contributions.map((row) => {
            const value = contributionMetric === 'net' ? row.net_gex : row.absolute_gex;
            return (
              <button
                key={row.expiration}
                type="button"
                onClick={() => onExpirationSelect(row.expiration)}
                className="group grid w-full grid-cols-[52px_1fr_48px] items-center gap-2 text-left text-[9px]"
                title={`Expiration: ${row.expiration}\nDTE: ${row.dte.toFixed(1)}\nCall GEX: ${formatExposureAuto(row.call_gex)}\nPut GEX: ${formatExposureAuto(row.put_gex)}\nNet GEX: ${formatExposureAuto(row.net_gex)}\nAbsolute GEX: ${formatExposureAuto(row.absolute_gex)}\nTotal OI: ${formatNumber(row.total_oi)}`}
              >
                <span className="text-faint group-hover:text-ink">{formatDateShort(row.expiration)}</span>
                <span className="h-2 overflow-hidden rounded bg-raised">
                  <span
                    className={clsx('block h-full rounded', value >= 0 ? 'bg-exposurePos/75' : 'bg-exposureNeg/75')}
                    style={{ width: `${Math.abs(value) / maxContribution * 100}%` }}
                  />
                </span>
                <span className="tnum text-right text-muted">{row.share_of_absolute.toFixed(0)}%</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Expiration Selector"
        right={
          <button type="button" onClick={() => onMultiExpirationChange(!multiExpiration)} className={clsx('btn px-1.5 py-0.5 text-[9px]', multiExpiration && 'btn-active')}>
            {multiExpiration ? 'Multiple' : 'Single'}
          </button>
        }
      >
        <div className="max-h-52 grid grid-cols-2 gap-1 overflow-auto pr-1">
          {data.expiration_selection.available.map((choice: ExpirationChoice) => (
            <button
              key={choice.expiration}
              type="button"
              onClick={() => onExpirationSelect(choice.expiration)}
              className={clsx('rounded border px-2 py-1 text-left text-[9px]', choice.selected ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-raised text-muted hover:text-ink')}
            >
              <span className="tnum block font-semibold">{choice.expiration}</span>
              <span className="text-faint">{choice.kind} · {choice.dte < 1 ? '0DTE' : `${Math.round(choice.dte)}D`}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="OI Quartile Scale" term="open_interest">
        <div className="space-y-1.5">
          <div className="h-2 rounded bg-gradient-to-r from-raised via-accent/40 to-accent" />
          <div className="flex justify-between text-[9px] text-faint">
            <span>Bottom 25% ≤ {formatNumber(q1)}</span>
            <span>Top 25% ≥ {formatNumber(q3)}</span>
          </div>
        </div>
      </Panel>

      <div className="panel p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <FreshnessBadge status={data.freshness.underlying} />
          <FreshnessBadge status={data.freshness.quotes} />
          <FreshnessBadge status={data.freshness.open_interest} />
          <Info term="open_interest" />
        </div>
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]">
          <dt className="text-faint">Quote as-of</dt><dd className="tnum text-muted">{data.freshness.quote_as_of ?? '--'}</dd>
          <dt className="text-faint">Greeks source</dt><dd className="text-muted">{data.freshness.greeks_source}</dd>
          <dt className="text-faint">OI as-of</dt><dd className="tnum text-muted">{data.freshness.oi_as_of ?? 'previous session'}</dd>
          <dt className="text-faint">Quality excluded</dt><dd className="tnum text-muted">{formatNumber(data.freshness.excluded_contracts)} contracts</dd>
        </dl>
        <p className="text-[10px] leading-relaxed text-faint">{data.freshness.note}</p>
      </div>
    </aside>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div><div className="stat-label">{label}</div><div className={clsx('tnum mt-0.5 text-sm font-semibold', tone)}>{value}</div></div>;
}

function formatLevelDistance(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '--';
  if (value !== 0 && Math.abs(value) < 0.01) return `${value > 0 ? '+' : '−'}<0.01%`;
  return formatPct(value, 2, true);
}
