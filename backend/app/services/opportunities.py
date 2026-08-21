"""Explainable, in-app option-contract opportunity scanner.

This scanner records analytical candidates, never orders.  It uses one coherent
normalized snapshot, requires quoted/liquid contracts, exposes every scoring
component, and de-duplicates repeated snapshots so the log does not become spam.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal

from app.models import GexSnapshot, OptionContract, OptionType
from app.services.analytics import AnalyticsContext

Direction = Literal["call", "put"]


@dataclass
class OpportunityRecord:
    id: int
    symbol: str
    option_symbol: str
    setup: str
    direction: Direction
    score: int
    detected_at: datetime
    spot: float
    strike: float
    expiration: str
    dte: float
    bid: float | None
    ask: float | None
    mid: float | None
    iv: float | None
    delta: float | None
    gamma: float | None
    open_interest: int
    volume: int
    provider: str
    freshness: str
    sign_convention: str
    gamma_flip: float | None
    target_level: float | None
    trigger: str
    invalidation: str
    reasons: list[str] = field(default_factory=list)
    score_components: dict[str, int] = field(default_factory=dict)
    demo: bool = False
    status: str = "analytical_candidate"
    disclaimer: str = (
        "Model-derived analytical candidate; not investment advice and not an order. "
        "Verify price, liquidity, risk and entitlement before any decision."
    )

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["detected_at"] = self.detected_at.isoformat()
        return payload


def _quoted(contract: OptionContract) -> bool:
    return (
        contract.bid is not None
        and contract.ask is not None
        and contract.ask >= contract.bid >= 0
        and (contract.mid or (contract.bid + contract.ask) / 2) > 0
    )


def _contract_score(
    contract: OptionContract,
    candidates: list[OptionContract],
    target: float,
) -> tuple[int, dict[str, int]]:
    max_oi = max((row.open_interest for row in candidates), default=1)
    max_volume = max((row.volume for row in candidates), default=1)
    mid = contract.mid or ((contract.bid or 0) + (contract.ask or 0)) / 2
    spread_pct = (
        ((contract.ask or mid) - (contract.bid or mid)) / mid * 100 if mid > 0 else 100
    )
    liquidity = round(10 * contract.open_interest / max(max_oi, 1))
    activity = round(10 * contract.volume / max(max_volume, 1))
    quote = 15 if spread_pct <= 5 else 11 if spread_pct <= 10 else 6 if spread_pct <= 20 else 0
    delta_abs = abs(contract.delta or 0)
    delta_fit = 10 if 0.30 <= delta_abs <= 0.60 else 6 if 0.20 <= delta_abs <= 0.70 else 1
    target_fit = max(0, round(10 * (1 - min(abs(contract.strike - target) / max(target, 1) / 0.03, 1))))
    parts = {
        "liquidity": liquidity,
        "activity": activity,
        "quote_quality": quote,
        "delta_fit": delta_fit,
        "strike_fit": target_fit,
    }
    return sum(parts.values()), parts


class OpportunityScanner:
    def __init__(self, max_records: int = 200, cooldown_minutes: int = 15):
        self.records: list[OpportunityRecord] = []
        self.max_records = max_records
        self.cooldown = timedelta(minutes=cooldown_minutes)
        self._next_id = 1
        self.last_scan_at: dict[str, datetime] = {}

    def _recent_duplicate(self, symbol: str, option_symbol: str, setup: str) -> bool:
        cutoff = datetime.now(UTC) - self.cooldown
        return any(
            row.symbol == symbol
            and row.option_symbol == option_symbol
            and row.setup == setup
            and row.detected_at >= cutoff
            for row in self.records
        )

    def evaluate(
        self, snapshot: GexSnapshot, ctx: AnalyticsContext
    ) -> list[OpportunityRecord]:
        now = datetime.now(UTC)
        self.last_scan_at[snapshot.symbol] = now
        flip = getattr(snapshot.levels.get("gamma_flip"), "price", None)
        call_wall = getattr(snapshot.levels.get("call_wall"), "price", None)
        put_wall = getattr(snapshot.levels.get("put_wall"), "price", None)
        spot = snapshot.spot
        if not spot or flip is None:
            return []

        negative_gamma = snapshot.totals.net_gex < 0
        direction: Direction
        setup: str
        target: float
        structural = 0
        reasons: list[str] = []

        if negative_gamma:
            direction = "call" if spot > flip else "put"
            setup = "negative_gamma_acceleration"
            target = (call_wall if direction == "call" else put_wall) or spot
            structural = 35
            reasons.append("Negative dealer-gamma estimate can amplify hedging flow.")
            reasons.append(
                f"Spot is {'above' if direction == 'call' else 'below'} the nearest gamma flip."
            )
        else:
            call_distance = abs(spot - call_wall) / spot * 100 if call_wall else 999.0
            put_distance = abs(spot - put_wall) / spot * 100 if put_wall else 999.0
            nearest = min(call_distance, put_distance)
            if nearest > 1.0:
                return []
            direction = "put" if call_distance <= put_distance else "call"
            setup = "positive_gamma_wall_reversion"
            target = spot
            structural = 32
            wall_name = "call-wall heuristic" if direction == "put" else "put-wall heuristic"
            reasons.append("Positive dealer-gamma estimate favours a mean-reversion watch setup.")
            reasons.append(f"Spot is within 1% of the {wall_name}.")

        desired_type = OptionType.CALL if direction == "call" else OptionType.PUT
        candidates = [
            contract
            for contract in ctx.contracts
            if contract.type == desired_type
            and 0.75 <= contract.dte <= 7.5
            and abs(contract.strike - spot) / spot <= 0.05
            and contract.open_interest > 0
            and _quoted(contract)
        ]
        if not candidates:
            return []

        ranked: list[tuple[int, dict[str, int], OptionContract]] = []
        for contract in candidates:
            contract_points, parts = _contract_score(contract, candidates, target)
            ranked.append((structural + contract_points, parts, contract))
        score, components, contract = max(ranked, key=lambda item: item[0])
        score = min(score, 100)
        if score < 65 or self._recent_duplicate(snapshot.symbol, contract.symbol, setup):
            return []

        components = {"market_structure": structural, **components}
        record = OpportunityRecord(
            id=self._next_id,
            symbol=snapshot.symbol,
            option_symbol=contract.symbol,
            setup=setup,
            direction=direction,
            score=score,
            detected_at=now,
            spot=spot,
            strike=contract.strike,
            expiration=contract.expiration.isoformat(),
            dte=contract.dte,
            bid=contract.bid,
            ask=contract.ask,
            mid=contract.mid,
            iv=contract.iv,
            delta=contract.delta,
            gamma=contract.gamma,
            open_interest=contract.open_interest,
            volume=contract.volume,
            provider=ctx.provider_name,
            freshness=snapshot.freshness.status.value,
            sign_convention=snapshot.sign_convention,
            gamma_flip=flip,
            target_level=target,
            trigger=(
                f"Watch {direction.upper()} only while the {setup.replace('_', ' ')} conditions remain true."
            ),
            invalidation=(
                f"Invalidate if spot crosses back {'below' if direction == 'call' else 'above'} "
                f"the gamma flip at {flip:,.2f}, or if quote/liquidity becomes stale."
            ),
            reasons=reasons,
            score_components=components,
            demo=ctx.provider_name == "demo",
        )
        self._next_id += 1
        self.records.insert(0, record)
        del self.records[self.max_records :]
        return [record]

    def for_symbol(self, symbol: str) -> list[OpportunityRecord]:
        return [row for row in self.records if row.symbol == symbol.upper()]


_scanner: OpportunityScanner | None = None


def get_opportunity_scanner() -> OpportunityScanner:
    global _scanner
    if _scanner is None:
        _scanner = OpportunityScanner()
    return _scanner
