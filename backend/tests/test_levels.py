"""Call/put wall selection, concentration, pin risk, regime, ratios."""

from __future__ import annotations

import pytest

from app.models import StrikeGex
from app.quant import levels as lv
from tests.conftest import SPOT


def row(strike, call_gex=0.0, put_gex=0.0, call_oi=0, put_oi=0, call_vol=0, put_vol=0):
    return StrikeGex(
        strike=strike,
        call_gex=call_gex,
        put_gex=put_gex,
        net_gex=call_gex + put_gex,
        call_oi=call_oi,
        put_oi=put_oi,
        total_oi=call_oi + put_oi,
        call_volume=call_vol,
        put_volume=put_vol,
    )


# ---------------------------------------------------------------- distances


def test_level_carries_absolute_and_percentage_distance():
    level = lv.make_level("Call Wall", 610.0, 605.5)
    assert level.distance == pytest.approx(4.5, abs=1e-9)
    assert level.distance_pct == pytest.approx(4.5 / 605.5 * 100, abs=1e-9)


def test_level_with_no_price_has_no_distance():
    level = lv.make_level("Call Wall", None, 605.5)
    assert level.price is None and level.distance is None and level.distance_pct is None


# ---------------------------------------------------------------- walls


def test_call_wall_picks_the_dominant_strike_above_spot():
    rows = [
        row(95.0, call_gex=9_000_000, call_oi=90_000),   # below spot - ineligible
        row(105.0, call_gex=1_000_000, call_oi=1_000),
        row(110.0, call_gex=8_000_000, call_oi=20_000),
        row(115.0, call_gex=500_000, call_oi=500),
    ]
    assert lv.call_wall(rows, SPOT).price == 110.0


def test_call_wall_is_never_below_spot():
    rows = [row(90.0, call_gex=9e9, call_oi=999_999), row(105.0, call_gex=1.0, call_oi=1)]
    assert lv.call_wall(rows, SPOT).price == 105.0


def test_put_wall_picks_the_dominant_strike_below_spot():
    rows = [
        row(90.0, put_gex=-8_000_000, put_oi=30_000),
        row(95.0, put_gex=-1_000_000, put_oi=2_000),
        row(110.0, put_gex=-9_000_000, put_oi=90_000),  # above spot - ineligible
    ]
    assert lv.put_wall(rows, SPOT).price == 90.0


def test_wall_returns_none_when_no_strikes_sit_on_that_side():
    rows = [row(90.0, put_gex=-1e6, put_oi=1000)]
    wall = lv.call_wall(rows, SPOT)
    assert wall.price is None and wall.note


def test_wall_prefers_a_near_strike_over_a_marginally_larger_distant_one():
    # Proximity weighting exists so leftover far OTM open interest cannot win.
    rows = [row(102.0, call_gex=9_000_000, call_oi=50_000),
            row(160.0, call_gex=9_500_000, call_oi=52_000)]
    assert lv.call_wall(rows, SPOT).price == 102.0


def test_wall_confidence_is_high_when_one_strike_dominates():
    rows = [row(105.0, call_gex=10_000_000, call_oi=50_000),
            row(106.0, call_gex=100_000, call_oi=500)]
    assert lv.call_wall(rows, SPOT).confidence == "high"


def test_wall_confidence_is_low_when_two_strikes_are_close():
    rows = [row(105.0, call_gex=5_000_000, call_oi=10_000),
            row(105.5, call_gex=4_980_000, call_oi=10_000)]
    assert lv.call_wall(rows, SPOT).confidence in ("low", "medium")


def test_0dte_concentration_can_pull_the_call_wall():
    # The boost is capped at +35%, so it decides between near-equal candidates
    # rather than overriding a large proximity gap.
    rows = [row(103.0, call_gex=5_000_000, call_oi=10_000),
            row(104.0, call_gex=4_600_000, call_oi=9_000)]
    without = lv.call_wall(rows, SPOT).price
    with_boost = lv.call_wall(rows, SPOT, {104.0: 9_000_000.0}).price
    assert without == 103.0
    assert with_boost == 104.0


def test_0dte_boost_cannot_override_a_large_proximity_gap():
    rows = [row(102.0, call_gex=5_000_000, call_oi=10_000),
            row(140.0, call_gex=4_600_000, call_oi=9_000)]
    assert lv.call_wall(rows, SPOT, {140.0: 9_000_000.0}).price == 102.0


