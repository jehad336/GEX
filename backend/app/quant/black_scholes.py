"""Black-Scholes-Merton pricing and Greeks, vectorized over NumPy arrays.

Every function accepts scalars or arrays and returns arrays. Degenerate inputs
(T <= 0, sigma <= 0, S <= 0, K <= 0) yield the mathematically correct limit
rather than a NaN, because real option chains are full of them.
"""

from __future__ import annotations

import numpy as np

SQRT_2PI = float(np.sqrt(2.0 * np.pi))
EPS = 1e-12


def _norm_pdf(x: np.ndarray) -> np.ndarray:
    return np.exp(-0.5 * x * x) / SQRT_2PI


def _norm_cdf(x: np.ndarray) -> np.ndarray:
    # erf-based CDF avoids a SciPy call in the hot loop.
    from scipy.special import erf  # local import keeps import cost off module load

    return 0.5 * (1.0 + erf(x / np.sqrt(2.0)))


def _prep(S, K, T, sigma, r, q) -> tuple[np.ndarray, ...]:
    S = np.asarray(S, dtype=float)
    K = np.asarray(K, dtype=float)
    T = np.asarray(T, dtype=float)
    sigma = np.asarray(sigma, dtype=float)
    r = np.asarray(r, dtype=float)
    q = np.asarray(q, dtype=float)
    return np.broadcast_arrays(S, K, T, sigma, r, q)


