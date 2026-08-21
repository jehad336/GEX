/** Mirrors the backend's normalized schema. The UI never sees a vendor payload. */

export type DelayStatus =
  | 'LIVE'
  | 'DELAYED_15M'
  | 'EOD'
  | 'PREVIOUS_DAY_OI'
  | 'STALE'
  | 'DEMO'
  | 'UNKNOWN';

export type DataOrigin = 'observed' | 'model_derived';

export interface Freshness {
  status: DelayStatus;
  as_of: string | null;
  source: string;
  origin: DataOrigin;
  note: string | null;
}

export interface DemoBanner {
  demo: boolean;
  message: string;
  delay_status: string;
}

export interface Level {
  label: string;
  price: number | null;
  distance: number | null;
  distance_pct: number | null;
  gex: number | null;
  open_interest: number | null;
  volume: number | null;
  dte: number | null;
  confidence: string | null;
  origin: DataOrigin;
  note: string | null;
}

export interface GexTotals {
  call_gex: number;
  put_gex: number;
  net_gex: number;
  absolute_gex: number;
  call_dex: number;
  put_dex: number;
  net_dex: number;
  net_vanna: number;
  net_charm: number;
  call_oi: number;
  put_oi: number;
  call_volume: number;
  put_volume: number;
  contract_count: number;
}

export interface StrikeGex {
  strike: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  call_oi: number;
  put_oi: number;
  total_oi: number;
  call_volume: number;
  put_volume: number;
  call_dex: number;
  put_dex: number;
  net_dex: number;
  net_vanna: number;
  net_charm: number;
  call_vgex: number;
  put_vgex: number;
}

export interface ExpiryGex {
  expiration: string;
  dte: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  call_oi: number;
  put_oi: number;
  call_volume: number;
  put_volume: number;
  net_dex: number;
  atm_iv: number | null;
  contract_count: number;
}

export interface RegimeAssessment {
  regime: string;
  net_gex: number;
  zero_gamma: number | null;
  distance_to_flip_pct: number | null;
  dte0_net_gex: number;
  explanation: string;
}

export interface PutCallRatios {
  volume_ratio: number | null;
  oi_ratio: number | null;
  call_volume: number;
  put_volume: number;
  call_oi: number;
  put_oi: number;
}

export interface ExpectedMove {
  expiration: string;
  dte: number;
  atm_strike: number;
  call_price: number | null;
  put_price: number | null;
  straddle: number | null;
  move_abs: number | null;
  move_pct: number | null;
  upper: number | null;
  lower: number | null;
  method: string;
}

export interface QualityIssue {
  code: string;
  detail: string;
  count: number;
  severity: 'info' | 'warning' | 'error';
}

export interface QualityReport {
  ok: boolean;
  checked: number;
  dropped: number;
  issues: QualityIssue[];
}

export interface GexSnapshot {
  symbol: string;
  spot: number;
  totals: GexTotals;
  dte0: GexTotals;
  levels: Record<string, Level>;
  regime: RegimeAssessment;
  ratios: PutCallRatios;
  expected_move: ExpectedMove | null;
  atm_iv: number | null;
  freshness: Freshness;
  provider: string;
  computed_at: string;
  calculation_ms: number;
  sign_convention: string;
  quality: QualityReport;
  disclaimer: string;
  demo_banner: DemoBanner | null;
}

export interface Underlying {
  symbol: string;
  price: number;
  previous_close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  vwap: number | null;
  change: number | null;
  change_pct: number | null;
  timestamp: string | null;
  source: string;
  delay_status: DelayStatus;
}

export interface OptionContract {
  symbol: string;
  underlying: string;
  expiration: string;
  dte: number;
  strike: number;
  type: 'call' | 'put';
  multiplier: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  volume: number;
  open_interest: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  underlying_price: number | null;
  quote_timestamp: string | null;
  trade_timestamp: string | null;
  oi_timestamp: string | null;
  source: string;
  delay_status: DelayStatus;
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vwap: number | null;
}

export interface ProfilePoint {
  price: number;
  net_gex: number;
  call_gex: number;
  put_gex: number;
}

export interface GammaProfileResponse {
  symbol: string;
  points: ProfilePoint[];
  spot: number;
  zero_gamma: number | null;
  regime: string;
  call_wall: Level;
  put_wall: Level;
  gamma_flip: Level;
  method: string;
}

export interface Concentration {
  band_pct: number;
  net_gex: number;
  absolute_gex: number;
  share_of_absolute: number;
}

export interface PinRisk {
  level: 'Low' | 'Medium' | 'High';
  score: number;
  nearest_strike: number | null;
  distance_pct: number | null;
  explanation: string;
}

export interface LevelsResponse {
  symbol: string;
  spot: number;
  levels: Record<string, Level>;
  top_gamma: { positive: Level[]; negative: Level[] };
  concentration: Concentration[];
  pin_risk: PinRisk;
  regime: RegimeAssessment;
}

