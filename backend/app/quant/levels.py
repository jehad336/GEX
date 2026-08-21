"""Derivation of the traded levels: Call Wall, Put Wall, Gamma Flip, pin risk, regime.

Every output of this module is MODEL-DERIVED. None of it is reported by an
exchange. The scoring rules below are deliberately explicit and inspectable
rather than fitted, so a trader can reason about why a level moved.
"""

from __future__ import annotations

from typing import Literal, cast

import numpy as np

from app.models import (
    Concentration,
    DataOrigin,
    Level,
    PinRisk,
    PutCallRatios,
    RegimeAssessment,
    StrikeGex,
)


def _distance(price: float | None, spot: float) -> tuple[float | None, float | None]:
    if price is None or not spot:
        return None, None
    d = price - spot
    return d, (d / spot) * 100.0


def make_level(label: str, price: float | None, spot: float, **kw) -> Level:
    d, dpct = _distance(price, spot)
    return Level(label=label, price=price, distance=d, distance_pct=dpct, **kw)


# ------------------------------------------------------------------ walls

# Weighting of the wall score. Gamma dominates, OI corroborates, and a proximity
# term stops a far-out-of-the-money leftover from outranking a strike in play.
W_GEX = 0.55
W_OI = 0.25
W_PROXIMITY = 0.20


def _normalise(values: np.ndarray) -> np.ndarray:
    peak = np.max(np.abs(values)) if values.size else 0.0
    return np.abs(values) / peak if peak > 0 else np.zeros_like(values)


def _proximity_weight(strikes: np.ndarray, spot: float, decay_pct: float = 5.0) -> np.ndarray:
    """Gaussian decay in percentage distance from spot."""
    if not spot:
        return np.ones_like(strikes)
    rel = (strikes - spot) / spot * 100.0
    return np.exp(-0.5 * (rel / decay_pct) ** 2)


def _wall(
    by_strike: list[StrikeGex],
    spot: float,
    side: str,
    dte0_by_strike: dict[float, float] | None = None,
) -> Level:
    """Score every candidate strike, return the winner.

    side="call": strikes above spot, ranked on call gamma + call OI.
    side="put":  strikes below spot, ranked on put gamma + put OI.
    """
    label = "Call Wall" if side == "call" else "Put Wall"
    if not by_strike or not spot:
        return make_level(label, None, spot, note="insufficient chain data")

    candidates = [s for s in by_strike if (s.strike > spot if side == "call" else s.strike < spot)]
    if not candidates:
        return make_level(label, None, spot, note="no strikes on this side of spot")

    strikes = np.array([s.strike for s in candidates])
    gex = np.array([s.call_gex if side == "call" else s.put_gex for s in candidates])
    oi = np.array(
        [s.call_oi if side == "call" else s.put_oi for s in candidates], dtype=float
    )

    score = (
        W_GEX * _normalise(gex) + W_OI * _normalise(oi)
    ) * (W_PROXIMITY + (1 - W_PROXIMITY) * _proximity_weight(strikes, spot))

    # A heavy same-day concentration at a strike pulls the wall toward it: 0DTE
    # gamma is what actually pins price into the close.
    if dte0_by_strike:
        boost = np.array([abs(dte0_by_strike.get(float(k), 0.0)) for k in strikes])
        score = score * (1.0 + 0.35 * _normalise(boost))

    if not np.any(score > 0):
        return make_level(label, None, spot, note="no gamma concentration found")

    best = int(np.argmax(score))
    win = candidates[best]
    top = float(score[best])
    runner = float(np.sort(score)[-2]) if score.size > 1 else 0.0
    # A wall only means something if it stands out from its neighbours.
    margin = (top - runner) / top if top > 0 else 0.0
    confidence = "high" if margin > 0.25 else "medium" if margin > 0.08 else "low"

    return make_level(
        label,
        win.strike,
        spot,
        gex=win.call_gex if side == "call" else win.put_gex,
        open_interest=win.call_oi if side == "call" else win.put_oi,
        volume=win.call_volume if side == "call" else win.put_volume,
        confidence=confidence,
        note=(
            f"score = {W_GEX:.2f}*gamma + {W_OI:.2f}*OI, "
            "weighted by distance from spot and 0DTE concentration"
        ),
    )