def d1_d2(S, K, T, sigma, r=0.0, q=0.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (d1, d2, valid_mask). Invalid entries are zeroed, not NaN."""
    S, K, T, sigma, r, q = _prep(S, K, T, sigma, r, q)
    valid = (T > EPS) & (sigma > EPS) & (S > EPS) & (K > EPS)
    Ts = np.where(valid, T, 1.0)
    sig = np.where(valid, sigma, 1.0)
    Ss = np.where(valid, S, 1.0)
    Ks = np.where(valid, K, 1.0)

    vol_sqrt_t = sig * np.sqrt(Ts)
    d1 = (np.log(Ss / Ks) + (r - q + 0.5 * sig * sig) * Ts) / vol_sqrt_t
    d2 = d1 - vol_sqrt_t
    return np.where(valid, d1, 0.0), np.where(valid, d2, 0.0), valid


def gamma(S, K, T, sigma, r=0.0, q=0.0) -> np.ndarray:
    """dDelta/dSpot. Zero at expiry (the delta step function has no density)."""
    S, K, T, sigma, r, q = _prep(S, K, T, sigma, r, q)
    d1, _, valid = d1_d2(S, K, T, sigma, r, q)
    denom = S * sigma * np.sqrt(np.where(valid, T, 1.0))
    g = np.exp(-q * T) * _norm_pdf(d1) / np.where(denom > EPS, denom, 1.0)
    return np.where(valid & (denom > EPS), g, 0.0)


def delta(S, K, T, sigma, r=0.0, q=0.0, is_call=True) -> np.ndarray:
    S, K, T, sigma, r, q = _prep(S, K, T, sigma, r, q)
    is_call = np.asarray(is_call, dtype=bool)
    d1, _, valid = d1_d2(S, K, T, sigma, r, q)
    disc_q = np.exp(-q * T)
    live = np.where(is_call, disc_q * _norm_cdf(d1), disc_q * (_norm_cdf(d1) - 1.0))
    # At expiry delta collapses to the intrinsic indicator.
    expired = np.where(is_call, (S > K).astype(float), -(S < K).astype(float))
    return np.where(valid, live, expired)


def vega(S, K, T, sigma, r=0.0, q=0.0) -> np.ndarray:
    """dPrice/dVol, per 1.0 of vol (not per vol point)."""
    S, K, T, sigma, r, q = _prep(S, K, T, sigma, r, q)
    d1, _, valid = d1_d2(S, K, T, sigma, r, q)
    v = S * np.exp(-q * T) * _norm_pdf(d1) * np.sqrt(np.where(valid, T, 0.0))
    return np.where(valid, v, 0.0)


def theta(S, K, T, sigma, r=0.0, q=0.0, is_call=True) -> np.ndarray:
    """Per-year theta. Divide by 365 for the per-day figure traders quote."""
    S, K, T, sigma, r, q = _prep(S, K, T, sigma, r, q)
    is_call = np.asarray(is_call, dtype=bool)
    d1, d2, valid = d1_d2(S, K, T, sigma, r, q)
    Ts = np.where(valid, T, 1.0)
    term1 = -(S * np.exp(-q * T) * _norm_pdf(d1) * sigma) / (2.0 * np.sqrt(Ts))
    call_t = term1 - r * K * np.exp(-r * T) * _norm_cdf(d2) + q * S * np.exp(-q * T) * _norm_cdf(d1)
    put_t = (
        term1
        + r * K * np.exp(-r * T) * _norm_cdf(-d2)
        - q * S * np.exp(-q * T) * _norm_cdf(-d1)
    )
    return np.where(valid, np.where(is_call, call_t, put_t), 0.0)


def vanna(S, K, T, sigma, r=0.0, q=0.0) -> np.ndarray:
    """dDelta/dVol == dVega/dSpot. Same for calls and puts."""
    S, K, T, sigma, r, q = _prep(S, K, T, sigma, r, q)
    d1, d2, valid = d1_d2(S, K, T, sigma, r, q)
    sig = np.where(sigma > EPS, sigma, 1.0)
    v = -np.exp(-q * T) * _norm_pdf(d1) * d2 / sig
    return np.where(valid, v, 0.0)


def charm(S, K, T, sigma, r=0.0, q=0.0, is_call=True) -> np.ndarray:
    """dDelta/dTime (delta decay), expressed per year of calendar time."""
    S, K, T, sigma, r, q = _prep(S, K, T, sigma, r, q)
    is_call = np.asarray(is_call, dtype=bool)
    d1, d2, valid = d1_d2(S, K, T, sigma, r, q)
    Ts = np.where(valid, T, 1.0)
    sig = np.where(sigma > EPS, sigma, 1.0)
    common = np.exp(-q * T) * _norm_pdf(d1) * (2.0 * (r - q) * Ts - d2 * sig * np.sqrt(Ts))
    common = common / (2.0 * Ts * sig * np.sqrt(Ts))
    call_c = q * np.exp(-q * T) * _norm_cdf(d1) - common
    put_c = -q * np.exp(-q * T) * _norm_cdf(-d1) - common
    return np.where(valid, np.where(is_call, call_c, put_c), 0.0)


def price(S, K, T, sigma, r=0.0, q=0.0, is_call=True) -> np.ndarray:
    S, K, T, sigma, r, q = _prep(S, K, T, sigma, r, q)
    is_call = np.asarray(is_call, dtype=bool)
    d1, d2, valid = d1_d2(S, K, T, sigma, r, q)
    disc_r, disc_q = np.exp(-r * T), np.exp(-q * T)
    call = S * disc_q * _norm_cdf(d1) - K * disc_r * _norm_cdf(d2)
    put = K * disc_r * _norm_cdf(-d2) - S * disc_q * _norm_cdf(-d1)
    live = np.where(is_call, call, put)
    intrinsic = np.where(is_call, np.maximum(S - K, 0.0), np.maximum(K - S, 0.0))
    return np.where(valid, live, intrinsic)


def implied_vol(
    target: float,
    S: float,
    K: float,
    T: float,
    r: float = 0.0,
    q: float = 0.0,
    is_call: bool = True,
    tol: float = 1e-6,
    max_iter: int = 100,
) -> float | None:
    """Brent bisection on vol. Returns None when the price is not arbitrage-free."""
    if T <= EPS or S <= EPS or K <= EPS or target is None or target <= 0:
        return None
    lo, hi = 1e-4, 5.0
    p_lo = float(price(S, K, T, lo, r, q, is_call))
    p_hi = float(price(S, K, T, hi, r, q, is_call))
    if target < p_lo or target > p_hi:
        return None
    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        p_mid = float(price(S, K, T, mid, r, q, is_call))
        if abs(p_mid - target) < tol:
            return mid
        if p_mid < target:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)