export interface HeatmapCell {
  x: number;
  y: number;
  value: number;
  strike: number;
  expiration: string;
  dte: number;
  call_oi: number;
  put_oi: number;
  call_volume: number;
  put_volume: number;
  net_dex: number;
}

export interface HeatmapResponse {
  symbol: string;
  spot: number;
  metric: string;
  expirations: string[];
  strikes: number[];
  cells: HeatmapCell[];
}

export interface Dte0Response {
  symbol: string;
  spot: number;
  available: boolean;
  reason?: string;
  expiration?: string;
  dte?: number;
  totals?: GexTotals;
  by_strike?: StrikeGex[];
  ratios?: PutCallRatios;
  key_strikes?: Record<string, Level>;
  expected_move?: ExpectedMove | null;
  share_of_total_gex?: number;
}

export interface OptionTradeRow {
  timestamp: string;
  option_symbol: string;
  underlying: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  dte: number;
  price: number;
  size: number;
  multiplier: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  underlying_price: number | null;
  aggressor: string;
  premium: number;
}

export interface FlowResponse {
  symbol: string;
  available: boolean;
  reason?: string;
  provider?: string;
  summary?: {
    count: number;
    total_premium: number;
    call_premium: number;
    put_premium: number;
    by_aggressor: Record<string, number>;
    tiers: Record<string, number>;
  };
  premium_tiers?: number[];
  trades: OptionTradeRow[];
  note?: string;
}

export interface IvResponse {
  symbol: string;
  spot: number;
  atm_iv: number | null;
  call_atm_iv: number | null;
  put_atm_iv: number | null;
  iv_25d_put: number | null;
  iv_25d_call: number | null;
  risk_reversal_25d: number | null;
  skew_points: { strike: number; moneyness: number; delta: number | null; iv: number; type: string }[];
  term_structure: { expiration: string; dte: number; atm_iv: number }[];
  historical: Record<string, unknown> | null;
  historical_note?: string;
}

export interface OiResponse {
  symbol: string;
  spot: number;
  call_oi: number;
  put_oi: number;
  total_oi: number;
  put_call_oi_ratio: number | null;
  by_strike: { strike: number; call_oi: number; put_oi: number; total_oi: number }[];
  by_expiry: { expiration: string; dte: number; call_oi: number; put_oi: number }[];
  largest_call_oi: Level;
  largest_put_oi: Level;
  oi_as_of: string | null;
  oi_note: string;
  change: {
    available: boolean;
    reason?: string;
    previous_session?: string;
    call_oi_change?: number;
    put_oi_change?: number;
    net_oi_change?: number;
    additions?: number;
    reductions?: number;
  };
}

export interface VolumeResponse {
  symbol: string;
  spot: number;
  call_volume: number;
  put_volume: number;
  total_volume: number;
  put_call_volume_ratio: number | null;
  by_strike: {
    strike: number;
    call_volume: number;
    put_volume: number;
    total_volume: number;
    total_oi: number;
    volume_oi_ratio: number | null;
  }[];
  unusual: {
    strike: number;
    expiration: string;
    dte: number;
    type: string;
    volume: number;
    open_interest: number;
    volume_oi_ratio: number;
  }[];
}

export interface WatchlistRow {
  symbol: string;
  ok: boolean;
  error?: string;
  spot?: number;
  net_gex?: number;
  regime?: string;
  gamma_flip?: number | null;
  gamma_flip_distance_pct?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  dte0_net_gex?: number;
  atm_iv?: number | null;
}

export interface HistoryPoint {
  captured_at: string;
  spot: number;
  net_gex: number;
  call_gex: number;
  put_gex: number;
  dte0_net_gex: number;
  net_dex: number;
  gamma_flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  regime: string | null;
  atm_iv: number | null;
}

export interface OpportunityRecord {
  id: number;
  symbol: string;
  option_symbol: string;
  setup: string;
  direction: 'call' | 'put';
  score: number;
  detected_at: string;
  spot: number;
  strike: number;
  expiration: string;
  dte: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  open_interest: number;
  volume: number;
  provider: string;
  freshness: DelayStatus;
  sign_convention: string;
  gamma_flip: number | null;
  target_level: number | null;
  trigger: string;
  invalidation: string;
  reasons: string[];
  score_components: Record<string, number>;
  demo: boolean;
  status: 'analytical_candidate';
  disclaimer: string;
}

export interface OpportunityResponse {
  symbol: string;
  scanning: boolean;
  last_scan_at: string | null;
  created: OpportunityRecord[];
  records: OpportunityRecord[];
  minimum_score: number;
  cooldown_minutes: number;
  provider: string;
  demo: boolean;
  delivery: string;
}

export interface MarketStatus {
  state: 'PRE_MARKET' | 'OPEN' | 'AFTER_HOURS' | 'CLOSED';
  timezone: string;
  local_time: string;
  utc_time: string;
  note: string;
}

export interface ProvidersResponse {
  active: string;
  configured: string;
  fallback: string;
  demo_mode: boolean;
  providers: {
    name: string;
    available: boolean;
    authenticated: boolean;
    realtime_entitled: boolean;
    latency_ms: number | null;
    message: string | null;
  }[];
  orats_enabled: boolean;
  demo_banner: DemoBanner | null;
}

