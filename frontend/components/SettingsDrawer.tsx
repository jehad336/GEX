'use client';

import { clsx } from 'clsx';
import { useEffect, useState } from 'react';

import { apiGet } from '@/lib/api';
import type { DashboardSettings, GexUnit, ProvidersResponse } from '@/lib/types';
import { SegmentedControl } from './ui';

const DTE_PRESETS: { label: string; value: number | null }[] = [
  { label: 'All', value: null },
  { label: '0DTE', value: 0.999 },
  { label: '≤1D', value: 1.999 },
  { label: '≤7D', value: 7 },
  { label: '≤30D', value: 30 },
  { label: '≤60D', value: 60 },
];

const STRIKE_PRESETS: { label: string; value: number | null }[] = [
  { label: '±2%', value: 0.02 },
  { label: '±5%', value: 0.05 },
  { label: '±10%', value: 0.1 },
  { label: 'All', value: null },
];

const CONVENTIONS = [
  {
    value: 'calls_positive_puts_negative',
    label: 'Calls + / Puts −',
    help: 'Standard heuristic: dealers assumed short calls, long puts.',
  },
  {
    value: 'all_positive',
    label: 'All positive',
    help: 'Magnitude view — every contract contributes positively.',
  },
  {
    value: 'put_positive_call_negative',
    label: 'Puts + / Calls −',
    help: 'Inverse assumption, for books dominated by call overwriting.',
  },
];

export function SettingsDrawer({
  open,
  onClose,
  settings,
  update,
}: {
  open: boolean;
  onClose: () => void;
  settings: DashboardSettings;
  update: (patch: Partial<DashboardSettings>) => void;
}) {
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [customDte, setCustomDte] = useState('');

  useEffect(() => {
    if (!open) return;
    apiGet<ProvidersResponse>('/api/providers')
      .then(setProviders)
      .catch(() => setProviders(null));
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Dashboard settings"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface shadow-2xl"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <h2 className="text-sm font-bold">Settings</h2>
          <button type="button" onClick={onClose} className="btn">
            Close
          </button>
        </header>

        <div className="space-y-6 p-4">
          <Field
            label="Data provider"
            help="Server-side selection. API keys never reach the browser; a provider with no key configured is not offered."
          >
            <SegmentedControl
              value={settings.provider ?? 'default'}
              onChange={(v) => update({ provider: v === 'default' ? null : String(v) })}
              options={[
                { label: 'Configured default', value: 'default' },
                ...(providers?.providers ?? []).map((p) => ({
                  label: p.name,
                  value: p.name,
                  title: p.message ?? undefined,
                })),
              ]}
            />
            {providers ? (
              <ul className="mt-2 space-y-1">
                {providers.providers.map((p) => (
                  <li key={p.name} className="flex items-center justify-between text-2xs">
                    <span className="uppercase tracking-wider text-muted">{p.name}</span>
                    <span className={p.available ? 'text-pos' : 'text-neg'}>
                      {p.available ? 'available' : 'unavailable'}
                      {p.realtime_entitled ? ' · realtime' : ''}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between text-2xs">
                  <span className="uppercase tracking-wider text-muted">orats</span>
                  <span className={providers.orats_enabled ? 'text-pos' : 'text-faint'}>
                    {providers.orats_enabled ? 'enabled' : 'not configured (optional)'}
                  </span>
                </li>
              </ul>
            ) : null}
          </Field>

          <Field label="Refresh interval" help="How often panels re-poll the backend.">
            <SegmentedControl
              value={settings.refreshSeconds}
              onChange={(v) => update({ refreshSeconds: Number(v) })}
              options={[
                { label: '10s', value: 10 },
                { label: '30s', value: 30 },
                { label: '60s', value: 60 },
                { label: '5m', value: 300 },
              ]}
            />
          </Field>

          <Field
            label="GEX sign convention"
            help="Dealer inventory is unobservable, so the sign is an assumption. Changing it flips the interpretation of every exposure figure."
          >
            <div className="space-y-1.5">
              {CONVENTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => update({ convention: c.value })}
                  className={clsx(
                    'w-full rounded border px-3 py-2 text-left transition-colors',
                    settings.convention === c.value
                      ? 'border-accent/60 bg-accent/10'
                      : 'border-line bg-raised hover:border-faint',
                  )}
                >
                  <div className="text-xs font-semibold">{c.label}</div>
                  <div className="mt-0.5 text-2xs text-faint">{c.help}</div>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Expirations included" help="Filters every panel to the same contract set.">
            <SegmentedControl
              value={settings.maxDte ?? 'all'}
              onChange={(v) => {
                update({ maxDte: v === 'all' ? null : Number(v) });
                setCustomDte('');
              }}
              options={DTE_PRESETS.map((p) => ({
                label: p.label,
                value: p.value === null ? 'all' : p.value,
              }))}
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                value={customDte}
                onChange={(e) => setCustomDte(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Custom max DTE"
                className="w-32 rounded border border-line bg-raised px-2 py-1 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                className="btn"
                onClick={() => customDte && update({ maxDte: Number(customDte) })}
              >
                Apply
              </button>
            </div>
          </Field>

          <Field label="Strike range" help="Strikes kept within this band of spot.">
            <SegmentedControl
              value={settings.strikeBandPct ?? 'all'}
              onChange={(v) => update({ strikeBandPct: v === 'all' ? null : Number(v) })}
              options={STRIKE_PRESETS.map((p) => ({
                label: p.label,
                value: p.value === null ? 'all' : p.value,
              }))}
            />
          </Field>

          <Field label="0DTE contracts">
            <SegmentedControl
              value={settings.include0dte ? 'yes' : 'no'}
              onChange={(v) => update({ include0dte: v === 'yes' })}
              options={[
                { label: 'Include', value: 'yes' },
                { label: 'Exclude', value: 'no' },
              ]}
            />
          </Field>

          <Field label="Exposure units" help="Full precision is always available on hover.">
            <SegmentedControl
              value={settings.units}
              onChange={(v) => update({ units: v as GexUnit })}
              options={[
                { label: 'Raw', value: 'raw' },
                { label: 'K', value: 'thousands' },
                { label: 'M', value: 'millions' },
                { label: 'B', value: 'billions' },
              ]}
            />
          </Field>

          <Field label="Theme">
            <SegmentedControl
              value={settings.theme}
              onChange={(v) => update({ theme: v as 'dark' | 'light' })}
              options={[
                { label: 'Dark', value: 'dark' },
                { label: 'Light', value: 'light' },
              ]}
            />
          </Field>

          <Field label="Timezone">
            <SegmentedControl
              value={settings.timezone}
              onChange={(v) => update({ timezone: v as DashboardSettings['timezone'] })}
              options={[
                { label: 'New York', value: 'America/New_York' },
                { label: 'Local', value: 'local' },
              ]}
            />
          </Field>
        </div>
      </aside>
    </>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-ink">{label}</div>
      {help ? <p className="mb-2 text-2xs leading-relaxed text-faint">{help}</p> : null}
      {children}
    </div>
  );
}
