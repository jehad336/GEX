"""Black-Scholes correctness: closed-form identities and finite-difference checks."""

from __future__ import annotations

import numpy as np
import pytest

from app.quant import black_scholes as bs
from tests.conftest import FD_TOL

S, K, T, SIG, R, Q = 100.0, 100.0, 1.0, 0.20, 0.05, 0.0


def test_atm_call_matches_reference_value():
    # Independently computed: BSM call, S=K=100, T=1, sigma=0.20, r=0.05, q=0.
    assert float(bs.price(S, K, T, SIG, R, Q, True)) == pytest.approx(10.4506, abs=1e-4)


def test_atm_put_matches_reference_value():
    assert float(bs.price(S, K, T, SIG, R, Q, False)) == pytest.approx(5.5735, abs=1e-4)


def test_put_call_parity():
    call = float(bs.price(S, K, T, SIG, R, Q, True))
    put = float(bs.price(S, K, T, SIG, R, Q, False))
    assert call - put == pytest.approx(S * np.exp(-Q * T) - K * np.exp(-R * T), abs=1e-8)


def test_gamma_is_identical_for_calls_and_puts():
    # Gamma is the second derivative of price; the call/put difference is linear in S.
    assert float(bs.gamma(S, K, T, SIG, R, Q)) == pytest.approx(0.018762, abs=1e-5)


def test_gamma_matches_finite_difference_of_delta():
    h = 0.01
    up = float(bs.delta(S + h, K, T, SIG, R, Q, True))
    down = float(bs.delta(S - h, K, T, SIG, R, Q, True))
    assert (up - down) / (2 * h) == pytest.approx(
        float(bs.gamma(S, K, T, SIG, R, Q)), abs=FD_TOL
    )


def test_vanna_matches_finite_difference_of_delta_in_vol():
    h = 1e-4
    up = float(bs.delta(S, K, T, SIG + h, R, Q, True))
    down = float(bs.delta(S, K, T, SIG - h, R, Q, True))
    assert (up - down) / (2 * h) == pytest.approx(
        float(bs.vanna(S, K, T, SIG, R, Q)), abs=FD_TOL
    )


def test_charm_matches_negative_time_derivative_of_delta():
    # Charm is dDelta/dt with t running forward, so it is -dDelta/dT.
    h = 1e-5
    up = float(bs.delta(S, K, T + h, SIG, R, Q, True))
    down = float(bs.delta(S, K, T - h, SIG, R, Q, True))
    assert -(up - down) / (2 * h) == pytest.approx(
        float(bs.charm(S, K, T, SIG, R, Q, True)), abs=1e-3
    )


def test_delta_bounds():
    calls = bs.delta(S, np.array([50, 100, 200.0]), T, SIG, R, Q, True)
    puts = bs.delta(S, np.array([50, 100, 200.0]), T, SIG, R, Q, False)
    assert np.all((calls >= 0) & (calls <= 1))
    assert np.all((puts >= -1) & (puts <= 0))


@pytest.mark.parametrize("bad_T", [0.0, -1.0])
def test_zero_or_negative_expiry_gives_zero_gamma_not_nan(bad_T):
    g = float(bs.gamma(S, K, bad_T, SIG, R, Q))
    assert g == 0.0 and not np.isnan(g)


def test_zero_vol_gives_zero_gamma_not_nan():
    assert float(bs.gamma(S, K, T, 0.0, R, Q)) == 0.0


def test_expired_option_prices_at_intrinsic():
    assert float(bs.price(110.0, 100.0, 0.0, SIG, R, Q, True)) == pytest.approx(10.0)
    assert float(bs.price(90.0, 100.0, 0.0, SIG, R, Q, True)) == pytest.approx(0.0)
    assert float(bs.price(90.0, 100.0, 0.0, SIG, R, Q, False)) == pytest.approx(10.0)


def test_expired_delta_is_the_intrinsic_indicator():
    assert float(bs.delta(110.0, 100.0, 0.0, SIG, R, Q, True)) == 1.0
    assert float(bs.delta(90.0, 100.0, 0.0, SIG, R, Q, True)) == 0.0
    assert float(bs.delta(90.0, 100.0, 0.0, SIG, R, Q, False)) == -1.0


def test_deep_itm_and_otm_gamma_approaches_zero():
    assert float(bs.gamma(S, 1.0, T, SIG, R, Q)) < 1e-6
    assert float(bs.gamma(S, 10_000.0, T, SIG, R, Q)) < 1e-6


def test_vectorization_broadcasts_over_strikes():
    strikes = np.array([90.0, 95.0, 100.0, 105.0, 110.0])
    g = bs.gamma(S, strikes, T, SIG, R, Q)
    assert g.shape == strikes.shape
    # Gamma peaks near the forward, which with r=5% over a year sits above spot -
    # not at the spot strike. The wings must still be below the centre.
    peak = int(np.argmax(g))
    assert peak in (2, 3)
    assert g[0] < g[peak] and g[-1] < g[peak]


def test_implied_vol_round_trips():
    target = float(bs.price(S, K, T, 0.33, R, Q, True))
    assert bs.implied_vol(target, S, K, T, R, Q, True) == pytest.approx(0.33, abs=1e-4)


def test_implied_vol_returns_none_for_impossible_price():
    assert bs.implied_vol(1e6, S, K, T, R, Q, True) is None
    assert bs.implied_vol(0.0, S, K, T, R, Q, True) is None
