import type { DashboardData } from "./types";

function seeded(symbol: string) { return [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0); }

export function demoDashboard(symbol: string): DashboardData {
  const seed = seeded(symbol);
  const base: Record<string, number> = { SPX: 5942.47, SPY: 594.31, QQQ: 522.84, IWM: 224.18, NVDA: 137.49, TSLA: 411.05, AAPL: 242.62 };
  const spot = base[symbol] ?? 80 + (seed % 370);
  const step = spot > 1000 ? 25 : spot > 300 ? 5 : 2.5;
  const center = Math.round(spot / step) * step;
  const byStrike = Array.from({ length: 19 }, (_, i) => {
    const strike = center + (i - 9) * step;
    const d = (strike - spot) / step;
    const callGex = (0.45 + Math.max(0, 9 - Math.abs(d)) / 7) * 1e9 * (1 + Math.sin(i * 1.8) * .28);
    const putGex = -(0.35 + Math.max(0, 8 - Math.abs(d + 1)) / 8) * 1e9 * (1 + Math.cos(i * 1.45) * .25);
    return { strike, callGex, putGex, netGex: callGex + putGex, callOi: 12000 + (i * 1927) % 31000, putOi: 9000 + (i * 2521) % 35000, callVolume: 1800 + (i * 773) % 8200, putVolume: 1500 + (i * 619) % 7500 };
  });
  const callWall = center + step * 4, putWall = center - step * 4, gammaFlip = center - step * .55;
  const profile = Array.from({ length: 41 }, (_, i) => {
    const price = spot * (.9 + i * .005);
    return { price, netGex: ((price - gammaFlip) / (spot * .01)) * 1.15e9 + Math.sin(i / 3) * .18e9 };
  });
  const candles = Array.from({ length: 48 }, (_, i) => {
    const drift = (i - 30) * spot * .00018, wave = Math.sin(i / 3.5) * spot * .0024;
    const close = spot + drift + wave; const open = close - Math.sin(i * 1.7) * spot * .0012;
    return { time: new Date(Date.now() - (47 - i) * 5 * 60_000).toISOString(), open, close, high: Math.max(open, close) + spot * .0011, low: Math.min(open, close) - spot * .001, volume: 220000 + (i * 83117) % 780000, vwap: spot + drift * .45 };
  });
  const callGex = byStrike.reduce((s, x) => s + x.callGex, 0), putGex = byStrike.reduce((s, x) => s + x.putGex, 0);
  return { symbol, provider: "Local fixture", isDemo: true, freshness: "DEMO DATA", updatedAt: new Date().toISOString(), marketStatus: "Closed", spot, previousClose: spot * .9947, dayOpen: spot * .997, dayHigh: spot * 1.006, dayLow: spot * .991, dayVolume: 48_240_000, netGex: callGex + putGex, callGex, putGex, regime: spot > gammaFlip ? "POSITIVE GAMMA" : "NEGATIVE GAMMA", gammaFlip, callWall, putWall, expectedMove: spot * .0118, zeroDteGex: 2.18e9, zeroDteCallGex: 5.32e9, zeroDtePutGex: -3.14e9, putCallVolume: .84, putCallOi: 1.06, atmIv: .214, byStrike, profile, candles, zeroDte: { largestCallGamma: callWall, largestPutGamma: putWall, largestCallOi: center + step * 2, largestPutOi: center - step * 3, callVolume: 128420, putVolume: 109710 } };
}