def test_wall_on_an_empty_chain_is_empty_not_an_error():
    assert lv.call_wall([], SPOT).price is None
    assert lv.put_wall([], SPOT).price is None


# ---------------------------------------------------------------- top strikes


def test_top_gamma_splits_positive_and_negative_and_ranks_by_magnitude():
    rows = [row(k, call_gex=g) for k, g in
            [(101.0, 5e6), (102.0, 3e6), (103.0, 7e6)]]
    rows += [row(k, put_gex=g) for k, g in [(98.0, -6e6), (97.0, -2e6)]]
    tops = lv.top_gamma_strikes(rows, SPOT, n=2)
    assert [t.price for t in tops["positive"]] == [103.0, 101.0]
    assert [t.price for t in tops["negative"]] == [98.0, 97.0]


def test_largest_by_open_interest_is_tagged_as_observed():
    rows = [row(105.0, call_oi=50_000), row(110.0, call_oi=90_000)]
    level = lv.largest_by(rows, "call_oi", SPOT, "Largest Call OI")
    assert level.price == 110.0
    assert level.origin.value == "observed"


# ---------------------------------------------------------------- concentration


def test_concentration_bands_are_cumulative_and_share_reaches_100():
    rows = [row(99.5, call_gex=1e6), row(100.5, call_gex=1e6), row(120.0, call_gex=2e6)]
    bands = lv.gamma_concentration(rows, SPOT, bands=(1.0, 5.0, 50.0))
    assert bands[0].absolute_gex == pytest.approx(2e6)
    assert bands[0].share_of_absolute == pytest.approx(50.0)
    assert bands[-1].share_of_absolute == pytest.approx(100.0)


def test_concentration_on_an_empty_chain_is_empty():
    assert lv.gamma_concentration([], SPOT) == []


# ---------------------------------------------------------------- pin risk


def test_pin_risk_is_high_next_to_a_dominant_strike_at_expiry():
    rows = [row(100.0, call_gex=10e6), row(90.0, call_gex=1e5)]
    pin = lv.pin_risk(rows, 100.02, min_dte=0.1, dte0_share=0.9)
    assert pin.level == "High"
    assert pin.nearest_strike == 100.0
    assert pin.explanation


def test_pin_risk_is_low_when_spot_is_far_from_any_gamma():
    rows = [row(150.0, call_gex=10e6)]
    assert lv.pin_risk(rows, SPOT, min_dte=30.0, dte0_share=0.0).level == "Low"


def test_pin_risk_on_an_empty_chain_explains_itself():
    pin = lv.pin_risk([], SPOT, min_dte=1.0)
    assert pin.level == "Low" and "No chain data" in pin.explanation


def test_pin_risk_with_all_zero_gamma_does_not_divide_by_zero():
    assert lv.pin_risk([row(100.0)], SPOT, min_dte=0.1).level == "Low"


# ---------------------------------------------------------------- regime


def test_positive_net_gex_far_from_flip_is_positive_gamma():
    r = lv.classify_regime(5e9, 100.0, 80.0)
    assert r.regime == "POSITIVE GAMMA"


def test_negative_net_gex_far_from_flip_is_negative_gamma():
    assert lv.classify_regime(-5e9, 100.0, 120.0).regime == "NEGATIVE GAMMA"


def test_spot_sitting_on_the_flip_is_classified_as_near_flip():
    r = lv.classify_regime(1e9, 100.0, 100.2)
    assert r.regime == "NEUTRAL / NEAR FLIP"
    assert r.distance_to_flip_pct == pytest.approx(-0.2, abs=1e-9)


def test_regime_works_with_no_flip_level_available():
    r = lv.classify_regime(1e9, 100.0, None)
    assert r.regime == "POSITIVE GAMMA" and r.distance_to_flip_pct is None


def test_regime_flags_when_same_day_gamma_dominates():
    r = lv.classify_regime(1e9, 100.0, 80.0, dte0_net_gex=0.9e9)
    assert "Same-day" in r.explanation


# ---------------------------------------------------------------- ratios


def test_put_call_ratios():
    r = lv.put_call_ratios(call_volume=1000, put_volume=1500, call_oi=2000, put_oi=1000)
    assert r.volume_ratio == pytest.approx(1.5)
    assert r.oi_ratio == pytest.approx(0.5)


def test_ratios_are_none_rather_than_infinite_when_the_denominator_is_zero():
    r = lv.put_call_ratios(call_volume=0, put_volume=100, call_oi=0, put_oi=50)
    assert r.volume_ratio is None and r.oi_ratio is None
