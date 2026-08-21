'use client';

import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

import { formatExposureAuto, formatIv, formatNumber, formatPct, formatPrice } from '@/lib/format';
import type { ExposureLadderRow, LadderContract, Level } from '@/lib/types';
import { ExposureBar, SplitOiBar } from './ExposureBar';

export type LadderMetric = 'all' | 'gex' | 'dex' | 'vanna' | 'charm' | 'oi' | 'volume';
export type LadderDensity = 'compact' | 'advanced';
export type LadderSort = 'strike' | 'net_delta' | 'net_gamma' | 'net_vanna' | 'net_charm' | 'net_oi' | 'call_oi' | 'put_oi' | 'total_volume';

const MAX_VIEWPORT_HEIGHT = 640;
const OVERSCAN = 8;

interface Column {
  key: string;
  label: string;
  width: string;
  metric?: keyof ExposureLadderRow;
  raw?: boolean;
}

function columnsFor(density: LadderDensity, metric: LadderMetric): Column[] {
  const strike: Column = { key: 'strike', label: 'Strike / Levels', width: '132px' };
  const distance: Column = { key: 'distance', label: 'Distance', width: '80px' };
  const map: Record<Exclude<LadderMetric, 'all'>, Column> = {
    gex: { key: 'net_gamma', label: 'Net Gamma', width: 'minmax(126px,1fr)', metric: 'net_gamma' },
    dex: { key: 'net_delta', label: 'Dealer DEX*', width: 'minmax(132px,1fr)', metric: 'net_delta' },
    vanna: { key: 'net_vanna', label: 'Net Vanna', width: 'minmax(126px,1fr)', metric: 'net_vanna' },
    charm: { key: 'net_charm', label: 'Net Charm', width: 'minmax(126px,1fr)', metric: 'net_charm' },
    oi: { key: 'net_oi', label: 'Net OI', width: 'minmax(116px,.85fr)', metric: 'net_oi', raw: true },
    volume: { key: 'net_volume', label: 'Net Volume', width: 'minmax(116px,.85fr)', metric: 'net_volume', raw: true },
  };
  if (metric !== 'all') {
    return [strike, map[metric], { key: 'call_put_oi', label: 'Call / Put OI', width: '122px' }, distance];
  }
  if (density === 'compact') {
    return [strike, map.dex, map.gex, map.oi, distance];
  }
  return [
    strike,
    map.dex,
    map.gex,
    map.vanna,
    map.charm,
    map.oi,
    { key: 'call_oi', label: 'Call OI', width: '78px' },
    { key: 'put_oi', label: 'Put OI', width: '78px' },
    { key: 'volume', label: 'Volume', width: '84px' },
    distance,
  ];
}

const LEVEL_META: Record<string, { short: string; className: string; priority: number }> = {
  gamma_flip: { short: 'GF', className: 'border-warn text-warn', priority: 1 },
  call_wall: { short: 'CW*', className: 'border-exposurePos text-exposurePos', priority: 2 },
  put_wall: { short: 'PW*', className: 'border-exposureNeg text-exposureNeg', priority: 3 },
  expected_move_high: { short: 'EM+', className: 'border-accent/60 text-accent', priority: 4 },
  expected_move_low: { short: 'EM−', className: 'border-accent/60 text-accent', priority: 5 },
};

function positionForPrice(rows: ExposureLadderRow[], price: number): number | null {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last || price > first.strike || price < last.strike) return null;
  for (let index = 0; index < rows.length - 1; index += 1) {
    const high = rows[index]!.strike;
    const low = rows[index + 1]!.strike;
    if (price <= high && price >= low) {
      const fraction = high === low ? 0 : (high - price) / (high - low);
      return index + fraction + 0.5;
    }
  }
  return rows.length - 0.5;
}

function tooltip(
  row: ExposureLadderRow,
  label: string,
  value: number,
  call: number,
  put: number,
  metric: keyof ExposureLadderRow,
  signConvention: string,
) {
  const lines = [
    `Strike ${formatPrice(row.strike)}`,
    `${label}: ${formatExposureAuto(value)}`,
    `Call contribution: ${formatExposureAuto(call)}`,
    `Put contribution: ${formatExposureAuto(put)}`,
    `OI C/P: ${formatNumber(row.call_oi)} / ${formatNumber(row.put_oi)}`,
    `Volume C/P: ${formatNumber(row.call_volume)} / ${formatNumber(row.put_volume)}`,
    `Expirations: ${new Set(row.contracts.map((contract) => contract.expiration)).size}`,
    `Distance: ${row.distance >= 0 ? '+' : ''}${formatPrice(row.distance)} (${formatPct(row.distance_pct, 2, true)})`,
  ];
  if (metric === 'net_delta') {
    lines.splice(
      2,
      0,
      `Displayed: assumed dealer DEX (${signConvention})`,
      `Raw contract DEX: ${formatExposureAuto(row.raw_net_delta)}`,
      `Raw call / put: ${formatExposureAuto(row.raw_call_delta)} / ${formatExposureAuto(row.raw_put_delta)}`,
    );
  }
  return lines.join('\n');
}

