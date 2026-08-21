export type Freshness = "LIVE" | "DELAYED 15M" | "EOD" | "PREVIOUS DAY OI" | "STALE" | "DEMO DATA";

export interface GexStrike { strike: number; callGex: number; putGex: number; netGex: number; callOi: number; putOi: number; callVolume: number; putVolume: number }
export interface ProfilePoint { price: number; netGex: number }
export interface Candle { time: string; open: number; high: number; low: number; close: number; volume: number; vwap?: number }
export interface DashboardData {
  symbol: string;
  provider: string;
  isDemo: boolean;
  freshness: Freshness;
  updatedAt: string;
  marketStatus: string;
  spot: number;
  previousClose: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  dayVolume: number;
  netGex: number;
  callGex: number;
  putGex: number;
  regime: "POSITIVE GAMMA" | "NEGATIVE GAMMA" | "NEAR FLIP";
  gammaFlip: number;
  callWall: number;
  putWall: number;
  expectedMove: number;
  zeroDteGex: number;
  zeroDteCallGex: number;
  zeroDtePutGex: number;
  putCallVolume: number;
  putCallOi: number;
  atmIv: number;
  byStrike: GexStrike[];
  profile: ProfilePoint[];
  candles: Candle[];
  zeroDte: { largestCallGamma: number; largestPutGamma: number; largestCallOi: number; largestPutOi: number; callVolume: number; putVolume: number };
}
