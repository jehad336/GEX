"""Massive adapter: URL shapes, index tickers, pagination, and entitlement honesty.

These use respx to serve recorded-shape payloads, so the vendor contract is
pinned without needing an API key. The URLs asserted here are the ones that were
wrong in the first implementation, which is exactly why they are asserted.
"""

from __future__ import annotations

from datetime import date, timedelta

import httpx
import pytest
import respx

from app.models import DelayStatus, OptionType
from app.providers.base import ProviderError
from app.providers.massive import MassiveProvider

BASE = "https://api.massive.com"


def provider(realtime: bool = False) -> MassiveProvider:
    return MassiveProvider("test-key", BASE, "wss://socket.massive.com",
                           realtime_entitled=realtime, max_retries=1)


def chain_row(strike: float, kind: str, exp: str, *, oi=1000, vol=250):
    return {
        "details": {
            "ticker": f"O:SPY{exp.replace('-', '')[2:]}{kind[0].upper()}{int(strike * 1000):08d}",
            "strike_price": strike, "expiration_date": exp,
            "contract_type": kind, "shares_per_contract": 100,
        },
        "open_interest": oi,
        "day": {"volume": vol},
        "implied_volatility": 0.185,
        "greeks": {"delta": 0.52, "gamma": 0.031, "theta": -0.44, "vega": 0.12},
        "last_quote": {"bid": 3.10, "ask": 3.20, "last_updated": 1_700_000_000_000_000_000},
        "last_trade": {"price": 3.15, "sip_timestamp": 1_700_000_000_000_000_000},
        "underlying_asset": {"price": 580.25},
    }


EQUITY_SNAPSHOT = {
    "ticker": {
        "day": {"o": 578.0, "h": 582.0, "l": 577.1, "c": 580.25, "v": 51_000_000, "vw": 579.8},
        "prevDay": {"c": 576.0},
        "lastTrade": {"p": 580.25},
        "todaysChange": 4.25,
        "todaysChangePerc": 0.7378,
        "updated": 1_700_000_000_000_000_000,
    }
}

INDEX_SNAPSHOT = {
    "results": [{
        "ticker": "I:SPX", "value": 5820.5,
        "session": {"open": 5800.0, "high": 5830.0, "low": 5795.0,
                    "previous_close": 5805.0, "change": 15.5, "change_percent": 0.267},
        "last_updated": 1_700_000_000_000_000_000,
    }]
}


# ------------------------------------------------------------------ tickers


def test_index_symbols_get_the_vendor_prefix():
    assert MassiveProvider.vendor_ticker("SPX") == "I:SPX"
    assert MassiveProvider.vendor_ticker("NDX") == "I:NDX"


def test_equity_symbols_pass_through_unchanged():
    assert MassiveProvider.vendor_ticker("SPY") == "SPY"
    assert MassiveProvider.vendor_ticker("nvda") == "NVDA"


def test_index_detection():
    assert MassiveProvider.is_index("SPX") and not MassiveProvider.is_index("SPY")


# ------------------------------------------------------------------ underlying


@respx.mock
async def test_equity_snapshot_uses_the_v2_stocks_endpoint():
    route = respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json=EQUITY_SNAPSHOT))
    u = await provider().get_underlying("SPY")
    assert route.called
    assert u.price == pytest.approx(580.25)
    assert u.previous_close == pytest.approx(576.0)
    assert u.volume == 51_000_000


@respx.mock
async def test_index_snapshot_uses_the_indices_endpoint_with_the_prefixed_ticker():
    route = respx.get(f"{BASE}/v3/snapshot/indices").mock(
        return_value=httpx.Response(200, json=INDEX_SNAPSHOT))
    u = await provider().get_underlying("SPX")
    assert route.called
    assert route.calls[0].request.url.params["ticker.any_of"] == "I:SPX"
    assert u.price == pytest.approx(5820.5)
    # A cash index does not trade, so volume must stay absent rather than zero.
    assert u.volume is None


@respx.mock
async def test_premarket_equity_falls_back_to_previous_close_not_a_zero_price():
    payload = {"ticker": {"day": {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0},
                          "prevDay": {"c": 576.0}, "lastTrade": {}}}
    respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json=payload))
    u = await provider().get_underlying("SPY")
    assert u.price == pytest.approx(576.0)


@respx.mock
async def test_missing_price_raises_rather_than_inventing_one():
    respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json={"ticker": {}}))
    with pytest.raises(ProviderError):
        await provider().get_underlying("SPY")


# ------------------------------------------------------------------ chain


@respx.mock
async def test_chain_uses_the_v3_snapshot_endpoint():
    exp = (date.today() + timedelta(days=7)).isoformat()
    respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json=EQUITY_SNAPSHOT))
    route = respx.get(f"{BASE}/v3/snapshot/options/SPY").mock(
        return_value=httpx.Response(200, json={"results": [
            chain_row(580, "call", exp), chain_row(580, "put", exp)]}))

    chain = await provider().get_option_chain("SPY")
    assert route.called
    assert len(chain.contracts) == 2
    c = next(x for x in chain.contracts if x.type == OptionType.CALL)
    assert c.strike == 580 and c.open_interest == 1000 and c.volume == 250
    assert c.gamma == pytest.approx(0.031) and c.iv == pytest.approx(0.185)
    assert c.mid == pytest.approx(3.15)


@respx.mock
async def test_index_chain_requests_the_prefixed_underlying():
    exp = (date.today() + timedelta(days=1)).isoformat()
    respx.get(f"{BASE}/v3/snapshot/indices").mock(
        return_value=httpx.Response(200, json=INDEX_SNAPSHOT))
    route = respx.get(f"{BASE}/v3/snapshot/options/I:SPX").mock(
        return_value=httpx.Response(200, json={"results": [chain_row(5820, "call", exp)]}))

    chain = await provider().get_option_chain("SPX")
    assert route.called
    # The app keeps its own plain symbol; only the wire uses I:SPX.
    assert chain.contracts[0].underlying == "SPX"


