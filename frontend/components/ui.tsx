'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { FRESHNESS_META } from '@/lib/format';
import { GLOSSARY } from '@/lib/glossary';
import type { ApiError } from '@/lib/api';
import type { DelayStatus, QualityReport } from '@/lib/types';

/* ------------------------------------------------------------------ tooltip */

export function Info({ term, className }: { term: keyof typeof GLOSSARY; className?: string }) {
  const entry = GLOSSARY[term];
  if (!entry) return null;
  return (
    <span className={clsx('group relative inline-flex', className)}>
      <button
        type="button"
        aria-label={`What is ${entry.title}?`}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-faint/60 text-[9px] font-bold leading-none text-faint transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-72 -translate-x-1/2 rounded-md border border-line bg-raised p-3 text-xs leading-relaxed text-ink shadow-xl group-hover:block group-focus-within:block"
      >
        <span className="mb-1 block font-semibold">{entry.title}</span>
        <span className="block text-muted">{entry.body}</span>
        <span
          className={clsx(
            'mt-2 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
            entry.origin === 'observed'
              ? 'bg-pos/15 text-pos'
              : 'bg-warn/15 text-warn',
          )}
        >
          {entry.origin === 'observed' ? 'Observed data' : 'Model-derived'}
        </span>
      </span>
    </span>
  );
}

/** Plain-text hover for values that need their exact figure shown. */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex" title={text}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ panel */

export function Panel({
  title,
  term,
  right,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  term?: keyof typeof GLOSSARY;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('panel flex flex-col', className)}>
      <header className="panel-head">
        <div className="flex items-center gap-1.5">
          <h2 className="panel-title">{title}</h2>
          {term ? <Info term={term} /> : null}
        </div>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </header>
      <div className={clsx('min-h-0 flex-1', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ badges */

export function FreshnessBadge({
  status,
  asOf,
  className,
}: {
  status: DelayStatus;
  asOf?: string | null;
  className?: string;
}) {
  const meta = FRESHNESS_META[status] ?? FRESHNESS_META.UNKNOWN;
  return (
    <span
      className={clsx('chip', meta.className, className)}
      title={`${meta.help}${asOf ? `\nAs of: ${new Date(asOf).toLocaleString()}` : ''}`}
    >
      {meta.label}
    </span>
  );
}

export function OriginBadge({ origin }: { origin: 'observed' | 'model_derived' }) {
  return (
    <span
      className={clsx(
        'chip',
        origin === 'observed'
          ? 'border-pos/30 bg-pos/10 text-pos'
          : 'border-warn/30 bg-warn/10 text-warn',
      )}
      title={
        origin === 'observed'
          ? 'Reported by the exchange or the data provider.'
          : 'Calculated by this application from a model. Not an exchange-reported fact.'
      }
    >
      {origin === 'observed' ? 'Observed' : 'Model'}
    </span>
  );
}

/* ------------------------------------------------------------------ states */

export function LoadingBlock({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2" role="status" aria-label={label ?? 'Loading'}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-raised" />
      ))}
    </div>
  );
}

/**
 * Failure state. It shows the provider error and the last good update time -
 * and never substitutes placeholder numbers for data we do not have.
 */
export function ErrorBlock({
  error,
  onRetry,
  lastUpdated,
}: {
  error: ApiError | Error;
  onRetry?: () => void;
  lastUpdated?: string | null;
}) {
  const apiErr = error as ApiError;
  const isRateLimit = apiErr.status === 429;
  return (
    <div className="flex flex-col items-start gap-2 rounded border border-neg/30 bg-neg/5 p-4">
      <div className="flex items-center gap-2">
        <span className="chip border-neg/40 bg-neg/10 text-neg">
          {isRateLimit ? 'Rate limited' : 'Provider unavailable'}
        </span>
        {apiErr.provider ? (
          <span className="text-2xs uppercase tracking-wider text-faint">{apiErr.provider}</span>
        ) : null}
      </div>
      <p className="text-xs leading-relaxed text-muted">{error.message}</p>
      <p className="text-2xs text-faint">
        No substitute data is shown. The figures above are withheld rather than estimated.
      </p>
      {lastUpdated ? (
        <p className="text-2xs text-faint">
          Last successful update: {new Date(lastUpdated).toLocaleTimeString()}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn mt-1">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[80px] items-center justify-center px-4 text-center text-xs text-faint">
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ stats */

export function Stat({
  label,
  value,
  sub,
  tone,
  term,
  title,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
  term?: keyof typeof GLOSSARY;
  title?: string;
  className?: string;
}) {
  return (
    <div className={clsx('min-w-0', className)} title={title}>
      <div className="flex items-center gap-1">
        <span className="stat-label truncate">{label}</span>
        {term ? <Info term={term} /> : null}
      </div>
      <div className={clsx('tnum mt-0.5 truncate text-lg font-semibold leading-tight', tone)}>
        {value}
      </div>
      {sub ? <div className="tnum mt-0.5 truncate text-2xs text-faint">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ quality */

export function QualityIndicator({ quality }: { quality?: QualityReport }) {
  if (!quality || quality.issues.length === 0) return null;
  const errors = quality.issues.filter((i) => i.severity === 'error');
  const warnings = quality.issues.filter((i) => i.severity === 'warning');
  if (errors.length === 0 && warnings.length === 0) return null;

  const detail = quality.issues
    .map((i) => `${i.severity.toUpperCase()}: ${i.detail} (${i.count})`)
    .join('\n');

  return (
    <span
      className={clsx('chip', errors.length ? 'border-neg/40 bg-neg/10 text-neg' : 'border-warn/40 bg-warn/10 text-warn')}
      title={`Data quality on ${quality.checked} contracts, ${quality.dropped} dropped:\n\n${detail}`}
    >
      {errors.length ? `${errors.length} data errors` : `${warnings.length} data warnings`}
    </span>
  );
}

/* ------------------------------------------------------------------ toggles */

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = 'sm',
}: {
  options: { label: string; value: T; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'xs';
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-line">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={clsx(
            'border-r border-line font-medium transition-colors last:border-r-0',
            size === 'xs'
              ? 'min-h-7 px-2 py-1 text-2xs sm:min-h-0 sm:px-1.5 sm:py-0.5'
              : 'min-h-8 px-2 py-1 text-xs',
            opt.value === value
              ? 'bg-accent/15 text-accent'
              : 'bg-raised text-muted hover:text-ink',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
