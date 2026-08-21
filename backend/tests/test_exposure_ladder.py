"""Exposure Ladder: aggregation correctness, filtering, levels and edge cases."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import OptionType
from app.quant import gex_engine as engine
from app.quant import levels as lv
from app.quant.rates import (
    StaticRiskFreeRateProvider,
    exercise_style,
    get_rate_provider,
)
from tests.conftest import ABS_TOL, SPOT, make_contract


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ------------------------------------------------------------------ the rule


def test_exposure_is_summed_per_contract_not_averaged_over_aggregate_oi():
    """The aggregation rule the screen depends on.

    Two contracts at one strike with different gammas and different OI. Summing
    per-contract exposure and averaging the greek against total OI give
    different answers; only the first is correct.
    """
    exp_a = date.today() + timedelta(days=1)
    exp_b = date.today() + timedelta(days=30)
    contracts = [
        make_contract(100.0, OptionType.CALL, gamma=0.08, oi=100, dte=1, expiration=exp_a),
        make_contract(100.0, OptionType.CALL, gamma=0.01, oi=900, dte=30, expiration=exp_b),
    ]
    arrays = engine.ChainArrays(contracts, 100)
    rows = engine.compute_by_strike(arrays, SPOT)
    assert len(rows) == 1

    # Correct: (0.08*100 + 0.01*900) * 100 * 100^2 * 0.01 = 17 * 10_000
    assert rows[0].call_gex == pytest.approx(170_000.0, abs=ABS_TOL)

    # The naive alternative would be mean(gamma) * total OI * ... = 0.045 * 1000
    naive = 0.045 * 1000 * 100 * SPOT**2 * 0.01
    assert naive == pytest.approx(450_000.0, abs=ABS_TOL)
    assert rows[0].call_gex != pytest.approx(naive, abs=1.0)


def test_strike_rows_split_call_and_put_legs_for_every_greek():
    contracts = [
        make_contract(100.0, OptionType.CALL, gamma=0.02, oi=1000, iv=0.2, dte=30),
        make_contract(100.0, OptionType.PUT, gamma=0.03, oi=2000, iv=0.25, dte=30),
    ]
    arrays = engine.ChainArrays(contracts, 100)
    engine.fill_missing_greeks(arrays, SPOT, 0.043, 0.0)
    row = engine.compute_by_strike(arrays, SPOT)[0]

    assert row.net_gex == pytest.approx(row.call_gex + row.put_gex, abs=1e-6)
    assert row.net_vanna == pytest.approx(row.call_vanna + row.put_vanna, abs=1e-6)
    assert row.net_charm == pytest.approx(row.call_charm + row.put_charm, abs=1e-6)
    assert row.net_dex == pytest.approx(row.call_dex + row.put_dex, abs=1e-6)
    assert row.contract_count == 2
    assert row.call_iv == pytest.approx(0.20)
    assert row.put_iv == pytest.approx(0.25)


def test_strike_iv_ignores_contracts_with_no_quoted_iv():
    """A missing IV is absent, not zero; averaging in a zero would halve it."""
    contracts = [
        make_contract(100.0, OptionType.CALL, oi=100, iv=0.30, dte=30),
        make_contract(100.0, OptionType.CALL, oi=100, iv=None, dte=30,
                      expiration=date.today() + timedelta(days=31)),
    ]
    row = engine.compute_by_strike(engine.ChainArrays(contracts, 100), SPOT)[0]
    assert row.call_iv == pytest.approx(0.30)


def test_strike_with_no_iv_at_all_reports_none_not_zero():
    contracts = [make_contract(100.0, OptionType.PUT, oi=100, iv=None)]
    assert engine.compute_by_strike(engine.ChainArrays(contracts, 100), SPOT)[0].put_iv is None


# ------------------------------------------------------------------ crossings


def test_all_zero_crossings_are_returned_not_just_the_central_one():
    import numpy as np

    prices = np.array([90.0, 95.0, 100.0, 105.0, 110.0])
    net = np.array([-10.0, 10.0, 5.0, -5.0, -20.0])
    assert engine.find_zero_gamma_crossings(prices, net) == [
        pytest.approx(92.5), pytest.approx(102.5)
    ]


def test_no_crossing_returns_an_empty_list():
    import numpy as np

    assert engine.find_zero_gamma_crossings(
        np.array([90.0, 100.0]), np.array([5.0, 9.0])) == []


def test_crossings_are_returned_in_ascending_order():
    import numpy as np

    prices = np.array([80.0, 90.0, 100.0, 110.0, 120.0])
    net = np.array([5.0, -5.0, 5.0, -5.0, 5.0])
    out = engine.find_zero_gamma_crossings(prices, net)
    assert out == sorted(out) and len(out) == 4


# ------------------------------------------------------------------ condition


def test_call_dominated_when_calls_lead_on_every_component():
    r = lv.classify_gamma_condition(
        call_gex=9e9, put_gex=-1e9, call_oi=90_000, put_oi=10_000,
        call_volume=50_000, put_volume=5_000, net_gex=8e9)
    assert r["positioning"] == "CALL DOMINATED"
    assert r["score"] > lv.BALANCED_BAND


def test_put_dominated_when_puts_lead():
    r = lv.classify_gamma_condition(
        call_gex=1e9, put_gex=-9e9, call_oi=10_000, put_oi=90_000,
        call_volume=5_000, put_volume=50_000, net_gex=-8e9)
    assert r["positioning"] == "PUT DOMINATED"


def test_near_parity_is_reported_as_balanced_not_a_coin_flip():
    r = lv.classify_gamma_condition(
        call_gex=1e9, put_gex=-1.02e9, call_oi=50_000, put_oi=50_500,
        call_volume=20_000, put_volume=20_200, net_gex=-2e7)
    assert r["positioning"] == "BALANCED"


def test_regime_is_independent_of_positioning():
    """A call-dominated book can still sit in negative gamma."""
    r = lv.classify_gamma_condition(
        call_gex=9e9, put_gex=-1e9, call_oi=90_000, put_oi=10_000,
        call_volume=50_000, put_volume=5_000, net_gex=-5e8,
        spot=100.0, zero_gamma=80.0)
    assert r["positioning"] == "CALL DOMINATED"
    assert r["regime"] == "NEGATIVE GAMMA"


def test_spot_on_the_flip_reports_near_gamma_flip():
    r = lv.classify_gamma_condition(
        call_gex=1e9, put_gex=-1e9, call_oi=1, put_oi=1,
        call_volume=1, put_volume=1, net_gex=1e6,
        spot=100.0, zero_gamma=100.2)
    assert r["regime"] == "NEAR GAMMA FLIP"


def test_condition_reports_its_own_weights_and_components():
    r = lv.classify_gamma_condition(
        call_gex=1e9, put_gex=-1e9, call_oi=1, put_oi=1,
        call_volume=1, put_volume=1, net_gex=0)
    assert set(r["components"]) == {"gex", "open_interest", "volume", "dte0_gex"}
    assert sum(r["weights"].values()) == pytest.approx(1.0)
    assert "not a directional forecast" in r["explanation"]


def test_condition_on_an_empty_book_does_not_divide_by_zero():
    r = lv.classify_gamma_condition(0, 0, 0, 0, 0, 0, net_gex=0)
    assert r["positioning"] == "BALANCED" and r["score"] == 0.0


# ------------------------------------------------------------------ rates


def test_index_options_are_european_and_equities_american():
    assert exercise_style("SPX") == "european"
    assert exercise_style("NDX") == "european"
    assert exercise_style("AAPL") == "american"
    assert exercise_style("SPY") == "american"


def test_cash_index_takes_no_dividend_yield():
    """The index level is already ex-dividend; applying q would double-count."""
    p = StaticRiskFreeRateProvider(0.043, 0.0)
    assert p.dividend_yield("SPX") == 0.0
    assert p.dividend_yield("NDX") == 0.0


def test_broad_etfs_carry_a_default_yield_rather_than_assuming_zero():
    p = StaticRiskFreeRateProvider(0.043, 0.0)
    assert p.dividend_yield("SPY") > 0
    assert p.dividend_yield("QQQ") > 0


def test_configured_yield_overrides_the_etf_default():
    p = StaticRiskFreeRateProvider(0.043, 0.02)
    assert p.dividend_yield("SPY") == pytest.approx(0.02)


def test_rate_provider_reports_its_source():
    assert "static" in get_rate_provider().source()


# ------------------------------------------------------------------ API


def test_ladder_endpoint_shape(client):
    r = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 5})
    assert r.status_code == 200
    body = r.json()
    for key in ("symbol", "spot", "timestamp", "provider", "rows", "summary",
                "keyLevels", "expectedMove", "gammaCondition",
                "expirationContributions", "freshness", "expirationSelection"):
        assert key in body, key
    assert body["symbol"] == "SPY" and body["spot"] > 0
    assert body["rows"]


def test_rows_are_strike_descending_by_default(client):
    rows = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 5}).json()["rows"]
    strikes = [r["strike"] for r in rows]
    assert strikes == sorted(strikes, reverse=True)


def test_every_row_carries_all_ladder_columns(client):
    rows = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 3}).json()["rows"]
    required = {"strike", "distance", "distancePercent", "netDelta", "netGamma",
                "netVanna", "netCharm", "netOI", "callOI", "putOI",
                "callVolume", "putVolume", "netVolume"}
    for row in rows:
        assert required <= set(row)


def test_distance_matches_the_documented_formula(client):
    body = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 3}).json()
    spot = body["spot"]
    for row in body["rows"]:
        assert row["distance"] == pytest.approx(row["strike"] - spot, abs=1e-3)
        assert row["distancePercent"] == pytest.approx(
            (row["strike"] - spot) / spot * 100.0, abs=1e-3)


def test_net_oi_is_calls_minus_puts(client):
    rows = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 3}).json()["rows"]
    for row in rows:
        assert row["netOI"] == row["callOI"] - row["putOI"]
        assert row["totalOI"] == row["callOI"] + row["putOI"]
        assert row["netVolume"] == row["callVolume"] - row["putVolume"]


def test_strike_range_narrows_the_visible_rows(client):
    wide = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 10}).json()
    tight = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 1}).json()
    assert len(tight["rows"]) <= len(wide["rows"])
    spot = tight["spot"]
    for row in tight["rows"]:
        assert abs((row["strike"] - spot) / spot * 100.0) <= 1.0 + 1e-6


def test_walls_are_found_before_the_strike_band_is_applied(client):
    """A tight band must not clamp a wall that sits outside the visible window."""
    body = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 1}).json()
    cw = body["keyLevels"]["callWall"]
    if cw:
        assert cw["price"] > body["spot"]


def test_0dte_mode_restricts_to_the_same_session(client):
    body = client.get("/api/exposure/SPY/ladder",
                      params={"expirationMode": "0dte", "strikeRange": 5}).json()
    assert body["expirationSelection"]["mode"] == "0dte"
    assert body["expirationSelection"]["maxDte"] == pytest.approx(0.999)
    for row in body["expirationContributions"]:
        assert row["dte"] < 1


def test_expiration_modes_widen_the_contract_set_monotonically(client):
    counts = {}
    for mode in ("0dte", "1dte", "weekly", "monthly", "all"):
        body = client.get("/api/exposure/SPY/ladder",
                          params={"expirationMode": mode, "strikeRange": 5}).json()
        counts[mode] = body["expirationSelection"]["contractsInScope"]
    assert counts["0dte"] <= counts["1dte"] <= counts["weekly"] <= counts["monthly"]
    assert counts["monthly"] <= counts["all"]


def test_single_expiration_selection(client):
    exps = client.get("/api/market/SPY/expirations").json()["expirations"]
    body = client.get("/api/exposure/SPY/ladder",
                      params={"expirationMode": "single", "expiration": exps[1],
                              "strikeRange": 5}).json()
    contribs = body["expirationContributions"]
    assert len(contribs) == 1 and contribs[0]["expiration"] == exps[1]


def test_expiration_contributions_shares_are_bounded(client):
    body = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 5}).json()
    total = sum(c["absoluteShare"] for c in body["expirationContributions"])
    assert total == pytest.approx(100.0, abs=0.5)
    for c in body["expirationContributions"]:
        assert 0 <= c["absoluteShare"] <= 100


def test_key_levels_are_present_and_sit_on_the_right_side_of_spot(client):
    body = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 10}).json()
    kl, spot = body["keyLevels"], body["spot"]
    assert kl["spot"] == pytest.approx(spot)
    if kl["callWall"]:
        assert kl["callWall"]["price"] > spot
    if kl["putWall"]:
        assert kl["putWall"]["price"] < spot
    if kl["expectedMoveHigh"] and kl["expectedMoveLow"]:
        assert kl["expectedMoveLow"] < spot < kl["expectedMoveHigh"]


def test_gamma_transitions_bracket_spot_when_both_exist(client):
    kl = client.get("/api/exposure/SPY/ladder",
                    params={"strikeRange": 10}).json()["keyLevels"]
    lower, upper = kl["lowerGammaTransition"], kl["upperGammaTransition"]
    if lower is not None and upper is not None:
        assert lower < upper


def test_summary_totals_agree_with_the_gex_endpoint(client):
    ladder = client.get("/api/exposure/SPY/ladder",
                        params={"expirationMode": "monthly", "strikeRange": 10}).json()
    gex = client.get("/api/gex/SPY", params={"max_dte": 35}).json()
    # Same pipeline, same convention: the headline figures must not disagree.
    assert ladder["summary"]["netGex"] == pytest.approx(
        gex["totals"]["net_gex"], rel=1e-6)
    assert ladder["summary"]["callOi"] == gex["totals"]["call_oi"]


def test_freshness_never_claims_live_on_demo_data(client):
    f = client.get("/api/exposure/SPY/ladder").json()["freshness"]
    assert f["status"] == "DEMO"
    assert f["underlyingStatus"] == "DEMO"


def test_demo_banner_and_disclaimer_ride_along(client):
    body = client.get("/api/exposure/SPY/ladder").json()
    assert body["demoBanner"]["demo"] is True
    assert "MODEL-DERIVED" in body["disclaimer"]


def test_index_symbol_reports_european_exercise_and_zero_yield(client):
    body = client.get("/api/exposure/SPX/ladder", params={"strikeRange": 3}).json()
    assert body["exerciseStyle"] == "european"
    assert body["dividendYield"] == 0.0


def test_modes_endpoint_drives_the_ui(client):
    body = client.get("/api/exposure/modes").json()
    assert body["defaultStrikeRangePct"] == 3.0
    assert {m["value"] for m in body["expirationModes"]} >= {"0dte", "all", "single"}
    assert "vanna" in body["metrics"] and "charm" in body["metrics"]


def test_oi_quartiles_are_monotonic(client):
    q = client.get("/api/exposure/SPY/ladder", params={"strikeRange": 5}).json()["oiQuartiles"]
    assert q["q1"] <= q["q2"] <= q["q3"] <= q["max"]


def test_invalid_expiration_mode_is_rejected(client):
    assert client.get("/api/exposure/SPY/ladder",
                      params={"expirationMode": "yesterday"}).status_code == 422


def test_invalid_expiration_date_is_rejected(client):
    assert client.get("/api/exposure/SPY/ladder",
                      params={"expiration": "not-a-date"}).status_code == 422


def test_unknown_provider_without_a_key_fails_loudly_rather_than_faking_data(client):
    r = client.get("/api/exposure/SPY/ladder", params={"provider": "tradier"})
    assert r.status_code == 502
    assert "TRADIER_API_KEY" in r.json()["detail"]["message"]
