"""Exposure Ladder aggregation.

Produces one row per strike carrying delta, gamma, vanna, charm, open interest
and volume exposure, plus the key levels drawn over the ladder.

THE AGGREGATION RULE THAT MATTERS
---------------------------------
Exposure is computed per contract and then summed. It is never derived by
averaging a greek across contracts and multiplying by aggregate open interest.
Those are not the same number: a strike holds contracts from many expirations
with different gammas, and an OI-weighted average silently reweights them.
`ChainArrays` -> `*_per_contract` -> group by strike is the only path used here.

Everything downstream of the sign convention is a model estimate. Open interest,
volume and IV are observed.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal

from app.core.config import get_settings
from app.models import (
    DataOrigin,
    ExpectedMove,
    Freshness,
    Level,
    StrikeGex,
)
from app.quant import gex_engine as engine
from app.quant import levels as lv
from app.quant import quality, volatility
from app.quant.rates import exercise_style, get_rate_provider
from app.services import analytics
from app.services.analytics import AnalyticsContext, ChainRequest

log = logging.getLogger("gex.exposure_ladder")

ExpirationMode = Literal[
    "0dte", "1dte", "weekly", "monthly", "all", "custom", "single"
]

# Preset expiration windows, in days to expiry.
EXPIRATION_MODES: dict[str, float | None] = {
    "0dte": 0.999,     # same session only
    "1dte": 1.999,
    "weekly": 7.0,
    "monthly": 35.0,
    "all": None,
    "custom": None,
    "single": None,
}

STRIKE_RANGE_PRESETS = [1.0, 2.0, 3.0, 5.0, 10.0]
DEFAULT_STRIKE_RANGE_PCT = 3.0


@dataclass
class LadderRequest:
    """Everything the screen can vary. Mirrors the query string one-to-one."""

    symbol: str
    expiration_mode: str = "all"
    expirations: list[date] | None = None
    max_dte: float | None = None
    strike_range_pct: float | None = DEFAULT_STRIKE_RANGE_PCT
    include_0dte: bool = True
    convention: str | None = None
    provider: str | None = None

    def resolved_max_dte(self) -> float | None:
        """An explicit max_dte wins; otherwise the mode supplies the window."""
        if self.max_dte is not None:
            return self.max_dte
        return EXPIRATION_MODES.get(self.expiration_mode)

    def to_chain_request(self) -> ChainRequest:
        # The strike band is applied after the levels are derived, so walls
        # outside a tight band are still found rather than filtered away first.
        return ChainRequest(
            symbol=self.symbol,
            max_dte=self.resolved_max_dte(),
            expirations=self.expirations,
            include_0dte=self.include_0dte if self.expiration_mode != "0dte" else True,
            convention=self.convention,
            provider=self.provider,
        )


def _distance(strike: float, spot: float) -> tuple[float, float]:
    return strike - spot, ((strike - spot) / spot * 100.0) if spot else 0.0


def _row(r: StrikeGex, spot: float) -> dict:
    distance, distance_pct = _distance(r.strike, spot)
    return {
        "strike": r.strike,
        "distance": round(distance, 4),
        "distancePercent": round(distance_pct, 4),
        # Signed exposures - model-derived under the active convention.
        "netDelta": r.net_dex,
        "netGamma": r.net_gex,
        "netVanna": r.net_vanna,
        "netCharm": r.net_charm,
        "callGamma": r.call_gex,
        "putGamma": r.put_gex,
        "callDelta": r.call_dex,
        "putDelta": r.put_dex,
        "callVanna": r.call_vanna,
        "putVanna": r.put_vanna,
        "callCharm": r.call_charm,
        "putCharm": r.put_charm,
        # Observed.
        "netOI": r.call_oi - r.put_oi,
        "callOI": r.call_oi,
        "putOI": r.put_oi,
        "totalOI": r.total_oi,
        "callVolume": r.call_volume,
        "putVolume": r.put_volume,
        "netVolume": r.call_volume - r.put_volume,
        "totalVolume": r.call_volume + r.put_volume,
        "callIv": r.call_iv,
        "putIv": r.put_iv,
        "contractCount": r.contract_count,
    }


def _level(level: Level | None) -> dict | None:
    if level is None or level.price is None:
        return None
    return {
        "label": level.label,
        "price": level.price,
        "distance": level.distance,
        "distancePercent": level.distance_pct,
        "gex": level.gex,
        "openInterest": level.open_interest,
        "volume": level.volume,
        "confidence": level.confidence,
        "origin": level.origin.value,
        "note": level.note,
    }


def _expected_move(em: ExpectedMove | None) -> dict | None:
    if em is None or em.move_abs is None:
        return None
    return {
        "expiration": em.expiration.isoformat(),
        "dte": round(em.dte, 3),
        "atmStrike": em.atm_strike,
        "straddle": em.straddle,
        "movePoints": em.move_abs,
        "movePercent": em.move_pct,
        "high": em.upper,
        "low": em.lower,
        "method": em.method,
    }


def _quartiles(rows: list[StrikeGex]) -> dict:
    """Open interest quartile thresholds, so the UI can shade concentration."""
    values = sorted(r.total_oi for r in rows if r.total_oi > 0)
    if not values:
        return {"q1": 0, "q2": 0, "q3": 0, "max": 0}
    at = lambda f: values[min(int(len(values) * f), len(values) - 1)]  # noqa: E731
    return {"q1": at(0.25), "q2": at(0.50), "q3": at(0.75), "max": values[-1]}


def _expiration_contributions(ctx: AnalyticsContext) -> list[dict]:
    rows = analytics.by_expiry_for(ctx)
    total_abs = sum(abs(r.call_gex) + abs(r.put_gex) for r in rows) or 1.0
    total_net = sum(abs(r.net_gex) for r in rows) or 1.0
    out = []
    for r in rows:
        absolute = abs(r.call_gex) + abs(r.put_gex)
        out.append({
            "expiration": r.expiration.isoformat(),
            "dte": round(r.dte, 3),
            "isZeroDte": r.dte < 1,
            "callGex": r.call_gex,
            "putGex": r.put_gex,
            "netGex": r.net_gex,
            "absoluteGex": absolute,
            "netShare": round(abs(r.net_gex) / total_net * 100.0, 3),
            "absoluteShare": round(absolute / total_abs * 100.0, 3),
            "totalOi": r.call_oi + r.put_oi,
            "totalVolume": r.call_volume + r.put_volume,
            "atmIv": r.atm_iv,
            "contractCount": r.contract_count,
        })
    return out


def build_ladder(req: LadderRequest, ctx: AnalyticsContext) -> dict:
    """Assemble the full screen payload from an already-built analytics context."""
    started = time.perf_counter()
    spot = ctx.spot
    settings = get_settings()
    rates = get_rate_provider()

    # ---- levels first, over the UNFILTERED strike set --------------------
    # A wall can sit outside a +/-1% band; finding it before narrowing keeps the
    # overlay honest instead of clamping it to the visible window.
    profile = analytics.profile_for(ctx)
    key_levels = analytics.levels_for(ctx, profile)
    em = volatility.expected_move(ctx.contracts, spot)
    totals = analytics.totals_for(ctx)
    dte0 = analytics.dte0_totals(ctx)

    prices, net_curve, _, _ = engine.gamma_profile(
        ctx.arrays, spot, ctx.convention,
        r=rates.rate(), q=rates.dividend_yield(req.symbol),
    )
    crossings = engine.find_zero_gamma_crossings(prices, net_curve)
    lower = [c for c in crossings if c <= spot]
    upper = [c for c in crossings if c > spot]

    # ---- rows, narrowed to the requested band ----------------------------
    all_rows = ctx.by_strike
    band = req.strike_range_pct
    visible = (
        [r for r in all_rows if abs((r.strike - spot) / spot * 100.0) <= band]
        if band and spot else all_rows
    )
    if not visible and all_rows:
        # Never return an empty ladder when the chain has strikes: widen to the
        # nearest ones rather than showing nothing.
        visible = sorted(all_rows, key=lambda r: abs(r.strike - spot))[:21]

    rows = sorted((_row(r, spot) for r in visible), key=lambda x: -x["strike"])

    dte0_contracts = engine.dte0_contracts(ctx.contracts)
    dte0_call_gex = dte0_put_gex = 0.0
    if dte0_contracts:
        arrays0 = engine.ChainArrays(dte0_contracts, settings.contract_multiplier_default)
        engine.fill_missing_greeks(arrays0, spot, rates.rate(),
                                   rates.dividend_yield(req.symbol))
        t0 = engine.compute_totals(arrays0, spot, ctx.convention)
        dte0_call_gex, dte0_put_gex = t0.call_gex, t0.put_gex

    condition = lv.classify_gamma_condition(
        call_gex=totals.call_gex, put_gex=totals.put_gex,
        call_oi=totals.call_oi, put_oi=totals.put_oi,
        call_volume=totals.call_volume, put_volume=totals.put_volume,
        dte0_call_gex=dte0_call_gex, dte0_put_gex=dte0_put_gex,
        net_gex=totals.net_gex, spot=spot, zero_gamma=profile.zero_gamma,
    )

    underlying = ctx.chain.underlying
    freshness = Freshness(
        status=quality.resolve_freshness(ctx.contracts),
        as_of=ctx.chain.freshness.as_of,
        source=ctx.provider_name,
        origin=DataOrigin.MODEL_DERIVED,
        note=ctx.chain.freshness.note,
    )
    oi_ts = next((c.oi_timestamp for c in ctx.contracts if c.oi_timestamp), None)

    return {
        "symbol": req.symbol.upper(),
        "spot": spot,
        "timestamp": datetime.now(UTC).isoformat(),
        "provider": ctx.provider_name,
        "latencyMs": round(ctx.elapsed_ms, 2),
        "calculationMs": round((time.perf_counter() - started) * 1000, 2),
        "signConvention": ctx.convention,
        "exerciseStyle": exercise_style(req.symbol),
        "rateSource": rates.source(),
        "riskFreeRate": rates.rate(),
        "dividendYield": rates.dividend_yield(req.symbol),

        "expirationSelection": {
            "mode": req.expiration_mode,
            "maxDte": req.resolved_max_dte(),
            "expirations": [e.isoformat() for e in (req.expirations or [])],
            "strikeRangePct": band,
            "include0dte": req.include_0dte,
            "contractsInScope": len(ctx.contracts),
            "strikesInScope": len(all_rows),
            "strikesVisible": len(rows),
        },

        "rows": rows,

        "summary": {
            "netGex": totals.net_gex,
            "callGex": totals.call_gex,
            "putGex": totals.put_gex,
            "absoluteGex": totals.absolute_gex,
            "netDex": totals.net_dex,
            "netVanna": totals.net_vanna,
            "netCharm": totals.net_charm,
            "totalOi": totals.call_oi + totals.put_oi,
            "callOi": totals.call_oi,
            "putOi": totals.put_oi,
            "callVolume": totals.call_volume,
            "putVolume": totals.put_volume,
            "putCallOiRatio": (totals.put_oi / totals.call_oi) if totals.call_oi else None,
            "putCallVolumeRatio": (
                totals.put_volume / totals.call_volume if totals.call_volume else None
            ),
            "contractCount": totals.contract_count,
        },

        "dte0": {
            "available": bool(dte0_contracts),
            "expiration": (
                min(c.expiration for c in dte0_contracts).isoformat()
                if dte0_contracts else None
            ),
            "netGex": dte0.net_gex,
            "callGex": dte0.call_gex,
            "putGex": dte0.put_gex,
            "callOi": dte0.call_oi,
            "putOi": dte0.put_oi,
            "callVolume": dte0.call_volume,
            "putVolume": dte0.put_volume,
            "shareOfAbsoluteGex": (
                round(dte0.absolute_gex / totals.absolute_gex * 100.0, 2)
                if totals.absolute_gex else None
            ),
        },

        "keyLevels": {
            "spot": spot,
            "gammaFlip": _level(key_levels.get("gamma_flip")),
            "callWall": _level(key_levels.get("call_wall")),
            "putWall": _level(key_levels.get("put_wall")),
            "largestCallGamma": _level(key_levels.get("largest_call_gamma")),
            "largestPutGamma": _level(key_levels.get("largest_put_gamma")),
            "largestCallOi": _level(key_levels.get("largest_call_oi")),
            "largestPutOi": _level(key_levels.get("largest_put_oi")),
            "expectedMoveHigh": em.upper if em else None,
            "expectedMoveLow": em.lower if em else None,
            "previousClose": underlying.previous_close,
            "dayOpen": underlying.open,
            "dayHigh": underlying.high,
            "dayLow": underlying.low,
            # Every crossing of the modelled profile, not just the central one.
            "lowerGammaTransition": max(lower) if lower else None,
            "upperGammaTransition": min(upper) if upper else None,
            "allGammaTransitions": crossings,
        },

        "expectedMove": _expected_move(em),
        "gammaCondition": condition,
        "expirationContributions": _expiration_contributions(ctx),
        "oiQuartiles": _quartiles(visible),

        "freshness": {
            "status": freshness.status.value,
            "asOf": freshness.as_of.isoformat() if freshness.as_of else None,
            "source": freshness.source,
            "note": freshness.note,
            "underlyingStatus": underlying.delay_status.value,
            "openInterestAsOf": oi_ts.isoformat() if oi_ts else None,
            "greeksAsOf": (
                ctx.chain.freshness.as_of.isoformat() if ctx.chain.freshness.as_of else None
            ),
        },
        "quality": ctx.quality,
        "disclaimer": analytics.MODEL_DISCLAIMER,
        "demoBanner": analytics.demo_banner(),
    }


async def get_ladder(req: LadderRequest) -> dict:
    ctx = await analytics.build_context(req.to_chain_request())
    return build_ladder(req, ctx)
