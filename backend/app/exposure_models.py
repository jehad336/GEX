"""Typed wire models for the Exposure Ladder screen."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel, Field

from app.models import DelayStatus, ExpectedMove, Level


class ExpirationMode(str, Enum):
    DTE0 = "0dte"
    DTE1 = "1dte"
    LE7 = "le7"
    LE30 = "le30"
    MONTHLY = "monthly"
    ALL = "all"
    CUSTOM = "custom"
    SINGLE = "single"
    MULTIPLE = "multiple"


class LadderContract(BaseModel):
    symbol: str
    expiration: date
    dte: float
    type: str
    strike: float
    multiplier: int
    open_interest: int
    volume: int
    bid: float | None = None
    ask: float | None = None
    iv: float | None = None
    delta: float | None = None
    gamma: float | None = None
    gex: float
    dex: float
    raw_dex: float
    vanna_exposure: float
    charm_exposure: float


class ExposureLadderRow(BaseModel):
    strike: float
    distance: float
    distance_pct: float
    net_delta: float
    call_delta: float
    put_delta: float
    raw_net_delta: float
    raw_call_delta: float
    raw_put_delta: float
    net_gamma: float
    call_gamma: float
    put_gamma: float
    net_vanna: float
    call_vanna: float
    put_vanna: float
    net_charm: float
    call_charm: float
    put_charm: float
    net_oi: int
    total_oi: int
    call_oi: int
    put_oi: int
    net_volume: int
    total_volume: int
    call_volume: int
    put_volume: int
    iv: float | None = None
    absolute_gex: float
    contracts: list[LadderContract] = Field(default_factory=list)


class ExposureSummary(BaseModel):
    net_gex: float
    call_gex: float
    put_gex: float
    absolute_gex: float
    net_dex: float
    call_dex: float
    put_dex: float
    raw_net_dex: float
    raw_call_dex: float
    raw_put_dex: float
    net_vanna: float
    net_charm: float
    total_oi: int
    call_oi: int
    put_oi: int
    total_volume: int
    call_volume: int
    put_volume: int
    put_call_oi_ratio: float | None = None
    put_call_volume_ratio: float | None = None
    contract_count: int


class ExpirationContribution(BaseModel):
    expiration: date
    dte: float
    call_gex: float
    put_gex: float
    net_gex: float
    absolute_gex: float
    total_oi: int
    share_of_absolute: float


class ExpirationChoice(BaseModel):
    expiration: date
    dte: float
    is_0dte: bool
    is_monthly: bool
    kind: str
    selected: bool


class ExpirationSelection(BaseModel):
    mode: ExpirationMode
    selected: list[date]
    available: list[ExpirationChoice]


class GammaCondition(BaseModel):
    label: str
    gamma_regime: str
    positioning: str
    call_dominance_score: float
    near_flip: bool
    flip_distance_pct: float | None = None
    flip_proximity_warning: bool = False
    explanation: str
    methodology: str


class LadderFreshness(BaseModel):
    underlying: DelayStatus
    quotes: DelayStatus
    trades: DelayStatus
    greeks_as_of: datetime | None = None
    quote_as_of: datetime | None = None
    trade_as_of: datetime | None = None
    greeks_source: str
    open_interest: DelayStatus = DelayStatus.PREVIOUS_DAY_OI
    oi_as_of: datetime | None = None
    excluded_contracts: int = 0
    note: str


class ExposureLadderResponse(BaseModel):
    symbol: str
    spot: float
    timestamp: datetime
    provider: str
    latency_ms: float
    expiration_selection: ExpirationSelection
    strike_range_pct: float | None
    rows: list[ExposureLadderRow]
    summary: ExposureSummary
    dte0_summary: ExposureSummary
    key_levels: dict[str, Level]
    expected_move: ExpectedMove | None = None
    gamma_condition: GammaCondition
    expiration_contributions: list[ExpirationContribution]
    freshness: LadderFreshness
    previous_close: float | None = None
    day_open: float | None = None
    sign_convention: str
    methodology: dict[str, str]
    disclaimer: str
    demo_banner: dict | None = None
