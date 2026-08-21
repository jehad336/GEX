'use client';

import { clsx } from 'clsx';
import { useCallback, useMemo } from 'react';

import { formatExposureAuto, formatIv, formatNumber, formatPct, formatPrice } from '@/lib/format';
import type { LadderKeyLevels, LadderMetric, LadderRow, LadderView } from '@/lib/types';

/* ------------------------------------------------------------------ columns */

interface ExposureColumn {
  key: string;
  label: string;
  short: string;
  /** Signed value the bar is drawn from. */
  value: (r: LadderRow) => number;
  call: (r: LadderRow) => number;
  put: (r: LadderRow) => number;
  metric: LadderMetric;
  compact: boolean;
}

export const EXPOSURE_COLUMNS: ExposureColumn[] = [
  {
    key: 'netDelta', label: 'Net Delta', short: 'DEX', metric: 'dex', compact: true,
    value: (r) => r.netDelta, call: (r) => r.callDelta, put: (r) => r.putDelta,
  },
  {
    key: 'netGamma', label: 'Net Gamma', short: 'GEX', metric: 'gex', compact: true,
    value: (r) => r.netGamma, call: (r) => r.callGamma, put: (r) => r.putGamma,
  },
  {
    key: 'netVanna', label: 'Net Vanna', short: 'VANNA', metric: 'vanna', compact: false,
    value: (r) => r.netVanna, call: (r) => r.callVanna, put: (r) => r.putVanna,
  },
  {
    key: 'netCharm', label: 'Net Charm', short: 'CHARM', metric: 'charm', compact: false,
    value: (r) => r.netCharm, call: (r) => r.callCharm, put: (r) => r.putCharm,
  },
];

export type SortKey = 'strike' | 'netDelta' | 'netGamma' | 'netVanna' | 'netCharm' | 'netOI' | 'totalOI' | 'totalVolume';

export interface LadderTableProps {
  rows: LadderRow[];
  spot: number;
  keyLevels: LadderKeyLevels;
  metric: LadderMetric;
  view: LadderView;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (k: SortKey) => void;
  oiQuartiles: { q1: number; q2: number; q3: number; max: number };
  starred: ReadonlySet<number>;
  onToggleStar: (strike: number) => void;
  onSelectStrike: (row: LadderRow) => void;
  spotRowRef?: React.RefObject<HTMLTableRowElement | null>;
}

/* ------------------------------------------------------------------ marks */

/** Short tags drawn beside a strike when a key level sits on it. */
function levelTags(strike: number, kl: LadderKeyLevels, step: number) {
  const near = (v: number | null | undefined) =>
    v != null && Math.abs(v - strike) <= step / 2;
  const tags: { tag: string; title: string; tone: string }[] = [];

  if (near(kl.gammaFlip?.price)) tags.push({ tag: 'GF', title: 'Gamma Flip', tone: 'flip' });
  if (near(kl.callWall?.price)) tags.push({ tag: 'CW', title: 'Call Wall', tone: 'pos' });
  if (near(kl.putWall?.price)) tags.push({ tag: 'PW', title: 'Put Wall', tone: 'neg' });
  if (near(kl.expectedMoveHigh)) tags.push({ tag: 'EM+', title: 'Expected Move High', tone: 'acc' });
  if (near(kl.expectedMoveLow)) tags.push({ tag: 'EM-', title: 'Expected Move Low', tone: 'acc' });
  if (near(kl.largestCallGamma?.price)) tags.push({ tag: 'CΓ', title: 'Largest Call Gamma', tone: 'pos' });
  if (near(kl.largestPutGamma?.price)) tags.push({ tag: 'PΓ', title: 'Largest Put Gamma', tone: 'neg' });
  if (near(kl.largestCallOi?.price)) tags.push({ tag: 'COI', title: 'Largest Call OI', tone: 'pos' });
  if (near(kl.largestPutOi?.price)) tags.push({ tag: 'POI', title: 'Largest Put OI', tone: 'neg' });
  if (near(kl.lowerGammaTransition)) tags.push({ tag: '−GT', title: 'Lower Gamma Transition', tone: 'flip' });
  if (near(kl.upperGammaTransition)) tags.push({ tag: '+GT', title: 'Upper Gamma Transition', tone: 'flip' });
  if (near(kl.previousClose)) tags.push({ tag: 'PC', title: 'Previous Close', tone: 'mute' });
  if (near(kl.dayOpen)) tags.push({ tag: 'OPN', title: 'Day Open', tone: 'mute' });
  return tags;
}

