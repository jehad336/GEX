"""GEX engine: formula, aggregation, filtering, profile and flip interpolation."""

from __future__ import annotations

import numpy as np
import pytest

from app.models import OptionType
from app.quant import gex_engine as engine
from tests.conftest import ABS_TOL, SPOT, make_contract


def arrays_of(contracts):
    return engine.ChainArrays(contracts, 100)


# ---------------------------------------------------------------- formula


def test_single_contract_gex_matches_hand_calculation():
    # gamma 0.05 * OI 200 * mult 100 * 100^2 * 0.01 = 100_000
    c = make_contract(100.0, OptionType.CALL, gamma=0.05, oi=200)
    gex = engine.gex_per_contract(arrays_of([c]), SPOT)
    assert float(gex[0]) == pytest.approx(100_000.0, abs=ABS_TOL)


def test_gex_scales_with_the_square_of_spot():
    c = make_contract(100.0, OptionType.CALL, gamma=0.05, oi=200)
    a = arrays_of([c])
    at_100 = float(engine.gex_per_contract(a, 100.0)[0])
    at_200 = float(engine.gex_per_contract(a, 200.0)[0])
    assert at_200 / at_100 == pytest.approx(4.0, abs=1e-9)


def test_provider_multiplier_is_respected_over_the_default():
    c = make_contract(100.0, OptionType.CALL, gamma=0.05, oi=200, multiplier=1000)
    gex = engine.gex_per_contract(arrays_of([c]), SPOT)
    assert float(gex[0]) == pytest.approx(1_000_000.0, abs=ABS_TOL)


# ---------------------------------------------------------------- totals


def test_totals_match_the_synthetic_chain(synthetic_chain, expected_synthetic):
    totals = engine.compute_totals(arrays_of(synthetic_chain), SPOT)
    assert totals.call_gex == pytest.approx(expected_synthetic["call_gex"], abs=ABS_TOL)
    assert totals.put_gex == pytest.approx(expected_synthetic["put_gex"], abs=ABS_TOL)
    assert totals.net_gex == pytest.approx(expected_synthetic["net_gex"], abs=ABS_TOL)
    assert totals.absolute_gex == pytest.approx(expected_synthetic["absolute_gex"], abs=ABS_TOL)


def test_totals_carry_observed_oi_and_volume(synthetic_chain, expected_synthetic):
    totals = engine.compute_totals(arrays_of(synthetic_chain), SPOT)
    assert totals.call_oi == expected_synthetic["call_oi"]
    assert totals.put_oi == expected_synthetic["put_oi"]
    assert totals.call_volume == expected_synthetic["call_volume"]
    assert totals.put_volume == expected_synthetic["put_volume"]


def test_net_gex_is_call_plus_put(synthetic_chain):
    t = engine.compute_totals(arrays_of(synthetic_chain), SPOT)
    assert t.net_gex == pytest.approx(t.call_gex + t.put_gex, abs=ABS_TOL)


# ---------------------------------------------------------------- conventions


def test_all_positive_convention_makes_net_equal_absolute(synthetic_chain):
    t = engine.compute_totals(arrays_of(synthetic_chain), SPOT, "all_positive")
    assert t.net_gex == pytest.approx(t.absolute_gex, abs=ABS_TOL)


def test_inverted_convention_flips_the_sign(synthetic_chain):
    default = engine.compute_totals(arrays_of(synthetic_chain), SPOT,
                                    "calls_positive_puts_negative")
    inverted = engine.compute_totals(arrays_of(synthetic_chain), SPOT,
                                     "put_positive_call_negative")
    assert inverted.net_gex == pytest.approx(-default.net_gex, abs=ABS_TOL)


def test_unknown_convention_falls_back_to_the_default():
    assert engine.signs_for("nonsense") == engine.SIGN_CONVENTIONS[engine.DEFAULT_CONVENTION]


# ---------------------------------------------------------------- by strike


def test_by_strike_matches_hand_calculation(synthetic_chain, expected_synthetic):
    rows = {r.strike: r for r in engine.compute_by_strike(arrays_of(synthetic_chain), SPOT)}
    assert set(rows) == {95.0, 105.0}
    for strike, want in expected_synthetic["by_strike"].items():
        assert rows[strike].call_gex == pytest.approx(want["call"], abs=ABS_TOL)
        assert rows[strike].put_gex == pytest.approx(want["put"], abs=ABS_TOL)
        assert rows[strike].net_gex == pytest.approx(want["net"], abs=ABS_TOL)


