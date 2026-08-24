'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Screen-level navigation.
 *
 * Routes that are not built yet are listed as `ready: false` and rendered
 * disabled rather than omitted, so the nav reflects the intended shape of the
 * app without offering a link that dead-ends.
 */
export const SCREENS = [
  { href: '/', label: 'GEX Dashboard', ready: true },
  { href: '/exposure', label: 'Exposure Ladder', ready: true },
  { href: '/#gamma-profile', label: 'Gamma Profile', ready: true },
  { href: '/#zero-dte', label: '0DTE', ready: true },
  { href: '/#flow', label: 'Options Flow', ready: true },
  { href: '/#volatility', label: 'Volatility', ready: true },
  { href: '/#history', label: 'History', ready: true },
] as const;

export function MainNav({ className, symbol }: { className?: string; symbol?: string }) {
  const pathname = usePathname();

  return (
    <nav className={clsx('flex items-center gap-0.5', className)} aria-label="Screens">
      {SCREENS.map((s) => {
        // Hash targets live on the dashboard; only the path decides "current".
        const target = s.href.split('#')[0] || '/';
        const active = pathname === target && (target !== '/' || !s.href.includes('#'));
        const [path, hash] = s.href.split('#');
        const href = symbol
          ? `${path || '/'}?symbol=${encodeURIComponent(symbol)}${hash ? `#${hash}` : ''}`
          : s.href;
        return (
          <Link
            key={s.href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-accent/15 text-accent'
                : 'text-muted hover:bg-raised hover:text-ink',
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