export type GexUnit = 'raw' | 'thousands' | 'millions' | 'billions';

export interface DashboardSettings {
  provider: string | null;
  refreshSeconds: number;
  convention: string;
  maxDte: number | null;
  strikeBandPct: number | null;
  include0dte: boolean;
  units: GexUnit;
  theme: 'dark' | 'light';
  timezone: 'America/New_York' | 'local';
}

/* ------------------------------------------------------------------ ladder */

export interface LadderRow {
  strike: number;
  distance: number;
  distancePercent: number;
  netDelta: number;
  netGamma: number;
  netVanna: number;
  netCharm: number;
  callGamma: number;
  putGamma: number;
  callDelta: number;
  putDelta: number;
  callVanna: number;
  putVanna: number;
  callCharm: number;
  putCharm: number;
  netOI: number;
  callOI: number;
  putOI: number;
  totalOI: number;
  callVolume: number;
  putVolume: number;
  netVolume: number;
  totalVolume: number;
  callIv: number | null;
  putIv: number | null;
  contractCount: number;
}

export interface LadderLevel {
  label: string;
  price: number;
  distance: number | null;
  distancePercent: number | null;
  gex: number | null;
  openInterest: number | null;
  volume: number | null;
  confidence: string | null;
  origin: DataOrigin;
  note: string | null;
}

export interface LadderKeyLevels {
  spot: number;
  gammaFlip: LadderLevel | null;
  callWall: LadderLevel | null;
  putWall: LadderLevel | null;
  largestCallGamma: LadderLevel | null;
  largestPutGamma: LadderLevel | null;
  largestCallOi: LadderLevel | null;
  largestPutOi: LadderLevel | null;
  expectedMoveHigh: number | null;
  expectedMoveLow: number | null;
  previousClose: number | null;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  lowerGammaTransition: number | null;
  upperGammaTransition: number | null;
  allGammaTransitions: number[];
}

export interface GammaCondition {
  positioning: 'CALL DOMINATED' | 'PUT DOMINATED' | 'BALANCED';
  regime: string;
  score: number;
  components: Record<string, number>;
  weights: Record<string, number>;
  balanced_band: number;
  distance_to_flip_pct: number | null;
  explanation: string;
}

export interface ExpirationContribution {
  expiration: string;
  dte: number;
  isZeroDte: boolean;
  callGex: number;
  putGex: number;
  netGex: number;
  absoluteGex: number;
  netShare: number;
  absoluteShare: number;
  totalOi: number;
  totalVolume: number;
  atmIv: number | null;
  contractCount: number;
}

export interface LadderResponse {
  symbol: string;
  spot: number;
  timestamp: string;
  provider: string;
  latencyMs: number;
  calculationMs: number;
  signConvention: string;
  exerciseStyle: string;
  rateSource: string;
  riskFreeRate: number;
  dividendYield: number;
  expirationSelection: {
    mode: string;
    maxDte: number | null;
    expirations: string[];
    strikeRangePct: number | null;
    include0dte: boolean;
    contractsInScope: number;
    strikesInScope: number;
    strikesVisible: number;
  };
  rows: LadderRow[];
  summary: {
    netGex: number;
    callGex: number;
    putGex: number;
    absoluteGex: number;
    netDex: number;
    netVanna: number;
    netCharm: number;
    totalOi: number;
    callOi: number;
    putOi: number;
    callVolume: number;
    putVolume: number;
    putCallOiRatio: number | null;
    putCallVolumeRatio: number | null;
    contractCount: number;
  };
  dte0: {
    available: boolean;
    expiration: string | null;
    netGex: number;
    callGex: number;
    putGex: number;
    callOi: number;
    putOi: number;
    callVolume: number;
    putVolume: number;
    shareOfAbsoluteGex: number | null;
  };
  keyLevels: LadderKeyLevels;
  expectedMove: {
    expiration: string;
    dte: number;
    atmStrike: number;
    straddle: number | null;
    movePoints: number | null;
    movePercent: number | null;
    high: number | null;
    low: number | null;
    method: string;
  } | null;
  gammaCondition: GammaCondition;
  expirationContributions: ExpirationContribution[];
  oiQuartiles: { q1: number; q2: number; q3: number; max: number };
  freshness: {
    status: DelayStatus;
    asOf: string | null;
    source: string;
    note: string | null;
    underlyingStatus: DelayStatus;
    openInterestAsOf: string | null;
    greeksAsOf: string | null;
  };
  quality: QualityReport;
  disclaimer: string;
  demoBanner: DemoBanner | null;
}

export type LadderMetric = 'gex' | 'dex' | 'vanna' | 'charm' | 'oi' | 'volume' | 'all';
export type LadderView = 'compact' | 'advanced';
export type ExpirationMode = '0dte' | '1dte' | 'weekly' | 'monthly' | 'all' | 'single' | 'custom';