def test_by_strike_sums_back_to_totals(synthetic_chain):
    a = arrays_of(synthetic_chain)
    rows = engine.compute_by_strike(a, SPOT)
    totals = engine.compute_totals(a, SPOT)
    assert sum(r.net_gex for r in rows) == pytest.approx(totals.net_gex, abs=1e-6)
    assert sum(r.total_oi for r in rows) == totals.call_oi + totals.put_oi


def test_by_strike_is_sorted_ascending(synthetic_chain):
    rows = engine.compute_by_strike(arrays_of(synthetic_chain), SPOT)
    assert [r.strike for r in rows] == sorted(r.strike for r in rows)


# ---------------------------------------------------------------- by expiry


def test_by_expiry_partitions_the_chain():
    contracts = [
        make_contract(100.0, OptionType.CALL, gamma=0.01, oi=1000, dte=0.4),
        make_contract(100.0, OptionType.PUT, gamma=0.01, oi=1000, dte=0.4),
        make_contract(100.0, OptionType.CALL, gamma=0.02, oi=500, dte=30),
    ]
    rows = engine.compute_by_expiry(arrays_of(contracts), SPOT)
    assert len(rows) == 2
    assert rows[0].dte < rows[1].dte
    total = engine.compute_totals(arrays_of(contracts), SPOT)
    assert sum(r.net_gex for r in rows) == pytest.approx(total.net_gex, abs=1e-6)


# ---------------------------------------------------------------- DEX


def test_dex_matches_hand_calculation():
    # delta 0.5 * OI 1000 * mult 100 * spot 100 = 5_000_000
    c = make_contract(100.0, OptionType.CALL, delta=0.5, oi=1000)
    dex = engine.dex_per_contract(arrays_of([c]), SPOT)
    assert float(dex[0]) == pytest.approx(5_000_000.0, abs=ABS_TOL)


def test_put_dex_sign_reflects_negative_delta_and_convention():
    c = make_contract(100.0, OptionType.PUT, delta=-0.5, oi=1000)
    dex = engine.dex_per_contract(arrays_of([c]), SPOT)
    # put_sign (-1) * delta (-0.5) -> positive under the default convention
    assert float(dex[0]) == pytest.approx(5_000_000.0, abs=ABS_TOL)


# ---------------------------------------------------------------- VGEX


def test_vgex_uses_volume_not_open_interest():
    c = make_contract(100.0, OptionType.CALL, gamma=0.05, oi=999_999, volume=200)
    v = engine.vgex_per_contract(arrays_of([c]), SPOT)
    assert float(v[0]) == pytest.approx(100_000.0, abs=ABS_TOL)


# ---------------------------------------------------------------- edge cases


def test_empty_chain_returns_zeroed_totals():
    t = engine.compute_totals(arrays_of([]), SPOT)
    assert (t.net_gex, t.call_gex, t.put_gex, t.absolute_gex) == (0.0, 0.0, 0.0, 0.0)
    assert engine.compute_by_strike(arrays_of([]), SPOT) == []
    assert engine.compute_by_expiry(arrays_of([]), SPOT) == []


def test_zero_open_interest_contributes_nothing():
    c = make_contract(100.0, OptionType.CALL, gamma=0.05, oi=0)
    assert engine.compute_totals(arrays_of([c]), SPOT).net_gex == 0.0


def test_missing_gamma_is_recovered_from_iv():
    c = make_contract(100.0, OptionType.CALL, gamma=0.0, oi=1000, iv=0.20, dte=365)
    a = arrays_of([c])
    assert a.gamma[0] == 0.0
    engine.fill_missing_greeks(a, SPOT, 0.05, 0.0)
    assert a.gamma[0] == pytest.approx(0.018762, abs=1e-4)


def test_missing_gamma_and_missing_iv_stays_zero_rather_than_guessing():
    c = make_contract(100.0, OptionType.CALL, gamma=0.0, oi=1000, iv=None)
    a = arrays_of([c])
    engine.fill_missing_greeks(a, SPOT, 0.05, 0.0)
    assert a.gamma[0] == 0.0
    assert engine.compute_totals(a, SPOT).net_gex == 0.0


def test_negative_open_interest_is_clamped_by_the_array_builder():
    c = make_contract(100.0, OptionType.CALL, gamma=0.05, oi=1000)
    c = c.model_copy(update={"open_interest": -500})
    assert arrays_of([c]).oi[0] == 0


def test_zero_dte_gets_a_nonzero_tenor_floor():
    c = make_contract(100.0, OptionType.CALL, dte=0.0)
    assert arrays_of([c]).tenor[0] > 0


# ---------------------------------------------------------------- filtering