function contractSides(row: ExposureLadderRow, key: keyof ExposureLadderRow): [number, number] {
  const lookup: Partial<Record<keyof ExposureLadderRow, [keyof ExposureLadderRow, keyof ExposureLadderRow]>> = {
    net_delta: ['call_delta', 'put_delta'],
    net_gamma: ['call_gamma', 'put_gamma'],
    net_vanna: ['call_vanna', 'put_vanna'],
    net_charm: ['call_charm', 'put_charm'],
  };
  const pair = lookup[key];
  if (!pair) return [0, 0];
  return [Number(row[pair[0]]), Number(row[pair[1]])];
}

export function StrikeLadder({
  rows,
  spot,
  levels,
  metric,
  density,
  sort,
  onSort,
  favorites,
  onToggleFavorite,
  onOpenRow,
  centerSignal,
  followSpot,
  signConvention,
}: {
  rows: ExposureLadderRow[];
  spot: number;
  levels: Record<string, Level>;
  metric: LadderMetric;
  density: LadderDensity;
  sort: LadderSort;
  onSort: (sort: LadderSort) => void;
  favorites: number[];
  onToggleFavorite: (strike: number) => void;
  onOpenRow: (row: ExposureLadderRow) => void;
  centerSignal: number;
  followSpot: boolean;
  signConvention: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = density === 'advanced' ? 44 : 40;
  const columns = useMemo(() => columnsFor(density, metric), [density, metric]);
  const template = columns.map((column) => column.width).join(' ');
  const ordered = useMemo(() => {
    if (sort === 'strike') return [...rows].sort((a, b) => b.strike - a.strike);
    return [...rows].sort((a, b) => Math.abs(Number(b[sort])) - Math.abs(Number(a[sort])));
  }, [rows, sort]);
  const naturalOrder = sort === 'strike';
  const maxByMetric = useMemo(() => {
    const output = new Map<string, number>();
    for (const column of columns) {
      if (!column.metric) continue;
      output.set(
        column.key,
        Math.max(...ordered.map((row) => Math.abs(Number(row[column.metric!] ?? 0))), 1),
      );
    }
    return output;
  }, [columns, ordered]);

  const viewportHeight = Math.min(
    MAX_VIEWPORT_HEIGHT,
    Math.max(rowHeight * Math.min(ordered.length, 3), ordered.length * rowHeight),
  );
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const end = Math.min(
    ordered.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN,
  );
  const visible = ordered.slice(start, end);
  const levelOverlays = naturalOrder
    ? Object.entries(LEVEL_META)
      .sort(([, a], [, b]) => a.priority - b.priority)
      .flatMap(([key, meta]) => {
        const level = levels[key];
        if (level?.price == null) return [];
        const position = positionForPrice(ordered, level.price);
        return position === null ? [] : [{ key, meta, level, top: position * rowHeight }];
      })
    : [];
  const levelTagsByRow = levelOverlays.reduce<Map<number, typeof levelOverlays>>((tags, overlay) => {
    const rowIndex = Math.max(0, Math.min(ordered.length - 1, Math.round(overlay.top / rowHeight - 0.5)));
    tags.set(rowIndex, [...(tags.get(rowIndex) ?? []), overlay]);
    return tags;
  }, new Map());

  const centerOnSpot = () => {
    if (!containerRef.current || !naturalOrder) return;
    const position = positionForPrice(ordered, spot);
    if (position === null) return;
    containerRef.current.scrollTo({
      top: Math.max(0, position * rowHeight - viewportHeight / 2),
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    centerOnSpot();
    // The explicit signal and follow mode are the only reasons to move the user's viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerSignal, followSpot ? spot : null, ordered.length, naturalOrder]);

  return (
    <div className="min-w-0 overflow-hidden rounded border border-line bg-bg/30">
      <div
        className="grid border-b border-line bg-surface text-[11px] font-semibold uppercase tracking-wider text-faint"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((column) => {
          const sortable = ['strike', 'net_delta', 'net_gamma', 'net_vanna', 'net_charm', 'net_oi', 'call_oi', 'put_oi', 'total_volume'].includes(column.key);
          return (
            <button
              key={column.key}
              type="button"
              disabled={!sortable}
              onClick={() => sortable && onSort(column.key as LadderSort)}
              className={clsx(
                'truncate border-r border-line px-2 py-2 text-left last:border-r-0',
                sortable && 'hover:text-ink',
                sort === column.key && 'text-accent',
                column.key === 'strike' && 'sticky left-0 z-20 bg-surface',
                column.key === 'distance' && 'sticky right-0 z-20 bg-surface',
              )}
            >
              {column.label}{sort === column.key && sort !== 'strike' ? ' ↓' : ''}
            </button>
          );
        })}
      </div>

      <div
        ref={containerRef}
        className="relative overflow-auto"
        style={{ height: viewportHeight }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="relative min-w-max" style={{ height: ordered.length * rowHeight, width: '100%' }}>
          {naturalOrder ? (
            <>
              {(() => {
                const high = levels.expected_move_high?.price;
                const low = levels.expected_move_low?.price;
                if (high == null || low == null) return null;
                const highPosition = positionForPrice(ordered, high);
                const lowPosition = positionForPrice(ordered, low);
                if (highPosition === null || lowPosition === null) return null;
                const top = Math.min(highPosition, lowPosition) * rowHeight;
                const height = Math.abs(lowPosition - highPosition) * rowHeight;
                return (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-0 border-y border-accent/10 bg-accent/[0.035]"
                    style={{ top, height }}
                    aria-hidden="true"
                  />
                );
              })()}
              {levelOverlays.map(({ key, meta, top }) => (
                <div
                  key={key}
                  className={clsx('pointer-events-none absolute inset-x-0 z-0 border-t border-dashed opacity-80', meta.className)}
                  style={{ top }}
                />
              ))}
              {(() => {
                const position = positionForPrice(ordered, spot);
                if (position === null) return null;
                return (
                  <>
                    <div
                      className="pointer-events-none absolute inset-x-0 z-0 border-t-2 border-accent"
                      style={{ top: position * rowHeight }}
                    />
                    <span
                      className="pointer-events-none absolute left-1 z-20 -translate-y-1/2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-black text-bg shadow"
                      style={{ top: position * rowHeight }}
                    >
                      SPOT {formatPrice(spot)}
                    </span>
                  </>
                );
              })()}
            </>
          ) : null}

          {visible.map((row, visibleIndex) => {
            const index = start + visibleIndex;
            return (
              <div
                key={row.strike}
                className="absolute left-0 right-0 z-10 grid border-b border-line/45 bg-bg/80 text-xs hover:bg-raised/90"
                style={{
                  height: rowHeight,
                  top: index * rowHeight,
                  gridTemplateColumns: template,
                }}
              >
                {columns.map((column) => {
                  let content: React.ReactNode;
                  if (column.key === 'strike') {
                    const rowLevelTags = levelTagsByRow.get(index) ?? [];
                    content = (
                      <div className="flex w-full items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(row.strike)}
                          className={favorites.includes(row.strike) ? 'text-warn' : 'text-faint hover:text-warn'}
                          aria-label={`${favorites.includes(row.strike) ? 'Remove' : 'Add'} favorite strike ${row.strike}`}
                        >
                          {favorites.includes(row.strike) ? '★' : '☆'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenRow(row)}
                          className="tnum text-sm font-bold text-ink hover:text-accent"
                        >
                          {formatPrice(row.strike, row.strike % 1 ? 2 : 0)}
                        </button>
                        {rowLevelTags.length ? (
                          <span
                            className="ml-auto flex flex-wrap justify-end gap-x-1 text-[9px] font-bold leading-tight"
                            title={rowLevelTags.map(({ meta, level }) => `${meta.short} ${formatPrice(level.price)}`).join('\n')}
                          >
                            {rowLevelTags.map(({ key, meta }) => (
                              <span key={key} className={meta.className.split(' ').at(-1)}>{meta.short}</span>
                            ))}
                          </span>
                        ) : null}
                      </div>
                    );
                  } else if (column.metric) {
                    const value = Number(row[column.metric]);
                    const [call, put] = contractSides(row, column.metric);
                    content = (
                      <ExposureBar
                        value={value}
                        max={maxByMetric.get(column.key) ?? 1}
                        raw={column.raw}
                        title={tooltip(row, column.label, value, call, put, column.metric, signConvention)}
                      />
                    );
                  } else if (column.key === 'call_put_oi') {
                    content = <SplitOiBar call={row.call_oi} put={row.put_oi} />;
                  } else if (column.key === 'call_oi') {
                    content = <span className="tnum text-exposurePos">{formatNumber(row.call_oi)}</span>;
                  } else if (column.key === 'put_oi') {
                    content = <span className="tnum text-exposureNeg">{formatNumber(row.put_oi)}</span>;
                  } else if (column.key === 'volume') {
                    content = <span className="tnum text-muted">{formatNumber(row.total_volume)}</span>;
                  } else if (column.key === 'distance') {
                    content = (
                      <span className={clsx('tnum font-semibold', row.distance_pct >= 0 ? 'text-exposurePos' : 'text-exposureNeg')}>
                        {formatPct(row.distance_pct, 2, true)}
                      </span>
                    );
                  } else {
                    content = null;
                  }
                  return (
                    <div
                      key={column.key}
                      className={clsx(
                        'flex min-w-0 items-center border-r border-line/40 px-2 last:border-r-0',
                        column.key === 'strike' && 'sticky left-0 z-10 bg-surface',
                        column.key === 'distance' && 'sticky right-0 z-10 bg-surface',
                      )}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-2xs text-faint">
        <span>{ordered.length} strikes · independent scale per exposure column</span>
        {!naturalOrder ? (
          <button type="button" onClick={() => onSort('strike')} className="text-accent hover:underline">
            Reset to Strike Ladder
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function StrikeDetailsDrawer({
  row,
  onClose,
}: {
  row: ExposureLadderRow | null;
  onClose: () => void;
}) {
  if (!row) return null;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/55" onMouseDown={onClose}>
      <aside
        className="h-full w-full max-w-3xl overflow-auto border-l border-line bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={`Strike ${row.strike} details`}
      >
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <div>
            <div className="stat-label">Strike details</div>
            <div className="tnum text-xl font-bold">{formatPrice(row.strike)}</div>
          </div>
          <button type="button" onClick={onClose} className="btn">Close</button>
        </header>
        <div className="grid grid-cols-2 gap-3 border-b border-line p-4 sm:grid-cols-4">
          <DrawerMetric label="Net GEX" value={formatExposureAuto(row.net_gamma)} />
          <DrawerMetric label="Dealer DEX*" value={formatExposureAuto(row.net_delta)} />
          <DrawerMetric label="Raw Contract DEX" value={formatExposureAuto(row.raw_net_delta)} />
          <DrawerMetric label="Net Vanna" value={formatExposureAuto(row.net_vanna)} />
          <DrawerMetric label="Net Charm" value={formatExposureAuto(row.net_charm)} />
        </div>
        <div className="overflow-x-auto p-4">
          <table className="grid-table min-w-[900px]">
            <thead>
              <tr><th>Expiry</th><th>C/P</th><th>DTE</th><th>OI</th><th>Volume</th><th>IV</th><th>Delta</th><th>Gamma</th><th>GEX</th><th>Dealer DEX*</th><th>Raw DEX</th><th>Vanna</th><th>Charm</th></tr>
            </thead>
            <tbody>
              {row.contracts.map((contract: LadderContract) => (
                <tr key={contract.symbol}>
                  <td>{contract.expiration}</td>
                  <td className={contract.type === 'call' ? 'text-exposurePos' : 'text-exposureNeg'}>{contract.type === 'call' ? 'C' : 'P'}</td>
                  <td className="tnum">{contract.dte.toFixed(1)}</td>
                  <td className="tnum">{formatNumber(contract.open_interest)}</td>
                  <td className="tnum">{formatNumber(contract.volume)}</td>
                  <td className="tnum">{formatIv(contract.iv)}</td>
                  <td className="tnum">{contract.delta?.toFixed(4) ?? '--'}</td>
                  <td className="tnum">{contract.gamma?.toFixed(6) ?? '--'}</td>
                  <td className="tnum">{formatExposureAuto(contract.gex)}</td>
                  <td className="tnum">{formatExposureAuto(contract.dex)}</td>
                  <td className="tnum">{formatExposureAuto(contract.raw_dex)}</td>
                  <td className="tnum">{formatExposureAuto(contract.vanna_exposure)}</td>
                  <td className="tnum">{formatExposureAuto(contract.charm_exposure)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  );
}

function DrawerMetric({ label, value }: { label: string; value: string }) {
  return <div><div className="stat-label">{label}</div><div className="tnum mt-1 font-semibold">{value}</div></div>;
}
