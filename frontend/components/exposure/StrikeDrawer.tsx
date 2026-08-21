'use client';

import { clsx } from 'clsx';
import { useEffect } from 'react';

import { chainParams } from '@/lib/api';
import {
  formatDateShort,
  formatExposureAuto,
  formatIv,
  formatNumber,
  formatPct,
  formatPrice,
} from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { DashboardSettings, LadderRow, OptionContract } from '@/lib/types';
import { ErrorBlock, LoadingBlock } from '@/components/ui';

interface ChainResponse {
  contracts: OptionContract[];
  spot: number;
}

/**
 * The contracts that make up one strike's exposure.
 *
 * Per-contract contributions are recomputed here for display only, using the
 * same formula the backend uses, so a trader can see how the row's total is
 * built. The row total itself always comes from the backend.
 */
export function StrikeDrawer({
  row,
  symbol,
  spot,
  settings,
  onClose,
}: {
  row: LadderRow | null;
  symbol: string;
  spot: number;
  settings: DashboardSettings;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const params = chainParams(settings);
  const { data, error, isLoading, mutate } = useApi<ChainResponse>(
    row ? `/api/options/${symbol}/chain${params}${params ? '&' : '?'}limit=2000` : null,
  );

  if (!row) return null;

  const atStrike = (data?.contracts ?? [])
    .filter((c) => c.strike === row.strike)
    .sort((a, b) => a.expiration.localeCompare(b.expiration) || a.type.localeCompare(b.type));

  const multiplierScale = (c: OptionContract) => (c.multiplier || 100) * spot;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label={`Contracts at strike ${row.strike}`}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-line bg-surface shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <div>
            <h2 className="tnum text-base font-bold">
              {symbol} {formatPrice(row.strike, row.strike % 1 === 0 ? 0 : 2)}
            </h2>
            <p className="tnum text-[11px] text-faint">
              {formatPct(row.distancePercent, 2, true)} from spot {formatPrice(spot)} ·{' '}
              {row.contractCount} contracts
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn ml-auto">
            Close
          </button>
        </header>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-b border-line p-4 sm:grid-cols-4">
          {(
            [
              ['Net Gamma', row.netGamma, row.callGamma, row.putGamma],
              ['Net Delta', row.netDelta, row.callDelta, row.putDelta],
              ['Net Vanna', row.netVanna, row.callVanna, row.putVanna],
              ['Net Charm', row.netCharm, row.callCharm, row.putCharm],
            ] as const
          ).map(([label, net, call, put]) => (
            <div key={label}>
              <div className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-faint">
                {label}
              </div>
              <div
                className={clsx(
                  'tnum mt-0.5 text-[15px] font-semibold',
                  net > 0 ? 'text-pos' : net < 0 ? 'text-neg' : 'text-muted',
                )}
              >
                {formatExposureAuto(net)}
              </div>
              <div className="tnum mt-0.5 text-[10px] text-faint">
                C {formatExposureAuto(call)} · P {formatExposureAuto(put)}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-b border-line p-4 sm:grid-cols-4">
          <Stat label="Call OI" value={formatNumber(row.callOI)} tone="text-pos" />
          <Stat label="Put OI" value={formatNumber(row.putOI)} tone="text-neg" />
          <Stat label="Call Volume" value={formatNumber(row.callVolume)} tone="text-pos" />
          <Stat label="Put Volume" value={formatNumber(row.putVolume)} tone="text-neg" />
        </div>

        <div className="p-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted">
            Contracts at this strike
          </h3>

          {isLoading && !data ? <LoadingBlock rows={6} /> : null}
          {error ? <ErrorBlock error={error} onRetry={() => mutate()} /> : null}

          {data && atStrike.length === 0 ? (
            <p className="text-xs text-faint">
              No contracts at this strike within the current expiration filter.
            </p>
          ) : null}

          {atStrike.length > 0 ? (
            <div className="overflow-x-auto rounded border border-line">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Expiry</th>
                    <th className="text-right">DTE</th>
                    <th>Type</th>
                    <th className="text-right">OI</th>
                    <th className="text-right">Vol</th>
                    <th className="text-right">IV</th>
                    <th className="text-right">Delta</th>
                    <th className="text-right">Gamma</th>
                    <th className="text-right">GEX</th>
                    <th className="text-right">DEX</th>
                  </tr>
                </thead>
                <tbody>
                  {atStrike.map((c) => {
                    const gex =
                      (c.gamma ?? 0) * c.open_interest * (c.multiplier || 100) * spot * spot * 0.01;
                    const dex = (c.delta ?? 0) * c.open_interest * multiplierScale(c);
                    return (
                      <tr key={c.symbol}>
                        <td className="text-muted">{formatDateShort(c.expiration)}</td>
                        <td className="tnum text-right text-faint">
                          {c.dte < 1 ? '0' : Math.round(c.dte)}
                        </td>
                        <td className={c.type === 'call' ? 'font-semibold text-pos' : 'font-semibold text-neg'}>
                          {c.type === 'call' ? 'CALL' : 'PUT'}
                        </td>
                        <td className="tnum text-right">{formatNumber(c.open_interest)}</td>
                        <td className="tnum text-right text-muted">{formatNumber(c.volume)}</td>
                        <td className="tnum text-right text-muted">{formatIv(c.iv)}</td>
                        <td className="tnum text-right text-muted">
                          {c.delta == null ? '–' : c.delta.toFixed(3)}
                        </td>
                        <td className="tnum text-right text-muted">
                          {c.gamma == null ? '–' : c.gamma.toFixed(5)}
                        </td>
                        <td className="tnum text-right">{formatExposureAuto(gex)}</td>
                        <td className="tnum text-right text-muted">{formatExposureAuto(dex)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <p className="mt-3 text-[10px] leading-relaxed text-faint">
            Per-contract GEX and DEX are shown unsigned here, before the dealer sign convention
            is applied, so the arithmetic behind the row total is visible. The signed row totals
            above come from the backend engine.
          </p>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className={clsx('tnum mt-0.5 text-[15px] font-semibold', tone)}>{value}</div>
    </div>
  );
}
