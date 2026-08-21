'use client';

import { clsx } from 'clsx';
import { useState } from 'react';

import {
  formatDateShort,
  formatExposure,
  formatIv,
  formatNumber,
  formatPct,
  formatPrice,
  formatRatio,
} from '@/lib/format';
import type { GexUnit, LadderResponse } from '@/lib/types';
import { Info, SegmentedControl } from '@/components/ui';

function Card({
  title,
  term,
  right,
  children,
}: {
  title: string;
  term?: Parameters<typeof Info>[0]['term'];
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted">{title}</h3>
        {term ? <Info term={term} /> : null}
        {right ? <div className="ml-auto">{right}</div> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Pair({
  label, value, sub, tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className={clsx('tnum mt-0.5 truncate text-[15px] font-semibold', tone)}>{value}</div>
      {sub ? <div className="tnum mt-0.5 truncate text-[10px] text-faint">{sub}</div> : null}
    </div>
  );
}

const tone = (v: number | null | undefined) =>
  v == null || v === 0 ? 'text-muted' : v > 0 ? 'text-pos' : 'text-neg';

/** A price level plus its distance, the pairing used everywhere in this app. */
function LevelLine({
  tag, label, price, distancePct, toneClass,
}: {
  tag: string;
  label: string;
  price: number | null | undefined;
  distancePct?: number | null;
  toneClass: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]">
      <span className="flex items-center gap-1.5 truncate">
        <span className={clsx('rounded border px-1 text-[8.5px] font-bold leading-[1.4]', toneClass)}>
          {tag}
        </span>
        <span className="truncate text-[11px] text-muted">{label}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-1.5">
        <span className="tnum text-[12px] font-semibold">
          {price == null ? '–' : formatPrice(price)}
        </span>
        {distancePct != null ? (
          <span className={clsx('tnum text-[10px]', tone(distancePct))}>
            {formatPct(distancePct, 2, true)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function AnalyticsPanel({
  data,
  units,
  onSelectExpiration,
  selectedExpirations,
}: {
  data: LadderResponse;
  units: GexUnit;
  onSelectExpiration: (iso: string) => void;
  selectedExpirations: string[];
}) {
  const [gexBasis, setGexBasis] = useState<'absolute' | 'net'>('absolute');
  const { summary, keyLevels: kl, expectedMove: em, gammaCondition: gc, dte0 } = data;

  const contribs = [...data.expirationContributions].sort(
    (a, b) =>
      (gexBasis === 'absolute' ? b.absoluteShare : b.netShare) -
      (gexBasis === 'absolute' ? a.absoluteShare : a.netShare),
  );
  const maxShare = Math.max(
    1,
    ...contribs.map((c) => (gexBasis === 'absolute' ? c.absoluteShare : c.netShare)),
  );

  const positioningTone =
    gc.positioning === 'CALL DOMINATED'
      ? 'border-pos/45 bg-pos/10 text-pos'
      : gc.positioning === 'PUT DOMINATED'
        ? 'border-neg/45 bg-neg/10 text-neg'
        : 'border-line bg-raised text-muted';
  const regimeTone = gc.regime.includes('POSITIVE')
    ? 'border-pos/45 bg-pos/10 text-pos'
    : gc.regime.includes('NEGATIVE')
      ? 'border-neg/45 bg-neg/10 text-neg'
      : 'border-warn/45 bg-warn/10 text-warn';

  return (
    <div className="flex flex-col gap-3">
      {/* 1 — gamma / OI summary */}
      <Card title="Gamma & Open Interest" term="net_gex">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Pair
            label="Net GEX"
            value={formatExposure(summary.netGex, units)}
            tone={tone(summary.netGex)}
            sub="per 1% move"
          />
          <Pair label="Total OI" value={formatNumber(summary.totalOi)} sub="contracts" />
          <Pair label="Call OI" value={formatNumber(summary.callOi)} tone="text-pos" />
          <Pair label="Put OI" value={formatNumber(summary.putOi)} tone="text-neg" />
          <Pair label="P/C OI" value={formatRatio(summary.putCallOiRatio)} />
          <Pair label="P/C Volume" value={formatRatio(summary.putCallVolumeRatio)} />
        </div>
      </Card>

      {/* 2 — expected move */}
      <Card title="Expected Move" term="expected_move">
        {em?.movePoints != null ? (
          <>
            <div className="grid grid-cols-2 gap-x-4">
              <Pair label="Move" value={formatPct(em.movePercent, 2)} sub={em.method} />
              <Pair label="Points" value={`±${formatPrice(em.movePoints)}`} sub={`${em.dte < 1 ? '0DTE' : `${Math.round(em.dte)}D`} · ${formatDateShort(em.expiration)}`} />
            </div>
            <div className="mt-3 space-y-1 border-t border-line pt-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider text-faint">Top</span>
                <span className="tnum text-[12px] font-semibold text-pos">{formatPrice(em.high)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider text-faint">Spot</span>
                <span className="tnum text-[12px] font-semibold">{formatPrice(data.spot)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider text-faint">Bottom</span>
                <span className="tnum text-[12px] font-semibold text-neg">{formatPrice(em.low)}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-faint">
            No ATM straddle quoted for the nearest expiry, so the expected move cannot be priced.
          </p>
        )}
      </Card>

      {/* 3 — gamma condition */}
      <Card title="Market Gamma Condition" term="regime">
        <div className="flex flex-wrap gap-1.5">
          <span className={clsx('chip', positioningTone)}>{gc.positioning}</span>
          <span className={clsx('chip', regimeTone)}>{gc.regime}</span>
        </div>
        <div className="mt-3 space-y-1.5">
          {Object.entries(gc.components).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-[76px] shrink-0 text-[9.5px] uppercase tracking-wider text-faint">
                {k.replace(/_/g, ' ')}
              </span>
              <div className="relative h-1.5 flex-1 rounded-[1px] bg-line/60" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-faint/50" />
                <span
                  className={clsx('absolute inset-y-0 rounded-[1px]', v >= 0 ? 'left-1/2 bg-pos/70' : 'right-1/2 bg-neg/70')}
                  style={{ width: `${(Math.abs(v) / 2) * 100}%` }}
                />
              </div>
              <span className={clsx('tnum w-[42px] shrink-0 text-right text-[10px]', tone(v))}>
                {v > 0 ? '+' : ''}{v.toFixed(2)}
              </span>
              <span className="w-[30px] shrink-0 text-right text-[9px] text-faint">
                ×{gc.weights[k]?.toFixed(2)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-1.5">
            <span className="text-[9.5px] uppercase tracking-wider text-faint">Weighted score</span>
            <span className={clsx('tnum text-[12px] font-bold', tone(gc.score))}>
              {gc.score > 0 ? '+' : ''}{gc.score.toFixed(3)}
            </span>
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-faint">{gc.explanation}</p>
      </Card>

      {/* 4 — key levels */}
      <Card title="Key Levels">
        <LevelLine tag="SPOT" label="Spot" price={data.spot} toneClass="border-ink/40 bg-ink/10 text-ink" />
        <LevelLine tag="GF" label="Gamma Flip" price={kl.gammaFlip?.price} distancePct={kl.gammaFlip?.distancePercent} toneClass="border-warn/45 bg-warn/10 text-warn" />
        <LevelLine tag="CW" label="Call Wall" price={kl.callWall?.price} distancePct={kl.callWall?.distancePercent} toneClass="border-pos/45 bg-pos/10 text-pos" />
        <LevelLine tag="PW" label="Put Wall" price={kl.putWall?.price} distancePct={kl.putWall?.distancePercent} toneClass="border-neg/45 bg-neg/10 text-neg" />
        <div className="my-1 border-t border-line" />
        <LevelLine tag="+GT" label="Upper Gamma Transition" price={kl.upperGammaTransition} toneClass="border-warn/35 bg-warn/5 text-warn" />
        <LevelLine tag="−GT" label="Lower Gamma Transition" price={kl.lowerGammaTransition} toneClass="border-warn/35 bg-warn/5 text-warn" />
        <div className="my-1 border-t border-line" />
        <LevelLine tag="CΓ" label="Largest Call Gamma" price={kl.largestCallGamma?.price} distancePct={kl.largestCallGamma?.distancePercent} toneClass="border-pos/35 bg-pos/5 text-pos" />
        <LevelLine tag="PΓ" label="Largest Put Gamma" price={kl.largestPutGamma?.price} distancePct={kl.largestPutGamma?.distancePercent} toneClass="border-neg/35 bg-neg/5 text-neg" />
        <LevelLine tag="COI" label="Largest Call OI" price={kl.largestCallOi?.price} distancePct={kl.largestCallOi?.distancePercent} toneClass="border-pos/35 bg-pos/5 text-pos" />
        <LevelLine tag="POI" label="Largest Put OI" price={kl.largestPutOi?.price} distancePct={kl.largestPutOi?.distancePercent} toneClass="border-neg/35 bg-neg/5 text-neg" />
        {kl.allGammaTransitions.length > 2 ? (
          <p className="mt-1.5 text-[10px] text-faint">
            {kl.allGammaTransitions.length} zero crossings in the modelled profile; the two
            bracketing spot are shown.
          </p>
        ) : null}
      </Card>

      {/* 5 — GEX by expiration */}
      <Card
        title="GEX by Expiration"
        right={
          <SegmentedControl
            size="xs"
            value={gexBasis}
            onChange={setGexBasis}
            options={[
              { label: 'Absolute', value: 'absolute' as const },
              { label: 'Net', value: 'net' as const },
            ]}
          />
        }
      >
        <div className="space-y-1">
          {contribs.slice(0, 10).map((c) => {
            const share = gexBasis === 'absolute' ? c.absoluteShare : c.netShare;
            const selected = selectedExpirations.includes(c.expiration);
            return (
              <button
                key={c.expiration}
                type="button"
                onClick={() => onSelectExpiration(c.expiration)}
                title={
                  `${c.expiration} · ${c.dte < 1 ? '0DTE' : `${Math.round(c.dte)} DTE`}\n` +
                  `Call GEX: ${formatExposure(c.callGex, units)}\n` +
                  `Put GEX: ${formatExposure(c.putGex, units)}\n` +
                  `Net GEX: ${formatExposure(c.netGex, units)}\n` +
                  `Absolute GEX: ${formatExposure(c.absoluteGex, units)}\n` +
                  `Total OI: ${formatNumber(c.totalOi)}\n` +
                  `ATM IV: ${formatIv(c.atmIv)}`
                }
                className={clsx(
                  'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-raised',
                  selected && 'bg-accent/10',
                )}
              >
                <span className="tnum w-[46px] shrink-0 text-[10.5px] text-muted">
                  {formatDateShort(c.expiration)}
                </span>
                {c.isZeroDte ? (
                  <span className="chip border-warn/45 bg-warn/10 px-1 text-[8px] text-warn">0DTE</span>
                ) : null}
                <span className="h-2 flex-1 overflow-hidden rounded-[1px] bg-line/60">
                  <span
                    className={clsx('block h-full', c.netGex >= 0 ? 'bg-pos/70' : 'bg-neg/70')}
                    style={{ width: `${(share / maxShare) * 100}%` }}
                  />
                </span>
                <span className="tnum w-[38px] shrink-0 text-right text-[10.5px]">
                  {share.toFixed(0)}%
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-faint">Click an expiration to filter the ladder.</p>
      </Card>

      {/* 6 — 0DTE */}
      {dte0.available ? (
        <Card title="0DTE Snapshot">
          <div className="mb-2 flex items-center gap-2">
            <span className="chip border-warn/45 bg-warn/10 text-warn">0DTE</span>
            <span className="tnum text-[11px] text-muted">
              {dte0.expiration ? formatDateShort(dte0.expiration) : ''}
            </span>
            {dte0.shareOfAbsoluteGex != null ? (
              <span className="ml-auto text-[10px] text-faint">
                {dte0.shareOfAbsoluteGex.toFixed(0)}% of chain gamma
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Pair label="0DTE Net GEX" value={formatExposure(dte0.netGex, units)} tone={tone(dte0.netGex)} />
            <Pair label="0DTE Call GEX" value={formatExposure(dte0.callGex, units)} tone="text-pos" />
            <Pair label="0DTE Put GEX" value={formatExposure(dte0.putGex, units)} tone="text-neg" />
            <Pair label="0DTE OI" value={formatNumber(dte0.callOi + dte0.putOi)} sub={`${formatNumber(dte0.callOi)}c / ${formatNumber(dte0.putOi)}p`} />
            <Pair
              label="0DTE Volume"
              value={formatNumber(dte0.callVolume + dte0.putVolume)}
              sub={`${formatNumber(dte0.callVolume)}c / ${formatNumber(dte0.putVolume)}p`}
            />
          </div>
        </Card>
      ) : null}

      {/* 7 — model assumptions */}
      <Card title="Model Assumptions">
        <dl className="space-y-1.5 text-[10.5px]">
          {[
            ['Sign convention', data.signConvention.replace(/_/g, ' ')],
            ['Exercise style', data.exerciseStyle],
            ['Risk-free rate', `${(data.riskFreeRate * 100).toFixed(2)}%`],
            ['Dividend yield', `${(data.dividendYield * 100).toFixed(2)}%`],
            ['Rate source', data.rateSource],
            ['Contracts in scope', formatNumber(data.expirationSelection.contractsInScope)],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-faint">{k}</dt>
              <dd className="truncate text-right font-medium text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        {data.exerciseStyle === 'american' ? (
          <p className="mt-2 text-[10px] leading-relaxed text-faint">
            Greeks are priced with Black-Scholes-Merton, which is European. For American
            equity options this is close near the money and least accurate on deep-ITM puts,
            where early exercise carries value.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
