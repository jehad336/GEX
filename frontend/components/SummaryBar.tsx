'use client';

import { clsx } from 'clsx';

import {
  formatExposure,
  formatIv,
  formatPct,
  formatPrice,
  formatRatio,
  formatSignedPrice,
  formatTime,
  regimeTone,
  toneForValue,
} from '@/lib/format';
import type { DashboardSettings, GexSnapshot, Level, Underlying } from '@/lib/types';
import { FreshnessBadge, Info, QualityIndicator, Stat } from './ui';

/** A price level plus its distance from spot, always shown together. */
export function LevelReadout({
  level,
  label,
  term,
  tone,
  spot,
}: {
  level: Level | undefined;
  label: string;
  term?: Parameters<typeof Info>[0]['term'];
  tone?: string;
  spot: number;
}) {
  const price = level?.price;
  const distance = level?.distance ?? (price != null ? price - spot : null);
  const distancePct = level?.distance_pct;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <span className="stat-label truncate">{label}</span>
        {term ? <Info term={term} /> : null}
        {level?.confidence ? (
          <span
            className="text-[9px] uppercase tracking-wider text-faint"
            title="Confidence reflects how far this strike stands out from its neighbours."
          >
            {level.confidence}
          </span>
        ) : null}
      </div>
      <div className={clsx('tnum mt-0.5 text-lg font-semibold leading-tight', tone)}>
        {price != null ? formatPrice(price) : '--'}
      </div>
      <div className="tnum mt-0.5 text-2xs text-faint">
        {price != null
          ? `${formatSignedPrice(distance)} · ${formatPct(distancePct, 2, true)}`
          : (level?.note ?? 'not available')}
      </div>
    </div>
  );
}

export function SummaryBar({
  snapshot,
  underlying,
  settings,
}: {
  snapshot: GexSnapshot;
  underlying: Underlying | null;
  settings: DashboardSettings;
}) {
  const spot = underlying?.price ?? snapshot.spot;
  const changePct = underlying?.change_pct ?? null;
  const em = snapshot.expected_move;

  return (
    <section className="panel">
      <header className="panel-head">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold tracking-tight">{snapshot.symbol}</h2>
          <span className={clsx('chip', regimeTone(snapshot.regime.regime))} title={snapshot.regime.explanation}>
            {snapshot.regime.regime}
          </span>
          <Info term="regime" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QualityIndicator quality={snapshot.quality} />
          <FreshnessBadge status={snapshot.freshness.status} asOf={snapshot.freshness.as_of} />
          <span className="text-2xs text-faint" title={`Sign convention: ${snapshot.sign_convention}`}>
            {formatTime(snapshot.computed_at, settings.timezone)} ·{' '}
            {snapshot.calculation_ms.toFixed(0)} ms calc · {snapshot.provider}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 p-4 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-9">
        <Stat
          label="Spot"
          value={formatPrice(spot)}
          sub={
            underlying?.change != null
              ? `${formatSignedPrice(underlying.change)} · ${formatPct(changePct, 2, true)}`
              : undefined
          }
          tone={toneForValue(changePct)}
        />
        <Stat
          label="Net GEX"
          term="net_gex"
          value={formatExposure(snapshot.totals.net_gex, settings.units)}
          sub={`per 1% move`}
          tone={toneForValue(snapshot.totals.net_gex)}
          title={`Exact: ${snapshot.totals.net_gex.toLocaleString('en-US')}`}
        />
        <LevelReadout
          label="Gamma Flip"
          term="gamma_flip"
          level={snapshot.levels.gamma_flip}
          spot={spot}
          tone="text-warn"
        />
        <LevelReadout
          label="Call Wall"
          term="call_wall"
          level={snapshot.levels.call_wall}
          spot={spot}
          tone="text-pos"
        />
        <LevelReadout
          label="Put Wall"
          term="put_wall"
          level={snapshot.levels.put_wall}
          spot={spot}
          tone="text-neg"
        />
        <Stat
          label="Expected Move"
          term="expected_move"
          value={em?.move_abs != null ? `±${formatPrice(em.move_abs)}` : '--'}
          sub={
            em?.move_pct != null
              ? `±${em.move_pct.toFixed(2)}% · ${em.dte < 1 ? '0DTE' : `${Math.round(em.dte)}D`}`
              : em?.method
          }
        />
        <Stat
          label="0DTE GEX"
          value={formatExposure(snapshot.dte0.net_gex, settings.units)}
          sub={
            // Measured against ABSOLUTE gamma, not net. Net can be near zero when
            // calls and puts offset, which would make this share exceed 100%.
            snapshot.totals.absolute_gex
              ? `${((snapshot.dte0.absolute_gex / snapshot.totals.absolute_gex) * 100).toFixed(0)}% of chain gamma`
              : undefined
          }
          tone={toneForValue(snapshot.dte0.net_gex)}
          title={`Exact: ${snapshot.dte0.net_gex.toLocaleString('en-US')}`}
        />
        <Stat
          label="P/C Ratios"
          term="put_call_ratio"
          value={formatRatio(snapshot.ratios.volume_ratio)}
          sub={`vol · ${formatRatio(snapshot.ratios.oi_ratio)} OI`}
        />
        <Stat label="ATM IV" term="iv" value={formatIv(snapshot.atm_iv)} sub="front expiry" />
      </div>

      <div className="border-t border-line px-4 py-2">
        <p className="text-2xs leading-relaxed text-faint">
          <span className="font-semibold uppercase tracking-wider text-warn">Model estimate</span>{' '}
          {snapshot.disclaimer}
        </p>
      </div>
    </section>
  );
}