def test_filter_by_max_dte():
    contracts = [
        make_contract(100.0, OptionType.CALL, dte=0.5),
        make_contract(100.0, OptionType.CALL, dte=7.0),
        make_contract(100.0, OptionType.CALL, dte=45.0),
    ]
    assert len(engine.filter_contracts(contracts, max_dte=7)) == 2


def test_filter_by_strike_band():
    contracts = [make_contract(k, OptionType.CALL) for k in (80.0, 98.0, 100.0, 102.0, 130.0)]
    kept = engine.filter_contracts(contracts, strike_band_pct=0.05, spot=SPOT)
    assert sorted(c.strike for c in kept) == [98.0, 100.0, 102.0]


def test_excluding_0dte_drops_same_day_expiries():
    contracts = [
        make_contract(100.0, OptionType.CALL, dte=0.3),
        make_contract(100.0, OptionType.CALL, dte=5.0),
    ]
    kept = engine.filter_contracts(contracts, include_0dte=False)
    assert len(kept) == 1 and kept[0].dte == 5.0


def test_dte0_selector_picks_only_same_session_contracts():
    contracts = [
        make_contract(100.0, OptionType.CALL, dte=0.0),
        make_contract(100.0, OptionType.CALL, dte=0.9),
        make_contract(100.0, OptionType.CALL, dte=1.5),
    ]
    assert len(engine.dte0_contracts(contracts)) == 2


# ---------------------------------------------------------------- profile


def test_profile_spans_the_requested_band_and_step_count():
    contracts = [make_contract(100.0, OptionType.CALL, gamma=0.0, oi=1000, iv=0.2, dte=30)]
    prices, net, calls, puts = engine.gamma_profile(
        arrays_of(contracts), SPOT, band_pct=0.10, steps=21
    )
    assert len(prices) == 21
    assert prices[0] == pytest.approx(90.0)
    assert prices[-1] == pytest.approx(110.0)
    assert len(net) == len(calls) == len(puts) == 21


def test_profile_call_and_put_legs_sum_to_net():
    contracts = [
        make_contract(95.0, OptionType.CALL, gamma=0.0, oi=1000, iv=0.2, dte=20),
        make_contract(105.0, OptionType.PUT, gamma=0.0, oi=2000, iv=0.25, dte=20),
    ]
    _, net, calls, puts = engine.gamma_profile(arrays_of(contracts), SPOT, steps=11)
    assert np.allclose(net, calls + puts, atol=1e-6)


def test_profile_of_a_call_only_book_is_positive_everywhere():
    contracts = [make_contract(100.0, OptionType.CALL, gamma=0.0, oi=1000, iv=0.2, dte=30)]
    _, net, _, _ = engine.gamma_profile(arrays_of(contracts), SPOT, steps=21)
    assert np.all(net >= 0)


def test_profile_skips_contracts_with_no_iv():
    contracts = [make_contract(100.0, OptionType.CALL, gamma=0.05, oi=1000, iv=None)]
    _, net, _, _ = engine.gamma_profile(arrays_of(contracts), SPOT, steps=11)
    assert np.allclose(net, 0.0)


def test_profile_of_an_empty_chain_is_flat_zero():
    _, net, _, _ = engine.gamma_profile(arrays_of([]), SPOT, steps=11)
    assert np.allclose(net, 0.0)


# ---------------------------------------------------------------- zero gamma


def test_zero_gamma_interpolates_between_samples_not_onto_the_grid():
    prices = np.array([90.0, 100.0, 110.0])
    net = np.array([-100.0, -50.0, 50.0])
    # Crossing sits three quarters of the way from 100 to 110.
    assert engine.find_zero_gamma(prices, net) == pytest.approx(105.0, abs=1e-9)


def test_zero_gamma_is_none_when_the_profile_never_crosses():
    prices = np.array([90.0, 100.0, 110.0])
    assert engine.find_zero_gamma(prices, np.array([10.0, 20.0, 30.0])) is None


def test_zero_gamma_picks_the_crossing_nearest_the_middle():
    prices = np.array([90.0, 95.0, 100.0, 105.0, 110.0])
    net = np.array([-10.0, 10.0, 5.0, -5.0, -20.0])
    # Two crossings exist; the one bracketing the centre of the range wins.
    assert engine.find_zero_gamma(prices, net) == pytest.approx(102.5, abs=1e-9)


def test_zero_gamma_handles_a_flat_segment_without_dividing_by_zero():
    prices = np.array([100.0, 110.0])
    assert engine.find_zero_gamma(prices, np.array([0.0, 0.0])) is None


def test_zero_gamma_needs_at_least_two_points():
    assert engine.find_zero_gamma(np.array([100.0]), np.array([5.0])) is None