const TAG_TONE: Record<string, string> = {
  flip: 'border-warn/45 bg-warn/10 text-warn',
  pos: 'border-pos/45 bg-pos/10 text-pos',
  neg: 'border-neg/45 bg-neg/10 text-neg',
  acc: 'border-accent/45 bg-accent/10 text-accent',
  mute: 'border-line bg-raised text-faint',
};

/* ------------------------------------------------------------------ bar */

/**
 * Centre-zero exposure bar.
 *
 * The value and sign are always rendered as text next to the bar: colour alone
 * must never be the only channel carrying direction.
 */
function ExposureBar({
  value, scale, title,
}: {
  value: number;
  scale: number;
  title: string;
}) {
  const pctWidth = scale > 0 ? Math.min(100, (Math.abs(value) / scale) * 100) : 0;
  const positive = value >= 0;
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <div className="relative h-3.5 min-w-[90px] flex-1" aria-hidden="true">
        {/* zero axis */}
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
        <span
          className={clsx(
            'absolute inset-y-[2px] rounded-[1px]',
            positive ? 'left-1/2 bg-pos/75' : 'right-1/2 bg-neg/75',
          )}
          style={{ width: `${pctWidth / 2}%` }}
        />
      </div>
      <span
        className={clsx(
          'tnum w-[68px] shrink-0 text-right text-[11px] tabular-nums',
          value === 0 ? 'text-faint' : positive ? 'text-pos' : 'text-neg',
        )}
      >
        {value === 0 ? '–' : `${positive ? '+' : '−'}${formatExposureAuto(Math.abs(value)).replace('$', '')}`}
      </span>
    </div>
  );
}

/** Small magnitude bar for a non-signed quantity such as open interest. */
function MagnitudeBar({ value, scale, tone }: { value: number; scale: number; tone: string }) {
  const w = scale > 0 ? Math.min(100, (value / scale) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-2.5 w-full min-w-[56px] overflow-hidden rounded-[1px] bg-line/60" aria-hidden="true">
        <div className={clsx('h-full', tone)} style={{ width: `${w}%` }} />
      </div>
      <span className="tnum w-[52px] shrink-0 text-right text-[11px]">{formatNumber(value)}</span>
    </div>
  );
}