def call_wall(by_strike, spot, dte0_by_strike=None) -> Level:
    return _wall(by_strike, spot, "call", dte0_by_strike)


def put_wall(by_strike, spot, dte0_by_strike=None) -> Level:
    return _wall(by_strike, spot, "put", dte0_by_strike)


# ------------------------------------------------------------------ top strikes


def top_gamma_strikes(
    by_strike: list[StrikeGex], spot: float, n: int = 5
) -> dict[str, list[Level]]:
    positive = sorted([s for s in by_strike if s.net_gex > 0], key=lambda s: -s.net_gex)[:n]
    negative = sorted([s for s in by_strike if s.net_gex < 0], key=lambda s: s.net_gex)[:n]

    def to_levels(rows: list[StrikeGex], tag: str) -> list[Level]:
        return [
            make_level(
                f"{tag} #{i + 1}",
                r.strike,
                spot,
                gex=r.net_gex,
                open_interest=r.total_oi,
                volume=r.call_volume + r.put_volume,
            )
            for i, r in enumerate(rows)
        ]

    return {
        "positive": to_levels(positive, "Positive Gamma"),
        "negative": to_levels(negative, "Negative Gamma"),
    }


def largest_by(by_strike: list[StrikeGex], field: str, spot: float, label: str) -> Level:
    if not by_strike:
        return make_level(label, None, spot)
    row = max(by_strike, key=lambda s: abs(getattr(s, field)))
    if getattr(row, field) == 0:
        return make_level(label, None, spot, note="no data")
    return make_level(
        label,
        row.strike,
        spot,
        gex=row.net_gex,
        open_interest=row.total_oi,
        volume=row.call_volume + row.put_volume,
        origin=DataOrigin.OBSERVED if "oi" in field or "volume" in field
        else DataOrigin.MODEL_DERIVED,
    )


# ------------------------------------------------------------------ concentration


def gamma_concentration(
    by_strike: list[StrikeGex], spot: float, bands=(0.5, 1.0, 2.0, 5.0)
) -> list[Concentration]:
    if not by_strike or not spot:
        return []
    strikes = np.array([s.strike for s in by_strike])
    gex = np.array([s.net_gex for s in by_strike])
    total_abs = float(np.abs(gex).sum())
    rel = np.abs(strikes - spot) / spot * 100.0

    out = []
    for band in bands:
        m = rel <= band
        band_abs = float(np.abs(gex[m]).sum())
        out.append(
            Concentration(
                band_pct=band,
                net_gex=float(gex[m].sum()),
                absolute_gex=band_abs,
                share_of_absolute=(band_abs / total_abs * 100.0) if total_abs > 0 else 0.0,
            )
        )
    return out


# ------------------------------------------------------------------ pin risk


