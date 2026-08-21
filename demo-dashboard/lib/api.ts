import { demoDashboard } from "./demo";
import type { DashboardData } from "./types";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 429 ? "Provider rate limit reached" : `API returned ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getDashboard(symbol: string, signal?: AbortSignal): Promise<DashboardData> {
  if (DEMO) return demoDashboard(symbol);
  return json<DashboardData>(`/api/dashboard/${encodeURIComponent(symbol)}`, signal);
}

export async function searchSymbols(query: string, signal?: AbortSignal): Promise<string[]> {
  if (DEMO) return ["SPX", "SPY", "QQQ", "NDX", "IWM", "DIA", "AAPL", "NVDA", "TSLA", "AMD", "MSFT", "AMZN", "META"].filter(x => x.includes(query.toUpperCase())).slice(0, 7);
  const result = await json<{ symbols?: Array<string | { symbol: string }> } | Array<string | { symbol: string }>>(`/api/symbols/search?q=${encodeURIComponent(query)}`, signal);
  const rows = Array.isArray(result) ? result : (result.symbols ?? []);
  return rows.map(x => typeof x === "string" ? x : x.symbol);
}
