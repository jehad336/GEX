import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'GEX Trading Dashboard',
  description:
    'Gamma exposure, dealer positioning estimates, options greeks and 0DTE analytics for US equity and index options.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#090b10',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint so the dashboard never
            flashes the wrong palette on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var raw = localStorage.getItem('gex.settings.v1');
                var theme = raw ? (JSON.parse(raw).theme || 'dark') : 'dark';
                if (theme === 'light') document.documentElement.classList.add('light');
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
