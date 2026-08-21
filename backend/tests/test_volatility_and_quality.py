"""Expected move, IV analytics, data-quality gate, and flow classification."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.models import DelayStatus, OptionType
from app.quant import flow, quality, volatility
from tests.conftest import SPOT, make_contract

# ---------------------------------------------------------------- expected move


def test_expected_move_is_the_atm_straddle():
    exp = date.today() + timedelta(days=7)
    call = make_contract(100.0, OptionType.CALL, expiration=exp, dte=7)
    put = make_contract(100.0, OptionType.PUT, expiration=exp, dte=7)
    call = call.model_copy(update={"mid": 2.0})
    put = put.model_copy(update={"mid": 1.5})

    em = volatility.expected_move([call, put], SPOT)
    assert em.straddle == pytest.approx(3.5)
    assert em.move_abs == pytest.approx(3.5)
    assert em.move_pct == pytest.approx(3.5)
    assert em.upper == pytest.approx(103.5)
    assert em.lower == pytest.approx(96.5)


def test_expected_move_picks_the_strike_nearest_spot_with_both_legs():
    exp = date.today() + timedelta(days=7)
    # 100 has only a call; 105 has both, so 105 must be chosen.
    contracts = [
        make_contract(100.0, OptionType.CALL, expiration=exp, dte=7),
        make_contract(105.0, OptionType.CALL, expiration=exp, dte=7),
        make_contract(105.0, OptionType.PUT, expiration=exp, dte=7),
    ]
    assert volatility.expected_move(contracts, SPOT).atm_strike == 105.0


def test_expected_move_falls_back_to_bid_ask_midpoint():
    exp = date.today() + timedelta(days=7)
    call = make_contract(100.0, OptionType.CALL, expiration=exp, dte=7).model_copy(
        update={"mid": None, "bid": 1.9, "ask": 2.1})
    put = make_contract(100.0, OptionType.PUT, expiration=exp, dte=7).model_copy(
        update={"mid": None, "bid": 1.4, "ask": 1.6})
    assert volatility.expected_move([call, put], SPOT).straddle == pytest.approx(3.5)


def test_expected_move_uses_the_nearest_expiry_by_default():
    near = date.today() + timedelta(days=1)
    far = date.today() + timedelta(days=30)
    contracts = [
        make_contract(100.0, OptionType.CALL, expiration=near, dte=1),
        make_contract(100.0, OptionType.PUT, expiration=near, dte=1),
        make_contract(100.0, OptionType.CALL, expiration=far, dte=30),
        make_contract(100.0, OptionType.PUT, expiration=far, dte=30),
    ]
    assert volatility.expected_move(contracts, SPOT).expiration == near


def test_expected_move_on_an_empty_chain_is_none():
    assert volatility.expected_move([], SPOT) is None


def test_expected_move_reports_when_no_quotes_are_available():
    exp = date.today() + timedelta(days=7)
    bare = make_contract(100.0, OptionType.CALL, expiration=exp, dte=7).model_copy(
        update={"mid": None, "bid": None, "ask": None, "last": None})
    em = volatility.expected_move([bare], SPOT)
    assert em.straddle is None and "no quotes" in em.method


# ---------------------------------------------------------------- IV


def test_iv_summary_computes_atm_and_term_structure():
    near = date.today() + timedelta(days=7)
    far = date.today() + timedelta(days=60)
    contracts = [
        make_contract(100.0, OptionType.CALL, expiration=near, dte=7, iv=0.20),
        make_contract(100.0, OptionType.PUT, expiration=near, dte=7, iv=0.22),
        make_contract(100.0, OptionType.CALL, expiration=far, dte=60, iv=0.25),
    ]
    s = volatility.iv_summary(contracts, SPOT)
    assert s.atm_iv == pytest.approx(0.21)
    assert s.call_atm_iv == pytest.approx(0.20)
    assert s.put_atm_iv == pytest.approx(0.22)
    assert len(s.term_structure) == 2
    assert s.term_structure[0]["dte"] < s.term_structure[1]["dte"]


def test_risk_reversal_is_the_25_delta_call_minus_put_iv():
    exp = date.today() + timedelta(days=30)
    contracts = [
        make_contract(110.0, OptionType.CALL, expiration=exp, dte=30, iv=0.18, delta=0.25),
        make_contract(90.0, OptionType.PUT, expiration=exp, dte=30, iv=0.28, delta=-0.25),
        make_contract(100.0, OptionType.CALL, expiration=exp, dte=30, iv=0.20, delta=0.50),
        make_contract(100.0, OptionType.PUT, expiration=exp, dte=30, iv=0.21, delta=-0.50),
    ]
    s = volatility.iv_summary(contracts, SPOT)
    assert s.iv_25d_call == pytest.approx(0.18)
    assert s.iv_25d_put == pytest.approx(0.28)
    assert s.risk_reversal_25d == pytest.approx(-0.10)


def test_iv_summary_with_no_iv_returns_empty_rather_than_failing():
    contracts = [make_contract(100.0, OptionType.CALL, iv=None)]
    assert volatility.iv_summary(contracts, SPOT).atm_iv is None


# ---------------------------------------------------------------- quality


def test_quality_gate_drops_duplicate_contracts():
    c = make_contract(100.0, OptionType.CALL)
    clean, report = quality.validate_chain([c, c], "TEST", SPOT)
    assert len(clean) == 1
    assert any(i["code"] == "duplicate_contract" for i in report.issues)


def test_quality_gate_rejects_a_mismatched_underlying():
    c = make_contract(100.0, OptionType.CALL, underlying="OTHER")
    clean, report = quality.validate_chain([c], "TEST", SPOT)
    assert clean == []
    assert not report.ok


def test_quality_gate_clamps_negative_volume():
    c = make_contract(100.0, OptionType.CALL).model_copy(update={"volume": -5})
    clean, report = quality.validate_chain([c], "TEST", SPOT)
    assert clean[0].volume == 0
    assert any(i["code"] == "negative_volume" for i in report.issues)


def test_quality_gate_discards_implausible_iv():
    c = make_contract(100.0, OptionType.CALL, iv=9.0)
    clean, _ = quality.validate_chain([c], "TEST", SPOT)
    assert clean[0].iv is None


def test_quality_gate_defaults_a_missing_multiplier():
    c = make_contract(100.0, OptionType.CALL).model_copy(update={"multiplier": 0})
    clean, _ = quality.validate_chain([c], "TEST", SPOT)
    assert clean[0].multiplier == 100


def test_quality_gate_flags_a_stale_quote():
    old = datetime.now(UTC) - timedelta(hours=3)
    c = make_contract(100.0, OptionType.CALL).model_copy(update={"quote_timestamp": old})
    _, report = quality.validate_chain([c], "TEST", SPOT)
    assert any(i["code"] == "stale_quote" for i in report.issues)


def test_quality_gate_flags_a_crossed_quote():
    c = make_contract(100.0, OptionType.CALL).model_copy(update={"bid": 2.0, "ask": 1.0})
    _, report = quality.validate_chain([c], "TEST", SPOT)
    assert any(i["code"] == "crossed_quote" for i in report.issues)


def test_quality_gate_treats_an_empty_chain_as_an_error():
    _, report = quality.validate_chain([], "TEST", SPOT)
    assert not report.ok


def test_freshness_resolution_reports_the_worst_status():
    live = make_contract(100.0, OptionType.CALL).model_copy(
        update={"delay_status": DelayStatus.LIVE})
    delayed = make_contract(105.0, OptionType.CALL).model_copy(
        update={"delay_status": DelayStatus.DELAYED_15M})
    assert quality.resolve_freshness([live, delayed]) == DelayStatus.DELAYED_15M
    assert quality.resolve_freshness([live]) == DelayStatus.LIVE


# ---------------------------------------------------------------- flow


@pytest.mark.parametrize(
    "price,expected",
    [(1.00, "at_bid"), (2.00, "at_ask"), (1.50, "at_mid"),
     (1.80, "above_mid"), (1.20, "below_mid")],
)
def test_aggressor_classification(price, expected):
    assert flow.classify_aggressor(price, bid=1.00, ask=2.00) == expected


def test_aggressor_is_unknown_without_a_two_sided_quote():
    assert flow.classify_aggressor(1.5, None, 2.0) == "unknown"
    assert flow.classify_aggressor(1.5, 2.0, 1.0) == "unknown"


def test_premium_is_price_times_size_times_multiplier():
    from app.models import OptionTrade

    t = OptionTrade(
        timestamp=datetime.now(UTC), option_symbol="X", underlying="TEST",
        type=OptionType.CALL, strike=100.0, expiration=date.today() + timedelta(days=1),
        dte=1.0, price=2.50, size=100, multiplier=100,
    )
    assert t.premium == pytest.approx(25_000.0)
    assert flow.filter_by_premium([t], 50_000) == []
    assert flow.filter_by_premium([t], 10_000) == [t]


def test_flow_summary_of_no_trades_is_zeroed_not_an_error():
    s = flow.summarise_flow([])
    assert s["count"] == 0 and s["total_premium"] == 0.0
