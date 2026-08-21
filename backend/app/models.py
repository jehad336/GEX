"""Internal normalized schema.

Nothing downstream of a provider adapter may see a vendor-shaped payload. Every
adapter converts to these models; the quant engine and the API only speak these.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class OptionType(str, Enum):
    CALL = "call"
    PUT = "put"


class DelayStatus(str, Enum):
    """How fresh a piece of data actually is. Never claim LIVE without entitlement."""

    LIVE = "LIVE"
    DELAYED_15M = "DELAYED_15M"
    EOD = "EOD"
    PREVIOUS_DAY_OI = "PREVIOUS_DAY_OI"
    STALE = "STALE"
    DEMO = "DEMO"
    UNKNOWN = "UNKNOWN"


class DataOrigin(str, Enum):
    """Separates exchange-reported facts from things this app modelled."""

    OBSERVED = "observed"
    MODEL_DERIVED = "model_derived"


class Freshness(BaseModel):
    status: DelayStatus = DelayStatus.UNKNOWN
    as_of: datetime | None = None
    source: str = "unknown"
    origin: DataOrigin = DataOrigin.OBSERVED
    note: str | None = None


class OptionContract(BaseModel):
    """OptionContractNormalized."""

    symbol: str                       # OCC-style contract symbol
    underlying: str
    expiration: date
    dte: float                        # calendar days to expiry, fractional
    strike: float
    type: OptionType
    multiplier: int = 100

    bid: float | None = None
    ask: float | None = None
    mid: float | None = None
    last: float | None = None

    volume: int = 0
    open_interest: int = 0

    iv: float | None = None
    delta: float | None = None
    gamma: float | None = None
    theta: float | None = None
    vega: float | None = None

    underlying_price: float | None = None
    quote_timestamp: datetime | None = None
    trade_timestamp: datetime | None = None
    oi_timestamp: datetime | None = None

    source: str = "unknown"
    delay_status: DelayStatus = DelayStatus.UNKNOWN

    @property
    def is_call(self) -> bool:
        return self.type == OptionType.CALL


class Underlying(BaseModel):
    symbol: str
    price: float
    previous_close: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    volume: int | None = None
    vwap: float | None = None
    change: float | None = None
    change_pct: float | None = None
    timestamp: datetime | None = None
    source: str = "unknown"
    delay_status: DelayStatus = DelayStatus.UNKNOWN


class Bar(BaseModel):
    t: datetime
    o: float
    h: float
    l: float
    c: float
    v: float = 0
    vwap: float | None = None


class OptionTrade(BaseModel):
    timestamp: datetime
    option_symbol: str
    underlying: str
    type: OptionType
    strike: float
    expiration: date
    dte: float
    price: float
    size: int
    multiplier: int = 100
    bid: float | None = None
    ask: float | None = None
    mid: float | None = None
    underlying_price: float | None = None
    # at_bid | below_mid | at_mid | above_mid | at_ask | unknown
    aggressor: str = "unknown"

    @property
    def premium(self) -> float:
        return self.price * self.size * self.multiplier


class OptionChain(BaseModel):
    underlying: Underlying
    contracts: list[OptionContract]
    freshness: Freshness
    provider: str


class ProviderStatus(BaseModel):
    name: str
    available: bool
    authenticated: bool
    realtime_entitled: bool = False
    latency_ms: float | None = None
    message: str | None = None
    checked_at: datetime | None = None


# ---------------------------------------------------------------- analytics


class StrikeGex(BaseModel):
    strike: float
    call_gex: float
    put_gex: float
    net_gex: float
    call_oi: int
    put_oi: int
    total_oi: int
    call_volume: int
    put_volume: int
    call_dex: float = 0.0
    put_dex: float = 0.0
    net_dex: float = 0.0
    net_vanna: float = 0.0
    net_charm: float = 0.0
    call_vgex: float = 0.0
    put_vgex: float = 0.0


class ExpiryGex(BaseModel):
    expiration: date
    dte: float
    call_gex: float
    put_gex: float
    net_gex: float
    call_oi: int
    put_oi: int
    call_volume: int
    put_volume: int
    net_dex: float = 0.0
    atm_iv: float | None = None
    contract_count: int = 0


class GexTotals(BaseModel):
    call_gex: float
    put_gex: float
    net_gex: float
    absolute_gex: float
    call_dex: float = 0.0
    put_dex: float = 0.0
    net_dex: float = 0.0
    net_vanna: float = 0.0
    net_charm: float = 0.0
    call_oi: int = 0
    put_oi: int = 0
    call_volume: int = 0
    put_volume: int = 0
    contract_count: int = 0


class Level(BaseModel):
    """A price level plus its distance from spot - always shipped together."""

    label: str
    price: float | None = None
    distance: float | None = None
    distance_pct: float | None = None
    gex: float | None = None
    open_interest: int | None = None
    volume: int | None = None
    dte: float | None = None
    confidence: str | None = None
    origin: DataOrigin = DataOrigin.MODEL_DERIVED
    note: str | None = None


class ProfilePoint(BaseModel):
    price: float
    net_gex: float
    call_gex: float
    put_gex: float


class GammaProfile(BaseModel):
    points: list[ProfilePoint]
    spot: float
    zero_gamma: float | None = None
    regime: str = "unknown"
    method: str = "black_scholes_reprice"


class ExpectedMove(BaseModel):
    expiration: date
    dte: float
    atm_strike: float
    call_price: float | None = None
    put_price: float | None = None
    straddle: float | None = None
    move_abs: float | None = None
    move_pct: float | None = None
    upper: float | None = None
    lower: float | None = None
    method: str = "atm_straddle"


class Concentration(BaseModel):
    band_pct: float
    net_gex: float
    absolute_gex: float
    share_of_absolute: float


class PinRisk(BaseModel):
    level: Literal["Low", "Medium", "High"] = "Low"
    score: float = 0.0
    nearest_strike: float | None = None
    distance_pct: float | None = None
    explanation: str = ""


class RegimeAssessment(BaseModel):
    regime: str
    net_gex: float
    zero_gamma: float | None = None
    distance_to_flip_pct: float | None = None
    dte0_net_gex: float = 0.0
    explanation: str = ""


class PutCallRatios(BaseModel):
    volume_ratio: float | None = None
    oi_ratio: float | None = None
    call_volume: int = 0
    put_volume: int = 0
    call_oi: int = 0
    put_oi: int = 0


class IvSummary(BaseModel):
    atm_iv: float | None = None
    call_atm_iv: float | None = None
    put_atm_iv: float | None = None
    iv_25d_put: float | None = None
    iv_25d_call: float | None = None
    risk_reversal_25d: float | None = None
    skew_points: list[dict] = Field(default_factory=list)
    term_structure: list[dict] = Field(default_factory=list)


class GexSnapshot(BaseModel):
    """Everything the dashboard header needs, in one payload."""

    symbol: str
    spot: float
    totals: GexTotals
    dte0: GexTotals
    levels: dict[str, Level]
    regime: RegimeAssessment
    ratios: PutCallRatios
    expected_move: ExpectedMove | None = None
    atm_iv: float | None = None
    freshness: Freshness
    provider: str
    computed_at: datetime
    calculation_ms: float = 0.0
    sign_convention: str = "calls_positive_puts_negative"
