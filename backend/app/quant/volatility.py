"""Implied volatility analytics: ATM IV, skew, term structure, expected move."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

import numpy as np

from app.models import ExpectedMove, IvSummary, OptionContract, OptionType


def _mid(c: OptionContract) -> float | None:
    if c.mid is not None and c.mid > 0:
        return c.mid
    if c.bid is not None and c.ask is not None and c.ask > 0:
        return (c.bid + c.ask) / 2.0
    if c.last is not None and c.last > 0:
        return c.last
    return None


def nearest_atm_strike(contracts: list[OptionContract], spot: float) -> float | None:
    """The strike with both a call and a put quoted, closest to spot.

    Requiring both legs matters: a straddle built from a strike that only has one
    side quoted silently halves the expected move.
    """
    by_strike: dict[float, set[OptionType]] = defaultdict(set)
    for c in contracts:
        by_strike[c.strike].add(c.type)
    paired = [k for k, types in by_strike.items() if len(types) == 2]
    pool = paired or list(by_strike)
    if not pool:
        return None
    return min(pool, key=lambda k: abs(k - spot))


def expected_move(
    contracts: list[OptionContract], spot: float, expiration: date | None = None
) -> ExpectedMove | None:
    """ATM straddle expected move for one expiry (default: the nearest one)."""
    if not contracts or not spot:
        return None

    if expiration is None:
        expiration = min(c.expiration for c in contracts)
    leg = [c for c in contracts if c.expiration == expiration]
    if not leg:
        return None

    strike = nearest_atm_strike(leg, spot)
    if strike is None:
        return None

    call = next((c for c in leg if c.strike == strike and c.is_call), None)
    put = next((c for c in leg if c.strike == strike and not c.is_call), None)
    call_px = _mid(call) if call else None
    put_px = _mid(put) if put else None

    straddle: float | None = None
    if call_px is not None and put_px is not None:
        straddle = call_px + put_px
    elif call_px is not None:
        # One-sided quote: double the live leg rather than understate the move.
        straddle = call_px * 2.0
    elif put_px is not None:
        straddle = put_px * 2.0

    dte = min(c.dte for c in leg)
    if straddle is None:
        return ExpectedMove(expiration=expiration, dte=dte, atm_strike=strike,
                            call_price=call_px, put_price=put_px,
                            method="atm_straddle (no quotes available)")

    return ExpectedMove(
        expiration=expiration,
        dte=dte,
        atm_strike=strike,
        call_price=call_px,
        put_price=put_px,
        straddle=straddle,
        move_abs=straddle,
        move_pct=straddle / spot * 100.0,
        upper=spot + straddle,
        lower=spot - straddle,
        method="atm_straddle" if (call_px and put_px) else "atm_straddle (single leg doubled)",
    )


def iv_summary(contracts: list[OptionContract], spot: float) -> IvSummary:
    """ATM IV, 25-delta wings, risk reversal, skew curve and term structure."""
    live = [c for c in contracts if c.iv and c.iv > 0]
    if not live or not spot:
        return IvSummary()

    front = min(c.expiration for c in live)
    front_leg = [c for c in live if c.expiration == front]

    atm_k = nearest_atm_strike(front_leg, spot)
    atm_pool = [c for c in front_leg if c.strike == atm_k] if atm_k else []
    # `live` above guarantees every contract here has a real IV; the local floats
    # make that explicit rather than leaving Optional to leak into np.mean.
    atm_ivs = [float(c.iv) for c in atm_pool if c.iv is not None]
    call_atm = [float(c.iv) for c in atm_pool if c.is_call and c.iv is not None]
    put_atm = [float(c.iv) for c in atm_pool if not c.is_call and c.iv is not None]
    atm_iv = float(np.mean(atm_ivs)) if atm_ivs else None

    def at_delta(pool: list[OptionContract], target: float) -> float | None:
        cands = [c for c in pool if c.delta is not None]
        if not cands:
            return None
        best = min(cands, key=lambda c: abs(abs(c.delta or 0.0) - target))
        # Reject anything that is not actually near 25 delta.
        return best.iv if abs(abs(best.delta or 0.0) - target) < 0.12 else None

    iv_25c = at_delta([c for c in front_leg if c.is_call], 0.25)
    iv_25p = at_delta([c for c in front_leg if not c.is_call], 0.25)
    rr = (iv_25c - iv_25p) if (iv_25c is not None and iv_25p is not None) else None

    skew_points = [
        {
            "strike": c.strike,
            "moneyness": round(c.strike / spot, 4),
            "delta": c.delta,
            "iv": c.iv,
            "type": c.type.value,
        }
        for c in sorted(front_leg, key=lambda c: c.strike)
    ]

    term: list[dict] = []
    by_exp: dict[date, list[OptionContract]] = defaultdict(list)
    for c in live:
        by_exp[c.expiration].append(c)
    for exp in sorted(by_exp):
        pool = by_exp[exp]
        k = nearest_atm_strike(pool, spot)
        ivs = [float(c.iv) for c in pool if c.strike == k and c.iv is not None]
        if ivs:
            term.append(
                {
                    "expiration": exp.isoformat(),
                    "dte": round(min(c.dte for c in pool), 2),
                    "atm_iv": float(np.mean(ivs)),
                }
            )

    return IvSummary(
        atm_iv=atm_iv,
        call_atm_iv=float(np.mean(call_atm)) if call_atm else None,
        put_atm_iv=float(np.mean(put_atm)) if put_atm else None,
        iv_25d_call=iv_25c,
        iv_25d_put=iv_25p,
        risk_reversal_25d=rr,
        skew_points=skew_points,
        term_structure=term,
    )
