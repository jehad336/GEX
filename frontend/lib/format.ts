/** Display formatting. Exposure figures are huge, so readability is a feature. */

import type { DelayStatus, GexUnit } from './types';

const UNIT_DIVISOR: Record<GexUnit, number> = {
  raw: 1,
  thousands: 1e3,
  millions: 1e6,
  billions: 1e9,
};

const UNIT_SUFFIX: Record<GexUnit, string> = {
  raw: '',
  thousands: 'K',
  millions: 'M',
  billions: 'B',
};

/** Compact currency: 4_530_000_000 -> "$4.53B". Full value goes in the tooltip. */
export function formatExposure(value: number | null | undefined, unit: GexUnit = 'billions'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (unit === 'raw') return formatUsd(value, 0);

  const divided = value / UNIT_DIVISOR[unit];
  const sign = divided < 0 ? '-' : '';
  const abs = Math.abs(divided);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${sign}$${abs.toFixed(decimals)}${UNIT_SUFFIX[unit]}`;
}

/** Auto-scaled variant for axis ticks, where a fixed unit wastes space. */
export function formatExposureAuto(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatUsd(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPrice(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPct(value: number | null | undefined, decimals = 2, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** IV arrives as a decimal (0.185); traders read vol points (18.5%). */
export function formatIv(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatSignedPrice(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(decimals)}`;
}

export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return value.toFixed(2);
}

export function formatDte(dte: number | null | undefined): string {
  if (dte === null || dte === undefined) return '--';
  if (dte < 1) return '0DTE';
  return `${Math.round(dte)}D`;
}

export function formatTime(iso: string | null | undefined, tz: 'America/New_York' | 'local' = 'America/New_York'): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(tz === 'America/New_York' ? { timeZone: 'America/New_York' } : {}),
  });
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function secondsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 1000);
}

/** Freshness badges. DEMO is never styled to look like LIVE. */
export const FRESHNESS_META: Record<
  DelayStatus,
  { label: string; className: string; help: string }
> = {
  LIVE: {
    label: 'LIVE',
    className: 'border-pos/40 bg-pos/10 text-pos',
    help: 'Real-time data, confirmed by the provider entitlement.',
  },
  DELAYED_15M: {
    label: 'DELAYED 15M',
    className: 'border-warn/40 bg-warn/10 text-warn',
    help: 'The provider plan supplies 15-minute delayed data.',
  },
  EOD: {
    label: 'EOD',
    className: 'border-faint/40 bg-raised text-muted',
    help: 'End-of-day values, not intraday.',
  },
  PREVIOUS_DAY_OI: {
    label: 'PREV DAY OI',
    className: 'border-faint/40 bg-raised text-muted',
    help: 'Open interest as of the previous reporting session.',
  },
  STALE: {
    label: 'STALE',
    className: 'border-neg/40 bg-neg/10 text-neg',
    help: 'The last update is older than expected. Treat with caution.',
  },
  DEMO: {
    label: 'DEMO DATA',
    className: 'border-accent/50 bg-accent/15 text-accent',
    help: 'Synthetic data generated locally. This is NOT market data.',
  },
  UNKNOWN: {
    label: 'UNKNOWN',
    className: 'border-faint/40 bg-raised text-faint',
    help: 'The provider did not state a delay status.',
  },
};

export function toneForValue(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'text-muted';
  return value > 0 ? 'text-pos' : 'text-neg';
}

export function regimeTone(regime: string | undefined): string {
  if (!regime) return 'border-faint/40 bg-raised text-muted';
  if (regime.includes('POSITIVE')) return 'border-pos/40 bg-pos/10 text-pos';
  if (regime.includes('NEGATIVE')) return 'border-neg/40 bg-neg/10 text-neg';
  return 'border-warn/40 bg-warn/10 text-warn';
}