def pin_risk(
    by_strike: list[StrikeGex],
    spot: float,
    min_dte: float,
    dte0_share: float = 0.0,
) -> PinRisk:
    """Heuristic pin-risk score. Not a probability, and not a prediction.

    Three ingredients: how close spot sits to a dominant gamma strike, how
    dominant that strike is relative to the rest of the chain, and how little
    time is left for price to escape it.
    """
    if not by_strike or not spot:
        return PinRisk(explanation="No chain data available to assess pinning.")

    strikes = np.array([s.strike for s in by_strike])
    mag = np.array([abs(s.net_gex) for s in by_strike])
    if mag.sum() <= 0:
        return PinRisk(explanation="No gamma concentration in the chain.")

    nearest_i = int(np.argmin(np.abs(strikes - spot)))
    # Consider the largest gamma strike within 1% - that is what price can pin to.
    within = np.abs(strikes - spot) / spot <= 0.01
    anchor_i = int(np.argmax(np.where(within, mag, -1.0))) if within.any() else nearest_i
    anchor = float(strikes[anchor_i])
    dist_pct = abs(anchor - spot) / spot * 100.0

    proximity = float(np.exp(-0.5 * (dist_pct / 0.35) ** 2))          # 0..1
    dominance = float(mag[anchor_i] / mag.max()) if mag.max() > 0 else 0.0
    time_pressure = float(np.clip(1.0 - min_dte / 3.0, 0.0, 1.0))     # peaks at expiry
    dte0_factor = float(np.clip(dte0_share, 0.0, 1.0))

    score = (
        0.35 * proximity + 0.25 * dominance + 0.25 * time_pressure + 0.15 * dte0_factor
    )
    level = cast(
        Literal["Low", "Medium", "High"],
        "High" if score >= 0.65 else "Medium" if score >= 0.4 else "Low",
    )

    return PinRisk(
        level=level,
        score=round(score, 3),
        nearest_strike=anchor,
        distance_pct=round(dist_pct, 3),
        explanation=(
            f"Spot sits {dist_pct:.2f}% from {anchor:g}, which carries "
            f"{dominance * 100:.0f}% of the largest single-strike gamma in the chain. "
            f"Nearest expiry is {min_dte:.1f} DTE and same-day gamma is "
            f"{dte0_factor * 100:.0f}% of total. This is a heuristic score, not a forecast."
        ),
    )


# ------------------------------------------------------------------ regime


def classify_regime(
    net_gex: float,
    spot: float,
    zero_gamma: float | None,
    dte0_net_gex: float = 0.0,
    near_flip_pct: float = 0.5,
) -> RegimeAssessment:
    """Transparent rule-based classifier - deliberately not a black box."""
    dist_pct = None
    if zero_gamma and spot:
        dist_pct = (spot - zero_gamma) / spot * 100.0

    if dist_pct is not None and abs(dist_pct) <= near_flip_pct:
        regime = "NEUTRAL / NEAR FLIP"
        why = (
            f"Spot is only {abs(dist_pct):.2f}% from the modelled gamma flip at "
            f"{zero_gamma:,.2f}. Dealer hedging direction can invert on a small move, "
            "so expect unstable intraday behaviour around this level."
        )
    elif net_gex > 0:
        regime = "POSITIVE GAMMA"
        why = (
            "Net gamma exposure is positive, so the modelled dealer book sells strength "
            "and buys weakness. Historically this coincides with mean reversion and "
            "compressed realised volatility."
        )
    elif net_gex < 0:
        regime = "NEGATIVE GAMMA"
        why = (
            "Net gamma exposure is negative, so the modelled dealer book buys strength "
            "and sells weakness. This amplifies directional moves and widens realised ranges."
        )
    else:
        regime = "NEUTRAL"
        why = "Net gamma exposure is flat."

    if dte0_net_gex and abs(dte0_net_gex) > abs(net_gex) * 0.5:
        why += " Same-day expiries dominate the total, so the regime can reset after the close."

    return RegimeAssessment(
        regime=regime,
        net_gex=net_gex,
        zero_gamma=zero_gamma,
        distance_to_flip_pct=dist_pct,
        dte0_net_gex=dte0_net_gex,
        explanation=why,
    )


# ------------------------------------------------------------------ ratios


def put_call_ratios(
    call_volume: int, put_volume: int, call_oi: int, put_oi: int
) -> PutCallRatios:
    return PutCallRatios(
        volume_ratio=(put_volume / call_volume) if call_volume > 0 else None,
        oi_ratio=(put_oi / call_oi) if call_oi > 0 else None,
        call_volume=call_volume,
        put_volume=put_volume,
        call_oi=call_oi,
        put_oi=put_oi,
    )
