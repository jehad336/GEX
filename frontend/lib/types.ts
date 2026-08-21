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

export type ExpirationMode =
  | '0dte'
  | '1dte'
  | 'le7'
  | 'le30'
  | 'monthly'
  | 'all'
  | 'custom'
  | 'single'
  | 'multiple';

export interface LadderContract {
  symbol: string;
  expiration: string;
  dte: number;
  type: 'call' | 'put';
  strike: number;
  multiplier: number;
  open_interest: number;
  volume: number;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  gex: number;
  dex: number;
  raw_dex: number;
  vanna_exposure: number;
  charm_exposure: number;
}

export interface ExposureLadderRow {
  strike: number;
  distance: number;
  distance_pct: number;
  net_delta: number;
  call_delta: number;
  put_delta: number;
  raw_net_delta: number;
  raw_call_delta: number;
  raw_put_delta: number;
  net_gamma: number;
  call_gamma: number;
  put_gamma: number;
  net_vanna: number;
  call_vanna: number;
  put_vanna: number;
  net_charm: number;
  call_charm: number;
  put_charm: number;
  net_oi: number;
  total_oi: number;
  call_oi: number;
  put_oi: number;
  net_volume: number;
  total_volume: number;
  call_volume: number;
  put_volume: number;
  iv: number | null;
  absolute_gex: number;
  contracts: LadderContract[];
}

export interface ExposureSummary {
  net_gex: number;
  call_gex: number;
  put_gex: number;
  absolute_gex: number;
  net_dex: number;
  call_dex: number;
  put_dex: number;
  raw_net_dex: number;
  raw_call_dex: number;
  raw_put_dex: number;
  net_vanna: number;
  net_charm: number;
  total_oi: number;
  call_oi: number;
  put_oi: number;
  total_volume: number;
  call_volume: number;
  put_volume: number;
  put_call_oi_ratio: number | null;
  put_call_volume_ratio: number | null;
  contract_count: number;
}

export interface ExpirationContribution {
  expiration: string;
  dte: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  absolute_gex: number;
  total_oi: number;
  share_of_absolute: number;
}

export interface ExpirationChoice {
  expiration: string;
  dte: number;
  is_0dte: boolean;
  is_monthly: boolean;
  kind: string;
  selected: boolean;
}

export interface ExposureLadderResponse {
  symbol: string;
  spot: number;
  timestamp: string;
  provider: string;
  latency_ms: number;
  expiration_selection: {
    mode: ExpirationMode;
    selected: string[];
    available: ExpirationChoice[];
  };
  strike_range_pct: number | null;
  rows: ExposureLadderRow[];
  summary: ExposureSummary;
  dte0_summary: ExposureSummary;
  key_levels: Record<string, Level>;
  expected_move: ExpectedMove | null;
  gamma_condition: {
    label: string;
    gamma_regime: string;
    positioning: string;
    call_dominance_score: number;
    near_flip: boolean;
    flip_distance_pct: number | null;
    flip_proximity_warning: boolean;
    explanation: string;
    methodology: string;
  };
  expiration_contributions: ExpirationContribution[];
  freshness: {
    underlying: DelayStatus;
    quotes: DelayStatus;
    trades: DelayStatus;
    greeks_as_of: string | null;
    quote_as_of: string | null;
    trade_as_of: string | null;
    greeks_source: string;
    open_interest: DelayStatus;
    oi_as_of: string | null;
    excluded_contracts: number;
    note: string;
  };
  previous_close: number | null;
  day_open: number | null;
  sign_convention: string;
  methodology: Record<string, string>;
  disclaimer: string;
  demo_banner: DemoBanner | null;
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