/** Sortable column header. aria-sort belongs on the th, not on the button. */
function SortableTh({
  sortKey, sortAsc, columnKey, label, className, onSort,
}: {
  sortKey: SortKey;
  sortAsc: boolean;
  columnKey: SortKey;
  label: string;
  className?: string;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === columnKey;
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="inline-flex items-center gap-1 hover:text-ink"
      >
        {label}
        <span className={clsx('text-[8px]', active ? 'text-accent' : 'text-faint/50')}>
          {active ? (sortAsc ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  );
}

/* ------------------------------------------------------------------ table */

export function LadderTable(props: LadderTableProps) {
  const {
    rows, spot, keyLevels, metric, view, sortKey, sortAsc, onSort,
    starred, onToggleStar, onSelectStrike, spotRowRef,
  } = props;

  const columns = useMemo(
    () =>
      EXPOSURE_COLUMNS.filter(
        (c) =>
          (metric === 'all' || metric === c.metric) &&
          (view === 'advanced' || c.compact),
      ),
    [metric, view],
  );
  const showOi = metric === 'all' || metric === 'oi';
  const showVolume = (metric === 'all' || metric === 'volume') && view === 'advanced';
  const showIv = view === 'advanced' && metric === 'all';

  /**
   * Each exposure column is scaled against its own maximum. Sharing one scale
   * across delta, gamma, vanna and charm would flatten three of them to
   * invisibility, since they differ by orders of magnitude.
   */
  const scales = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of EXPOSURE_COLUMNS) {
      out[c.key] = Math.max(0, ...rows.map((r) => Math.abs(c.value(r))));
    }
    out.oi = Math.max(0, ...rows.map((r) => Math.max(r.callOI, r.putOI)));
    out.volume = Math.max(0, ...rows.map((r) => Math.max(r.callVolume, r.putVolume)));
    return out;
  }, [rows]);

  // Typical gap between listed strikes, used to decide whether a level "sits on"
  // a row and where to draw the spot line between two rows.
  const strikeStep = useMemo(() => {
    const s = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
    if (s.length < 2) return 1;
    const gaps = s.slice(1).map((v, i) => v - (s[i] as number)).filter((g) => g > 0);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] ?? 1;
  }, [rows]);

  // Index of the first row at or below spot: the spot line is drawn above it.
  const spotIndex = useMemo(() => {
    const i = rows.findIndex((r) => r.strike <= spot);
    return i === -1 ? rows.length : i;
  }, [rows, spot]);

  const inEmRange = useCallback(
    (strike: number) => {
      const { expectedMoveHigh: hi, expectedMoveLow: lo } = keyLevels;
      return lo != null && hi != null && strike >= lo && strike <= hi;
    },
    [keyLevels],
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center px-4 text-center text-xs text-faint">
        No option contracts available for the selected expiration and strike range.
      </div>
    );
  }

  return (
    <>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-20">
          <tr className="bg-surface">
            <th scope="col" className="sticky left-0 z-30 bg-surface px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint">
              <button type="button" onClick={() => onSort('strike')} className="hover:text-ink">
                Strike {sortKey === 'strike' ? (sortAsc ? '▲' : '▼') : '⇅'}
              </button>
            </th>
            <th scope="col" className="bg-surface px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-faint">
              Dist %
            </th>
            {columns.map((c) => (
              <SortableTh
                key={c.key}
                columnKey={c.key as SortKey}
                label={c.label}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                className="w-[190px] min-w-[190px] bg-surface px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint"
              />
            ))}
            {showOi ? (
              <>
                <SortableTh
                  columnKey="netOI"
                  label="Net OI"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="bg-surface px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-faint"
                />
                <th scope="col" className="bg-surface px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint">Call OI</th>
                <th scope="col" className="bg-surface px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint">Put OI</th>
              </>
            ) : null}
            {showVolume ? (
              <>
                <th scope="col" className="bg-surface px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint">Call Vol</th>
                <th scope="col" className="bg-surface px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint">Put Vol</th>
              </>
            ) : null}
            {showIv ? (
              <th scope="col" className="bg-surface px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-faint">IV C/P</th>
            ) : null}
            <th scope="col" className="w-7 bg-surface px-1 py-1.5" aria-label="Starred" />
          </tr>
        </thead>

        <tbody>
          {rows.map((row, i) => {
            const tags = levelTags(row.strike, keyLevels, strikeStep);
            const isStarred = starred.has(row.strike);
            const emShade = inEmRange(row.strike);
            const spotHere = i === spotIndex;

            return (
              <>
                {spotHere ? <SpotRow key="spot" spot={spot} colSpan={40} rowRef={spotRowRef} /> : null}
                <tr
                  key={row.strike}
                  onClick={() => onSelectStrike(row)}
                  className={clsx(
                    'cursor-pointer border-t border-line/50 transition-colors hover:bg-raised',
                    emShade && 'bg-accent/[0.045]',
                    isStarred && 'bg-warn/[0.06]',
                  )}
                >
                  <th
                    scope="row"
                    className={clsx(
                      'sticky left-0 z-10 whitespace-nowrap px-2 py-1 text-left font-normal',
                      emShade ? 'bg-[rgb(var(--surface))]' : 'bg-surface',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="tnum text-[13px] font-semibold">
                        {formatPrice(row.strike, row.strike % 1 === 0 ? 0 : 2)}
                      </span>
                      {tags.map((t) => (
                        <span
                          key={t.tag}
                          title={t.title}
                          className={clsx(
                            'rounded border px-1 text-[8.5px] font-bold leading-[1.35]',
                            TAG_TONE[t.tone],
                          )}
                        >
                          {t.tag}
                        </span>
                      ))}
                    </span>
                  </th>

                  <td
                    className={clsx(
                      'tnum whitespace-nowrap px-2 py-1 text-right text-[11px]',
                      row.distancePercent > 0 ? 'text-pos/80' : row.distancePercent < 0 ? 'text-neg/80' : 'text-muted',
                    )}
                  >
                    {formatPct(row.distancePercent, 2, true)}
                  </td>

                  {columns.map((c) => (
                    // Explicit width: an auto-sized cell collapses the bar to a
                    // few pixels, which defeats the point of the visualization.
                    <td key={c.key} className="w-[190px] min-w-[190px] px-2 py-1">
                      <ExposureBar
                        value={c.value(row)}
                        scale={scales[c.key] ?? 0}
                        title={
                          `${c.label} at ${formatPrice(row.strike)}\n` +
                          `Total: ${formatExposureAuto(c.value(row))}\n` +
                          `Calls: ${formatExposureAuto(c.call(row))}\n` +
                          `Puts: ${formatExposureAuto(c.put(row))}\n` +
                          `Open interest: ${formatNumber(row.totalOI)}\n` +
                          `Volume: ${formatNumber(row.totalVolume)}\n` +
                          `Contracts: ${row.contractCount}\n` +
                          `Distance: ${formatPct(row.distancePercent, 2, true)}`
                        }
                      />
                    </td>
                  ))}

                  {showOi ? (
                    <>
                      <td
                        className={clsx(
                          'tnum px-2 py-1 text-right',
                          row.netOI > 0 ? 'text-pos' : row.netOI < 0 ? 'text-neg' : 'text-faint',
                        )}
                      >
                        {row.netOI > 0 ? '+' : row.netOI < 0 ? '−' : ''}
                        {formatNumber(Math.abs(row.netOI))}
                      </td>
                      <td className="w-[130px] min-w-[130px] px-2 py-1">
                        <MagnitudeBar value={row.callOI} scale={scales.oi ?? 0} tone="bg-pos/70" />
                      </td>
                      <td className="w-[130px] min-w-[130px] px-2 py-1">
                        <MagnitudeBar value={row.putOI} scale={scales.oi ?? 0} tone="bg-neg/70" />
                      </td>
                    </>
                  ) : null}

                  {showVolume ? (
                    <>
                      <td className="w-[130px] min-w-[130px] px-2 py-1">
                        <MagnitudeBar value={row.callVolume} scale={scales.volume ?? 0} tone="bg-pos/55" />
                      </td>
                      <td className="w-[130px] min-w-[130px] px-2 py-1">
                        <MagnitudeBar value={row.putVolume} scale={scales.volume ?? 0} tone="bg-neg/55" />
                      </td>
                    </>
                  ) : null}

                  {showIv ? (
                    <td className="tnum px-2 py-1 text-right text-[11px] text-muted">
                      {formatIv(row.callIv)} / {formatIv(row.putIv)}
                    </td>
                  ) : null}

                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      aria-label={isStarred ? `Unstar ${row.strike}` : `Star ${row.strike}`}
                      aria-pressed={isStarred}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(row.strike);
                      }}
                      className={clsx(
                        'text-[11px] leading-none transition-colors',
                        isStarred ? 'text-warn' : 'text-faint/40 hover:text-warn',
                      )}
                    >
                      ★
                    </button>
                  </td>
                </tr>
              </>
            );
          })}
          {spotIndex >= rows.length ? <SpotRow spot={spot} colSpan={40} rowRef={spotRowRef} /> : null}
        </tbody>
      </table>

      <p className="border-t border-line px-3 py-2 text-[10.5px] leading-relaxed text-faint">
        Exposure is summed per contract, then grouped by strike — greeks are never averaged
        and multiplied by aggregate open interest. Each column carries its own scale.
        Signed exposure is model-derived; open interest and volume are observed.
      </p>
    </>
  );
}

/** The spot marker, drawn as its own row between the two strikes it falls between. */
function SpotRow({
  spot, colSpan, rowRef,
}: {
  spot: number;
  colSpan: number;
  rowRef?: React.RefObject<HTMLTableRowElement | null>;
}) {
  return (
    <tr ref={rowRef} className="relative">
      <td colSpan={colSpan} className="p-0">
        <div className="relative flex items-center gap-2 border-y-2 border-ink/70 bg-ink/[0.07] px-2 py-[3px]">
          <span className="rounded bg-ink px-1.5 py-[1px] text-[9.5px] font-bold uppercase tracking-wider text-bg">
            Spot
          </span>
          <span className="tnum text-[12px] font-bold">{formatPrice(spot)}</span>
          <span className="text-[10px] text-faint">
            live underlying price, positioned between the strikes it falls between
          </span>
        </div>
      </td>
    </tr>
  );
}
