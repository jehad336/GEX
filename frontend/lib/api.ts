/**
 * API client. Every request goes to our own FastAPI backend - the browser never
 * holds a vendor key and never calls a market data provider directly.
 */

import type { DashboardSettings } from './types';
import demoFixtures from './demoFixtures.json';

export const STATIC_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider?: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
  provider?: string;
  detail?: { error?: string; message?: string; provider?: string } | string;
}

/** Turns a backend error into a message a trader can act on. */
function describe(status: number, body: ErrorBody | null): ApiError {
  const detail = typeof body?.detail === 'object' && body?.detail ? body.detail : undefined;
  const code = detail?.error ?? body?.error;
  const provider = detail?.provider ?? body?.provider;
  const raw =
    detail?.message ??
    body?.message ??
    (typeof body?.detail === 'string' ? body.detail : undefined);

  if (status === 429) {
    return new ApiError(
      `${provider ?? 'Provider'} rate limit reached. Requests are being throttled.`,
      status,
      provider,
      code,
    );
  }
  if (status === 502) {
    return new ApiError(
      raw ?? `${provider ?? 'Provider'} is unavailable.`,
      status,
      provider,
      code,
    );
  }
  return new ApiError(raw ?? `Request failed (${status}).`, status, provider, code);
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (STATIC_DEMO) return staticDemoResponse<T>(path);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      'Cannot reach the GEX backend. Is it running on ' + API_BASE + '?',
      0,
    );
  }

  if (!res.ok) {
    let body: ErrorBody | null = null;
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      body = null;
    }
    throw describe(res.status, body);
  }
  return (await res.json()) as T;
}

function staticDemoResponse<T>(path: string): T {
  const pathname = path.split('?', 1)[0] ?? path;
  const symbolMatch = pathname.match(/^\/api\/(?:gex|market|options|history)\/([^/]+)/);
  const requestedSymbol = symbolMatch?.[1]?.toUpperCase() ?? null;
  const fixturePath = requestedSymbol
    ? pathname.replace(`/${requestedSymbol}`, '/SPY')
    : pathname;
  const fixtures = demoFixtures as Record<string, unknown>;
  const source = fixtures[fixturePath]
    ?? (pathname === '/api/symbols/search' ? fixtures['/api/symbols/search'] : undefined);
  if (source === undefined) {
    throw new ApiError(`Demo fixture unavailable for ${pathname}`, 404, 'demo');
  }
  const cloned = JSON.parse(JSON.stringify(source)) as unknown;
  if (!requestedSymbol || requestedSymbol === 'SPY') return cloned as T;
  return replaceDemoSymbol(cloned, requestedSymbol) as T;
}

function replaceDemoSymbol(value: unknown, symbol: string): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceDemoSymbol(item, symbol));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === 'symbol' && item === 'SPY' ? symbol : replaceDemoSymbol(item, symbol),
      ]),
    );
  }
  return value;
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw describe(res.status, null);
  return (await res.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw describe(res.status, null);
}

/** Shared filter parameters, so every panel calculates over the same contracts. */
export function chainParams(settings: DashboardSettings): string {
  const p = new URLSearchParams();
  if (settings.maxDte !== null) p.set('max_dte', String(settings.maxDte));
  if (settings.strikeBandPct !== null) p.set('strike_band_pct', String(settings.strikeBandPct));
  if (!settings.include0dte) p.set('include_0dte', 'false');
  if (settings.convention) p.set('convention', settings.convention);
  if (settings.provider) p.set('provider', settings.provider);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function withParams(base: string, params: string, extra?: Record<string, string | number>) {
  if (!extra) return `${base}${params}`;
  const sep = params ? '&' : '?';
  const q = new URLSearchParams(
    Object.entries(extra).map(([k, v]) => [k, String(v)]),
  ).toString();
  return `${base}${params}${sep}${q}`;
}

export function wsUrl(symbol: string): string {
  const base = API_BASE.replace(/^http/, 'ws');
  return `${base}/ws/${encodeURIComponent(symbol)}`;
}
