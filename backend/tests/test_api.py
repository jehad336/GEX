"""End-to-end API tests against the demo provider.

These exercise the whole pipeline: provider -> quality -> engine -> levels -> HTTP.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_reports_the_active_provider(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_config_never_leaks_an_api_key(client):
    body = r.text if (r := client.get("/api/config")).status_code == 200 else ""
    assert "api_key" not in body.lower()
    assert "MASSIVE_API_KEY" not in body


def test_symbol_search_finds_a_default_symbol(client):
    r = client.get("/api/symbols/search", params={"q": "SP"})
    assert r.status_code == 200
    assert any(x["symbol"] == "SPY" for x in r.json()["results"])


def test_underlying_quote(client):
    r = client.get("/api/market/SPY")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "SPY" and body["price"] > 0


def test_demo_data_is_never_labelled_live(client):
    body = client.get("/api/market/SPY").json()
    assert body["delay_status"] == "DEMO"


def test_gex_snapshot_shape(client):
    r = client.get("/api/gex/SPY", params={"max_dte": 30})
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "SPY"
    assert body["spot"] > 0
    assert "net_gex" in body["totals"]
    assert body["regime"]["regime"] in (
        "POSITIVE GAMMA", "NEGATIVE GAMMA", "NEUTRAL / NEAR FLIP", "NEUTRAL"
    )
    for key in ("gamma_flip", "call_wall", "put_wall", "pin_risk"):
        assert key in body["levels"]


def test_snapshot_ships_the_model_disclaimer(client):
    body = client.get("/api/gex/SPY", params={"max_dte": 7}).json()
    assert "MODEL-DERIVED" in body["disclaimer"]
    assert body["demo_banner"]["demo"] is True


def test_walls_sit_on_the_correct_side_of_spot(client):
    body = client.get("/api/gex/SPY", params={"max_dte": 30}).json()
    spot = body["spot"]
    cw = body["levels"]["call_wall"]["price"]
    pw = body["levels"]["put_wall"]["price"]
    assert cw is None or cw > spot
    assert pw is None or pw < spot


def test_by_strike_rows_are_sorted_and_sum_consistently(client):
    r = client.get("/api/gex/SPY/by-strike", params={"max_dte": 7})
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert rows
    assert [x["strike"] for x in rows] == sorted(x["strike"] for x in rows)
    for row in rows:
        assert row["net_gex"] == pytest.approx(row["call_gex"] + row["put_gex"], rel=1e-9)


def test_by_expiry_buckets(client):
    body = client.get("/api/gex/SPY/by-expiry", params={"max_dte": 45}).json()
    assert body["rows"]
    assert set(body["buckets"]) == {"dte0", "dte1", "weekly", "monthly"}


def test_gamma_profile_returns_the_requested_grid(client):
    body = client.get(
        "/api/gex/SPY/profile", params={"max_dte": 30, "band_pct": 0.08, "steps": 41}
    ).json()
    assert len(body["points"]) == 41
    prices = [p["price"] for p in body["points"]]
    assert prices == sorted(prices)
    assert prices[0] == pytest.approx(body["spot"] * 0.92, rel=1e-9)


def test_levels_endpoint_includes_concentration_and_pin_risk(client):
    body = client.get("/api/gex/SPY/levels", params={"max_dte": 30}).json()
    assert len(body["concentration"]) == 4
    assert body["pin_risk"]["level"] in ("Low", "Medium", "High")
    assert body["top_gamma"]["positive"] or body["top_gamma"]["negative"]


def test_0dte_panel(client):
    body = client.get("/api/gex/SPY/0dte").json()
    # The demo provider always lists a same-day expiry.
    assert body["available"] is True
    assert body["dte"] < 1
    assert "largest_call_gamma" in body["key_strikes"]


def test_heatmap_is_aggregated_server_side(client):
    body = client.get("/api/gex/SPY/heatmap", params={"max_dte": 14}).json()
    assert body["expirations"] and body["strikes"] and body["cells"]
    for cell in body["cells"][:20]:
        assert 0 <= cell["x"] < len(body["expirations"])
        assert 0 <= cell["y"] < len(body["strikes"])


def test_opportunity_scan_is_typed_and_never_claims_to_place_an_order(client):
    response = client.get("/api/opportunities/SPY")
    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "SPY"
    assert body["scanning"] is True
    assert body["minimum_score"] == 65
    assert body["demo"] is True
    assert "no order" in body["delivery"]
    for row in body["records"]:
        assert 65 <= row["score"] <= 100
        assert row["status"] == "analytical_candidate"
        assert row["option_symbol"]
        assert row["reasons"]


def test_option_chain_is_capped_by_limit(client):
    body = client.get("/api/options/SPY/chain", params={"max_dte": 30, "limit": 50}).json()
    assert body["returned"] <= 50
    assert body["total_contracts"] >= body["returned"]


def test_open_interest_reports_its_as_of_timestamp(client):
    body = client.get("/api/options/SPY/oi", params={"max_dte": 7}).json()
    assert body["call_oi"] > 0
    assert "previous reporting session" in body["oi_note"]
    assert body["origin"] == "observed"


def test_volume_endpoint_flags_unusual_activity(client):
    body = client.get("/api/options/SPY/volume", params={"max_dte": 7}).json()
    assert body["total_volume"] > 0
    assert isinstance(body["unusual"], list)


def test_iv_endpoint_explains_missing_iv_rank_without_orats(client):
    body = client.get("/api/options/SPY/iv", params={"max_dte": 30}).json()
    assert body["atm_iv"] > 0
    assert body["term_structure"]
    assert body["historical"] is None
    assert "ORATS_API_KEY" in body["historical_note"]


def test_expected_move_endpoint(client):
    body = client.get("/api/options/SPY/expected-move", params={"max_dte": 30}).json()
    assert body["selected"]["move_abs"] > 0
    assert body["selected"]["upper"] > body["spot"] > body["selected"]["lower"]


def test_flow_endpoint_refuses_to_imply_direction(client):
    body = client.get("/api/options/SPY/flow", params={"limit": 25}).json()
    assert body["available"] is True
    assert len(body["trades"]) <= 25
    assert "does not mean bullish" in body["note"]
    for t in body["trades"]:
        assert t["aggressor"] in (
            "at_bid", "below_mid", "at_mid", "above_mid", "at_ask", "unknown"
        )


def test_flow_premium_filter(client):
    body = client.get(
        "/api/options/SPY/flow", params={"limit": 200, "min_premium": 100_000}
    ).json()
    for t in body["trades"]:
        assert t["premium"] >= 100_000


def test_ratios_endpoint(client):
    body = client.get("/api/options/SPY/ratios", params={"max_dte": 7}).json()
    assert body["all"]["volume_ratio"] is not None
    assert body["by_expiry"]


def test_csv_export(client):
    r = client.get("/api/options/SPY/export", params={"max_dte": 7, "dataset": "by-strike"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "strike" in r.text.splitlines()[0]


def test_watchlist_returns_a_row_per_symbol(client):
    body = client.get("/api/watchlist", params={"symbols": "SPY,QQQ", "max_dte": 7}).json()
    assert [r["symbol"] for r in body["rows"]] == ["SPY", "QQQ"]
    assert all(r["ok"] for r in body["rows"])


def test_history_endpoint_returns_a_series(client):
    client.get("/api/gex/SPY", params={"max_dte": 7})
    body = client.get("/api/history/SPY/gex").json()
    assert body["symbol"] == "SPY"
    assert isinstance(body["points"], list)


def test_market_status(client):
    body = client.get("/api/market/status").json()
    assert body["state"] in ("PRE_MARKET", "OPEN", "AFTER_HOURS", "CLOSED")
    assert body["timezone"] == "America/New_York"


def test_providers_endpoint_lists_health(client):
    body = client.get("/api/providers").json()
    assert body["active"] in ("demo", "massive", "tradier")
    assert any(p["name"] == "demo" for p in body["providers"])


def test_bars_endpoint(client):
    bars = client.get("/api/market/SPY/bars", params={"interval": "5m", "limit": 60}).json()
    assert len(bars) == 60
    for b in bars[:5]:
        assert b["h"] >= b["l"]


def test_alert_rule_lifecycle(client):
    created = client.post(
        "/api/alerts",
        json={"symbol": "SPY", "rule_type": "approach_flip", "threshold_pct": 0.5},
    )
    assert created.status_code == 200
    rule_id = created.json()["rule"]["id"]
    assert any(r["id"] == rule_id for r in client.get("/api/alerts").json()["rules"])
    assert client.delete(f"/api/alerts/{rule_id}").status_code == 200
    assert client.delete(f"/api/alerts/{rule_id}").status_code == 404


def test_unknown_alert_rule_type_is_rejected(client):
    r = client.post("/api/alerts", json={"symbol": "SPY", "rule_type": "make_me_money"})
    assert r.status_code == 422


def test_invalid_expiration_parameter_is_rejected(client):
    r = client.get("/api/gex/SPY", params={"expirations": "not-a-date"})
    assert r.status_code == 422


def test_websocket_sends_a_hello_then_data(client):
    with client.websocket_connect("/ws/SPY") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        assert hello["data"]["symbol"] == "SPY"
        msg = ws.receive_json()
        assert msg["type"] in ("underlying", "gex")


def test_explicit_provider_without_credentials_errors_rather_than_substituting(client):
    """Asking for a specific provider must never silently return demo data."""
    r = client.get("/api/gex/SPY", params={"provider": "tradier", "max_dte": 7})
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert detail["error"] == "provider_unavailable"
    assert "TRADIER_API_KEY" in detail["message"]


def test_unknown_provider_is_rejected(client):
    r = client.get("/api/gex/SPY", params={"provider": "not-a-provider"})
    assert r.status_code == 502


def test_implicit_provider_still_falls_back_to_demo(client):
    body = client.get("/api/gex/SPY", params={"max_dte": 7}).json()
    assert body["provider"] == "demo"
    assert body["freshness"]["status"] == "DEMO"


def test_websocket_gex_frame_matches_the_rest_envelope(client):
    """A pushed frame and a polled response must be interchangeable.

    If the WS frame omitted `demo_banner` or `disclaimer`, the UI would drop the
    demo warning whenever a push arrived ahead of the poll.
    """
    rest = set(client.get("/api/gex/SPY", params={"max_dte": 30}).json().keys())
    with client.websocket_connect("/ws/SPY") as ws:
        for _ in range(6):
            msg = ws.receive_json()
            if msg["type"] == "gex":
                assert set(msg["data"].keys()) == rest
                assert msg["data"]["demo_banner"]["demo"] is True
                assert "MODEL-DERIVED" in msg["data"]["disclaimer"]
                return
    raise AssertionError("no gex frame received")
