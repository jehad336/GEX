'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_GROUPS = [
  {
    label: 'Market intelligence',
    links: [
      { label: 'GEX Overview', short: 'OV', href: '/#market-overview' },
      { label: 'Price & Levels', short: 'PX', href: '/#chart' },
      { label: 'Gamma Profile', short: 'Γ', href: '/#gamma-profile' },
      { label: '0DTE Monitor', short: '0D', href: '/#zero-dte' },
      { label: 'Options Flow', short: 'FL', href: '/#flow' },
      { label: 'Volatility', short: 'σ', href: '/#volatility' },
    ],
  },
  {
    label: 'Decision tools',
    links: [
      { label: 'Opportunity Scanner', short: 'AI', href: '/#opportunities' },
      { label: 'Exposure Ladder', short: 'EX', href: '/exposure' },
      { label: 'Intraday History', short: 'HI', href: '/#history' },
      { label: 'Watchlist', short: 'WL', href: '/#watchlist' },
    ],
  },
] as const;

export function SidebarNav({ symbol }: { symbol: string }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 flex-col border-r border-line/80 bg-surface/95 shadow-[18px_0_40px_rgba(0,0,0,0.16)] backdrop-blur-xl xl:flex">
      <div className="flex h-[68px] items-center gap-3 border-b border-line/80 px-5">
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-accent/30 bg-gradient-to-br from-accent/25 to-exposurePos/10 text-base font-black text-accent shadow-[0_0_28px_rgba(96,165,250,0.16)]">
          Γ
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-tight text-ink">GEX Terminal</div>
          <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-faint">Options intelligence</div>
        </div>
      </div>

      <div className="border-b border-line/70 p-3">
        <div className="rounded-xl border border-line/80 bg-bg/55 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="stat-label">Active market</span>
            <span className="h-2 w-2 rounded-full bg-pos shadow-[0_0_10px_rgba(34,197,126,0.7)]" />
          </div>
          <div className="mt-2 flex items-end justify-between">
            <strong className="tnum text-xl text-ink">{symbol}</strong>
            <span className="rounded-md border border-accent/25 bg-accent/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-accent">Demo</span>
          </div>
        </div>
      </div>

      <nav className="no-scrollbar flex-1 space-y-5 overflow-y-auto px-3 py-5" aria-label="Workspace navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-faint">{group.label}</div>
            <div className="space-y-1">
              {group.links.map((link) => {
                const isExposure = link.href === '/exposure';
                const active = isExposure ? pathname === '/exposure' : pathname === '/' && link.href === '/#market-overview';
                const [path, hash] = link.href.split('#');
                const href = `${path || '/'}?symbol=${encodeURIComponent(symbol)}${hash ? `#${hash}` : ''}`;
                return (
                  <Link
                    key={link.href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'group flex min-h-10 items-center gap-3 rounded-xl px-2.5 text-xs font-medium transition',
                      active
                        ? 'bg-accent/15 text-accent shadow-[inset_3px_0_0_rgb(var(--accent))]'
                        : 'text-muted hover:bg-raised hover:text-ink',
                    )}
                  >
                    <span className={clsx(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-[9px] font-black tracking-tight transition',
                      active ? 'border-accent/30 bg-accent/10' : 'border-line bg-bg/45 text-faint group-hover:border-faint',
                    )}>
                      {link.short}
                    </span>
                    <span className="truncate">{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line/80 p-3">
        <div className="rounded-xl bg-gradient-to-br from-accent/12 to-exposurePos/5 p-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-accent">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-accent/15">✦</span>
            Model workspace
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-faint">Observed market data and clearly labelled model-derived exposure.</p>
        </div>
      </div>
    </aside>
  );
}

export function AnalysisTabs({ symbol }: { symbol: string }) {
  const tabs = [
    { label: 'Overview', href: '#market-overview' },
    { label: 'Gamma', href: '#gamma-profile' },
    { label: 'Vanna & Charm', href: '#zero-dte' },
    { label: 'Flow', href: '#flow' },
    { label: 'Volatility', href: '#volatility' },
  ];

  return (
    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-xl border border-line/80 bg-surface/80 p-1 shadow-sm" aria-label="Analysis views">
      {tabs.map((tab, index) => (
        <Link
          key={tab.href}
          href={`/?symbol=${encodeURIComponent(symbol)}${tab.href}`}
          className={clsx(
            'shrink-0 rounded-lg px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition sm:px-4 sm:text-[11px]',
            index === 0 ? 'bg-gradient-to-r from-accent to-exposurePos text-bg shadow-sm' : 'text-muted hover:bg-raised hover:text-ink',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
