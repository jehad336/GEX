"""Gamma / Delta / Vanna / Charm exposure engine.

IMPORTANT MODELLING NOTE
------------------------
True dealer inventory is not observable from a public option chain. Everything
this module labels "signed" is a *model estimate* built on a configurable
convention (by default: dealers are short calls and long puts against customer
flow, so call gamma is positive and put gamma negative). Open Interest, Volume,
IV and vendor Greeks are observed; Net GEX, Gamma Flip, Call Wall, Put Wall and
Pin Risk are derived. The API tags each with a DataOrigin so the UI can say so.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime

import numpy as np

from app.models import (
    ExpiryGex,
    GexTotals,
    OptionContract,
    OptionType,
    StrikeGex,
)
from app.quant import black_scholes as bs

# ------------------------------------------------------------------ config

SIGN_CONVENTIONS = {
    # Dealer assumed short calls, long puts - the standard retail-flow heuristic.
    "calls_positive_puts_negative": (1.0, -1.0),
    # Raw magnitude view, useful for an "absolute gamma" chart.
    "all_positive": (1.0, 1.0),
    # Inverse assumption, for chains dominated by call overwriting.
    "put_positive_call_negative": (-1.0, 1.0),
}

DEFAULT_CONVENTION = "calls_positive_puts_negative"
# GEX is conventionally quoted as dollars per 1% move: Spot^2 * 0.01
PCT_MOVE_SCALER = 0.01


def signs_for(convention: str) -> tuple[float, float]:
    return SIGN_CONVENTIONS.get(convention, SIGN_CONVENTIONS[DEFAULT_CONVENTION])


# ------------------------------------------------------------------ arrays


class ChainArrays:
    """Column-oriented view of a chain. Built once, reused by every calculation."""

    __slots__ = (
        "strike", "gamma", "delta", "vanna", "charm", "iv", "oi", "volume",
        "multiplier", "is_call", "dte", "tenor", "expiration", "size",
    )

    def __init__(self, contracts: list[OptionContract], multiplier_default: int = 100):
        n = len(contracts)
        self.size = n
        self.strike = np.zeros(n)
        self.gamma = np.zeros(n)
        self.delta = np.zeros(n)
        self.vanna = np.zeros(n)
        self.charm = np.zeros(n)
        self.iv = np.zeros(n)
        self.oi = np.zeros(n, dtype=np.int64)
        self.volume = np.zeros(n, dtype=np.int64)
        self.multiplier = np.full(n, multiplier_default, dtype=np.int64)
        self.is_call = np.zeros(n, dtype=bool)
        self.dte = np.zeros(n)
        self.expiration: list[date] = []

        for i, c in enumerate(contracts):
            self.strike[i] = c.strike
            self.gamma[i] = c.gamma or 0.0
            self.delta[i] = c.delta or 0.0
            self.iv[i] = c.iv or 0.0
            self.oi[i] = max(c.open_interest or 0, 0)
            self.volume[i] = max(c.volume or 0, 0)
            # Respect the multiplier the provider reports; only default if absent.
            self.multiplier[i] = c.multiplier or multiplier_default
            self.is_call[i] = c.type == OptionType.CALL
            self.dte[i] = max(c.dte, 0.0)
            self.expiration.append(c.expiration)

        # Time in years, floored so 0DTE stays numerically usable (about one hour).
        self.tenor = np.maximum(self.dte / 365.0, 1.0 / (365.0 * 24.0))


def fill_missing_greeks(
    arrays: ChainArrays, spot: float, r: float = 0.043, q: float = 0.0
) -> ChainArrays:
    """Compute gamma/delta with Black-Scholes wherever the provider omitted them.

    Vanna and charm are always computed locally, since no mainstream chain API
    ships them.
    """
    need_gamma = (arrays.gamma == 0.0) & (arrays.iv > 0.0)
    if need_gamma.any():
        arrays.gamma[need_gamma] = bs.gamma(
            spot, arrays.strike[need_gamma], arrays.tenor[need_gamma],
            arrays.iv[need_gamma], r, q,
        )
    need_delta = (arrays.delta == 0.0) & (arrays.iv > 0.0)
    if need_delta.any():
        arrays.delta[need_delta] = bs.delta(
            spot, arrays.strike[need_delta], arrays.tenor[need_delta],
            arrays.iv[need_delta], r, q, arrays.is_call[need_delta],
        )
    has_iv = arrays.iv > 0.0
    if has_iv.any():
        arrays.vanna[has_iv] = bs.vanna(
            spot, arrays.strike[has_iv], arrays.tenor[has_iv], arrays.iv[has_iv], r, q
        )
        arrays.charm[has_iv] = bs.charm(
            spot, arrays.strike[has_iv], arrays.tenor[has_iv], arrays.iv[has_iv], r, q,
            arrays.is_call[has_iv],
        )
    return arrays


# ------------------------------------------------------------------ exposures


def gex_per_contract(
    arrays: ChainArrays, spot: float, convention: str = DEFAULT_CONVENTION
) -> np.ndarray:
    """GEX = gamma * OI * multiplier * spot^2 * 0.01, signed by convention."""
    call_sign, put_sign = signs_for(convention)
    sign = np.where(arrays.is_call, call_sign, put_sign)
    return sign * arrays.gamma * arrays.oi * arrays.multiplier * (spot**2) * PCT_MOVE_SCALER


def vgex_per_contract(
    arrays: ChainArrays, spot: float, convention: str = DEFAULT_CONVENTION
) -> np.ndarray:
    """Volume Gamma Exposure *proxy*. Measures session activity, NOT inventory."""
    call_sign, put_sign = signs_for(convention)
    sign = np.where(arrays.is_call, call_sign, put_sign)
    return sign * arrays.gamma * arrays.volume * arrays.multiplier * (spot**2) * PCT_MOVE_SCALER


def dex_per_contract(
    arrays: ChainArrays, spot: float, convention: str = DEFAULT_CONVENTION
) -> np.ndarray:
    """DEX = delta * OI * multiplier * spot.

    Delta already carries its own call/put sign, so the convention here only
    flips which side of the trade we are modelling.
    """
    call_sign, put_sign = signs_for(convention)
    sign = np.where(arrays.is_call, call_sign, put_sign)
    return sign * arrays.delta * arrays.oi * arrays.multiplier * spot


def vanna_per_contract(
    arrays: ChainArrays, spot: float, convention: str = DEFAULT_CONVENTION
) -> np.ndarray:
    """Vanna exposure per one vol point (0.01) of IV change."""
    call_sign, put_sign = signs_for(convention)
    sign = np.where(arrays.is_call, call_sign, put_sign)
    return sign * arrays.vanna * arrays.oi * arrays.multiplier * spot * 0.01


def charm_per_contract(
    arrays: ChainArrays, spot: float, convention: str = DEFAULT_CONVENTION
) -> np.ndarray:
    """Charm exposure per calendar day of decay."""
    call_sign, put_sign = signs_for(convention)
    sign = np.where(arrays.is_call, call_sign, put_sign)
    return sign * arrays.charm * arrays.oi * arrays.multiplier * spot / 365.0


# ------------------------------------------------------------------ aggregation


def compute_totals(
    arrays: ChainArrays, spot: float, convention: str = DEFAULT_CONVENTION
) -> GexTotals:
    if arrays.size == 0:
        return GexTotals(call_gex=0.0, put_gex=0.0, net_gex=0.0, absolute_gex=0.0)

    gex = gex_per_contract(arrays, spot, convention)
    dex = dex_per_contract(arrays, spot, convention)
    van = vanna_per_contract(arrays, spot, convention)
    chm = charm_per_contract(arrays, spot, convention)
    calls, puts = arrays.is_call, ~arrays.is_call

    return GexTotals(
        call_gex=float(gex[calls].sum()),
        put_gex=float(gex[puts].sum()),
        net_gex=float(gex.sum()),
        absolute_gex=float(np.abs(gex).sum()),
        call_dex=float(dex[calls].sum()),
        put_dex=float(dex[puts].sum()),
        net_dex=float(dex.sum()),
        net_vanna=float(van.sum()),
        net_charm=float(chm.sum()),
        call_oi=int(arrays.oi[calls].sum()),
        put_oi=int(arrays.oi[puts].sum()),
        call_volume=int(arrays.volume[calls].sum()),
        put_volume=int(arrays.volume[puts].sum()),
        contract_count=int(arrays.size),
    )


def compute_by_strike(
    arrays: ChainArrays, spot: float, convention: str = DEFAULT_CONVENTION
) -> list[StrikeGex]:
    if arrays.size == 0:
        return []

    gex = gex_per_contract(arrays, spot, convention)
    vgex = vgex_per_contract(arrays, spot, convention)
    dex = dex_per_contract(arrays, spot, convention)
    van = vanna_per_contract(arrays, spot, convention)
    chm = charm_per_contract(arrays, spot, convention)

    out: list[StrikeGex] = []
    for k in np.unique(arrays.strike):
        m = arrays.strike == k
        mc, mp = m & arrays.is_call, m & ~arrays.is_call
        out.append(
            StrikeGex(
                strike=float(k),
                call_gex=float(gex[mc].sum()),
                put_gex=float(gex[mp].sum()),
                net_gex=float(gex[m].sum()),
                call_oi=int(arrays.oi[mc].sum()),
                put_oi=int(arrays.oi[mp].sum()),
                total_oi=int(arrays.oi[m].sum()),
                call_volume=int(arrays.volume[mc].sum()),
                put_volume=int(arrays.volume[mp].sum()),
                call_dex=float(dex[mc].sum()),
                put_dex=float(dex[mp].sum()),
                net_dex=float(dex[m].sum()),
                net_vanna=float(van[m].sum()),
                net_charm=float(chm[m].sum()),
                call_vgex=float(vgex[mc].sum()),
                put_vgex=float(vgex[mp].sum()),
                call_vanna=float(van[mc].sum()),
                put_vanna=float(van[mp].sum()),
                call_charm=float(chm[mc].sum()),
                put_charm=float(chm[mp].sum()),
                call_iv=_mean_iv(arrays.iv[mc]),
                put_iv=_mean_iv(arrays.iv[mp]),
                contract_count=int(m.sum()),
            )
        )
    return out


def _mean_iv(values: np.ndarray) -> float | None:
    """Average of the quoted IVs only. Zeros mean "not supplied", not "zero vol"."""
    live = values[values > 0]
    return float(live.mean()) if live.size else None


def compute_by_expiry(
    arrays: ChainArrays, spot: float, convention: str = DEFAULT_CONVENTION
) -> list[ExpiryGex]:
    if arrays.size == 0:
        return []

    gex = gex_per_contract(arrays, spot, convention)
    dex = dex_per_contract(arrays, spot, convention)

    buckets: dict[date, list[int]] = defaultdict(list)
    for i, exp in enumerate(arrays.expiration):
        buckets[exp].append(i)

    out: list[ExpiryGex] = []
    for exp in sorted(buckets):
        idx = np.array(buckets[exp])
        calls = idx[arrays.is_call[idx]]
        puts = idx[~arrays.is_call[idx]]

        # ATM IV for the expiry: average IV of the strike closest to spot.
        atm_iv = None
        live = arrays.iv[idx] > 0
        if live.any():
            sub = idx[live]
            nearest = sub[np.argmin(np.abs(arrays.strike[sub] - spot))]
            same_k = sub[arrays.strike[sub] == arrays.strike[nearest]]
            atm_iv = float(arrays.iv[same_k].mean())

        out.append(
            ExpiryGex(
                expiration=exp,
                dte=float(arrays.dte[idx].min()),
                call_gex=float(gex[calls].sum()) if calls.size else 0.0,
                put_gex=float(gex[puts].sum()) if puts.size else 0.0,
                net_gex=float(gex[idx].sum()),
                call_oi=int(arrays.oi[calls].sum()) if calls.size else 0,
                put_oi=int(arrays.oi[puts].sum()) if puts.size else 0,
                call_volume=int(arrays.volume[calls].sum()) if calls.size else 0,
                put_volume=int(arrays.volume[puts].sum()) if puts.size else 0,
                net_dex=float(dex[idx].sum()),
                atm_iv=atm_iv,
                contract_count=int(idx.size),
            )
        )
    return out


# ------------------------------------------------------------------ profile


def gamma_profile(
    arrays: ChainArrays,
    spot: float,
    convention: str = DEFAULT_CONVENTION,
    band_pct: float = 0.10,
    steps: int = 81,
    r: float = 0.043,
    q: float = 0.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Reprice gamma at each hypothetical spot, then re-aggregate.

    Returns (prices, net_gex, call_gex, put_gex). Contracts with no IV are
    skipped: repricing them would mean inventing a volatility.
    """
    prices = np.linspace(spot * (1 - band_pct), spot * (1 + band_pct), steps)
    net = np.zeros(steps)
    call_leg = np.zeros(steps)
    put_leg = np.zeros(steps)
    if arrays.size == 0:
        return prices, net, call_leg, put_leg

    usable = (arrays.iv > 0) & (arrays.oi > 0)
    if not usable.any():
        return prices, net, call_leg, put_leg

    K = arrays.strike[usable]
    T = arrays.tenor[usable]
    sig = arrays.iv[usable]
    oi = arrays.oi[usable]
    mult = arrays.multiplier[usable]
    is_call = arrays.is_call[usable]
    call_sign, put_sign = signs_for(convention)
    sign = np.where(is_call, call_sign, put_sign)

    for i, S in enumerate(prices):
        g = bs.gamma(S, K, T, sig, r, q)
        contrib = sign * g * oi * mult * (S**2) * PCT_MOVE_SCALER
        net[i] = contrib.sum()
        call_leg[i] = contrib[is_call].sum()
        put_leg[i] = contrib[~is_call].sum()
    return prices, net, call_leg, put_leg