@respx.mock
async def test_chain_follows_next_url_so_the_chain_is_not_silently_truncated():
    """The vendor caps a page at 250. Stopping at page one would understate GEX."""
    exp = (date.today() + timedelta(days=7)).isoformat()
    respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json=EQUITY_SNAPSHOT))
    page2 = f"{BASE}/v3/snapshot/options/SPY?cursor=abc"
    respx.get(f"{BASE}/v3/snapshot/options/SPY", params={"limit": "250"}).mock(
        return_value=httpx.Response(200, json={
            "results": [chain_row(575, "call", exp)], "next_url": page2}))
    respx.get(page2).mock(return_value=httpx.Response(200, json={
        "results": [chain_row(585, "call", exp)]}))

    chain = await provider().get_option_chain("SPY")
    assert sorted(c.strike for c in chain.contracts) == [575.0, 585.0]


@respx.mock
async def test_unparseable_rows_are_skipped_not_fatal():
    exp = (date.today() + timedelta(days=7)).isoformat()
    respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json=EQUITY_SNAPSHOT))
    respx.get(f"{BASE}/v3/snapshot/options/SPY").mock(
        return_value=httpx.Response(200, json={"results": [
            {"details": {}},                                  # no strike or expiry
            {"details": {"strike_price": 1, "expiration_date": exp,
                         "contract_type": "warrant"}},        # not an option
            chain_row(580, "call", exp),
        ]}))
    chain = await provider().get_option_chain("SPY")
    assert len(chain.contracts) == 1


# ------------------------------------------------------------------ expirations / bars


@respx.mock
async def test_expirations_come_from_the_reference_contracts_endpoint():
    route = respx.get(f"{BASE}/v3/reference/options/contracts").mock(
        return_value=httpx.Response(200, json={"results": [
            {"expiration_date": "2026-09-18"}, {"expiration_date": "2026-09-11"},
            {"expiration_date": "2026-09-18"}]}))
    exps = await provider().get_expirations("SPY")
    assert route.called
    assert exps == [date(2026, 9, 11), date(2026, 9, 18)]  # sorted and de-duplicated


@respx.mock
async def test_bars_use_the_aggregates_range_endpoint():
    route = respx.get(url__regex=rf"{BASE}/v2/aggs/ticker/SPY/range/5/minute/.*").mock(
        return_value=httpx.Response(200, json={"results": [
            {"t": 1_700_000_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100, "vw": 1.2},
            {"t": 1_700_000_300_000, "o": 1.5, "h": 2.5, "l": 1.4, "c": 2.0, "v": 120},
        ]}))
    bars = await provider().get_historical_bars("SPY", "5m", 10)
    assert route.called
    assert len(bars) == 2 and bars[0].h >= bars[0].l
    assert bars[1].vwap is None


# ------------------------------------------------------------------ entitlement


@respx.mock
async def test_delayed_plan_never_reports_live():
    exp = (date.today() + timedelta(days=7)).isoformat()
    respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json=EQUITY_SNAPSHOT))
    respx.get(f"{BASE}/v3/snapshot/options/SPY").mock(
        return_value=httpx.Response(200, json={"results": [chain_row(580, "call", exp)]}))

    chain = await provider(realtime=False).get_option_chain("SPY")
    assert chain.freshness.status == DelayStatus.DELAYED_15M
    assert all(c.delay_status == DelayStatus.DELAYED_15M for c in chain.contracts)
    assert "15-minute delayed" in chain.freshness.note


@respx.mock
async def test_realtime_entitlement_must_be_declared_explicitly():
    exp = (date.today() + timedelta(days=7)).isoformat()
    respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json=EQUITY_SNAPSHOT))
    respx.get(f"{BASE}/v3/snapshot/options/SPY").mock(
        return_value=httpx.Response(200, json={"results": [chain_row(580, "call", exp)]}))

    chain = await provider(realtime=True).get_option_chain("SPY")
    assert chain.freshness.status == DelayStatus.LIVE


# ------------------------------------------------------------------ auth / errors


@respx.mock
async def test_api_key_is_sent_as_a_bearer_header_never_in_the_url():
    route = respx.get(f"{BASE}/v2/snapshot/locale/us/markets/stocks/tickers/SPY").mock(
        return_value=httpx.Response(200, json=EQUITY_SNAPSHOT))
    await provider().get_underlying("SPY")
    req = route.calls[0].request
    assert req.headers["Authorization"] == "Bearer test-key"
    assert "test-key" not in str(req.url)


@respx.mock
async def test_rejected_credentials_surface_as_an_unauthenticated_status():
    respx.get(f"{BASE}/v1/marketstatus/now").mock(return_value=httpx.Response(401, json={}))
    st = await provider().provider_status()
    assert st.authenticated is False and st.available is False


async def test_missing_key_is_reported_without_a_network_call():
    st = await MassiveProvider("", BASE, "wss://x").provider_status()
    assert st.authenticated is False
    assert "MASSIVE_API_KEY" in (st.message or "")


@respx.mock
async def test_search_strips_the_index_prefix_for_the_app():
    respx.get(f"{BASE}/v3/reference/tickers").mock(
        return_value=httpx.Response(200, json={"results": [
            {"ticker": "I:SPX", "name": "S&P 500 Index", "market": "indices"},
            {"ticker": "SPY", "name": "SPDR S&P 500 ETF", "market": "stocks"},
        ]}))
    rows = await provider().search_symbols("SP")
    assert [r["symbol"] for r in rows] == ["SPX", "SPY"]
