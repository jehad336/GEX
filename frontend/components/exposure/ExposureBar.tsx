'use client';

import { clsx } from 'clsx';

import { formatExposureAuto, formatNumber } from '@/lib/format';

export function ExposureBar({
  value,
  max,
  raw = false,
  title,
}: {
  value: number;
  max: number;
  raw?: boolean;
  title: string;
}) {
  const width = max > 0 ? Math.min(50, (Math.abs(value) / max) * 50) : 0;
  const positive = value >= 0;
  const formatted = raw
    ? `${value > 0 ? '+' : ''}${formatNumber(value)}`
    : formatExposureAuto(value);

  return (
    <div className="relative h-7 min-w-[112px] overflow-hidden rounded-sm bg-raised/45" title={title}>
      <span className="absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden="true" />
      <span
        className={clsx(
          'absolute inset-y-1 rounded-sm opacity-65',
          positive ? 'left-1/2 bg-exposurePos' : 'right-1/2 bg-exposureNeg',
        )}
        style={{ width: `${width}%` }}
        aria-hidden="true"
      />
      <span
        className={clsx(
          'tnum relative z-10 flex h-full items-center gap-1 px-1.5 text-xs font-semibold',
          positive ? 'justify-end text-exposurePos' : 'justify-start text-exposureNeg',
        )}
      >
        <span aria-hidden="true" className="text-[8px]">{positive ? '▲' : '▼'}</span>
        {formatted}
      </span>
      <span className="sr-only">{positive ? 'Positive' : 'Negative'} {title}: {formatted}</span>
    </div>
  );
}

export function SplitOiBar({ call, put }: { call: number; put: number }) {
  const max = Math.max(call, put, 1);
  return (
    <div className="space-y-0.5" title={`Call OI: ${formatNumber(call)}\nPut OI: ${formatNumber(put)}`}>
      <div className="flex items-center gap-1">
        <span className="tnum w-14 text-right text-[9px] text-exposurePos">{formatNumber(call)}</span>
        <span className="h-1.5 rounded-sm bg-exposurePos/70" style={{ width: `${(call / max) * 34}px` }} />
      </div>
      <div className="flex items-center gap-1">
        <span className="tnum w-14 text-right text-[9px] text-exposureNeg">{formatNumber(put)}</span>
        <span className="h-1.5 rounded-sm bg-exposureNeg/70" style={{ width: `${(put / max) * 34}px` }} />
      </div>
    </div>
  );
}