def find_zero_gamma(prices: np.ndarray, net_gex: np.ndarray) -> float | None:
    """Linear interpolation across the sign change nearest the middle of the range.

    Snapping to the nearest sampled price instead would quantise the flip to the
    grid step, which on SPX is tens of index points of error.
    """
    if prices.size < 2:
        return None
    sign_change = np.where(np.sign(net_gex[:-1]) * np.sign(net_gex[1:]) < 0)[0]
    if sign_change.size == 0:
        return None
    mid_idx = len(prices) // 2
    i = int(sign_change[np.argmin(np.abs(sign_change - mid_idx))])
    y0, y1 = net_gex[i], net_gex[i + 1]
    x0, x1 = prices[i], prices[i + 1]
    if y1 == y0:
        return float(0.5 * (x0 + x1))
    return float(x0 - y0 * (x1 - x0) / (y1 - y0))


def find_zero_gamma_crossings(
    prices: np.ndarray, net_gex: np.ndarray
) -> list[float]:
    """Every interpolated zero crossing in the profile, ascending.

    A chain can cross zero more than once - typically a lower transition below a
    put-heavy region and an upper one above the call wall. Reporting only the
    middle crossing hides the boundary the market is actually approaching.
    """
    if prices.size < 2:
        return []
    out: list[float] = []
    for i in np.where(np.sign(net_gex[:-1]) * np.sign(net_gex[1:]) < 0)[0]:
        y0, y1 = net_gex[i], net_gex[i + 1]
        x0, x1 = prices[i], prices[i + 1]
        out.append(
            float(0.5 * (x0 + x1)) if y1 == y0
            else float(x0 - y0 * (x1 - x0) / (y1 - y0))
        )
    return sorted(out)


# ------------------------------------------------------------------ helpers


def filter_contracts(
    contracts: list[OptionContract],
    max_dte: float | None = None,
    min_dte: float | None = None,
    expirations: list[date] | None = None,
    strike_band_pct: float | None = None,
    spot: float | None = None,
    include_0dte: bool = True,
) -> list[OptionContract]:
    out = contracts
    if expirations:
        wanted = set(expirations)
        out = [c for c in out if c.expiration in wanted]
    if max_dte is not None:
        out = [c for c in out if c.dte <= max_dte]
    if min_dte is not None:
        out = [c for c in out if c.dte >= min_dte]
    if not include_0dte:
        out = [c for c in out if c.dte >= 1.0]
    if strike_band_pct is not None and spot:
        lo, hi = spot * (1 - strike_band_pct), spot * (1 + strike_band_pct)
        out = [c for c in out if lo <= c.strike <= hi]
    return out


def dte0_contracts(contracts: list[OptionContract]) -> list[OptionContract]:
    """Same-session expiries. dte < 1.0 rather than == 0 so a fraction of a day counts."""
    return [c for c in contracts if c.dte < 1.0]


def utcnow() -> datetime:
    return datetime.now(UTC)
