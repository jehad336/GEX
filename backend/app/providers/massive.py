"""Massive adapter (primary provider).

Massive is the current name of Polygon.io (rebranded October 2025); `api.polygon.io`
and `api.massive.com` serve the same API, so the endpoint shapes below are the
Polygon v2/v3 ones.

Three things about this vendor drive the design here:

* Index options live under an ``I:`` ticker (``I:SPX``), and indices use a
  different snapshot endpoint from equities. SPX and NDX are the whole point of
  a GEX dashboard, so that mapping is not optional.
* The option chain snapshot returns at most 250 contracts per page and paginates
  with ``next_url``. A single un-paginated call silently truncates the chain,
  which would quietly understate every exposure figure.
* There is no underlying-level options trade feed over REST; trades are per
  contract. Flow is therefore assembled from the most active contracts.

Field names are still read through ``_pick()``: plan tiers differ in which
blocks they populate, and a missing key must cost one field, not the chain.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.models import (
    Bar,
    DataOrigin,
    DelayStatus,
    Freshness,
    OptionChain,
    OptionContract,
    OptionTrade,
    OptionType,
    ProviderStatus,
    Underlying,
)
from app.providers.base import MarketDataProvider, ProviderError, dte_from

log = logging.getLogger("gex.provider.massive")

# Cash-settled indices are addressed with an I: prefix on this vendor.
INDEX_TICKERS = {
    "SPX": "I:SPX", "NDX": "I:NDX", "RUT": "I:RUT",
    "VIX": "I:VIX", "DJI": "I:DJI", "OEX": "I:OEX", "XSP": "I:XSP",
}

# (multiplier, timespan) for the aggregates endpoint.
INTERVAL_MAP: dict[str, tuple[int, str]] = {
    "1m": (1, "minute"), "5m": (5, "minute"), "15m": (15, "minute"),
    "30m": (30, "minute"), "1h": (1, "hour"), "1D": (1, "day"),
}
# Roughly how many calendar days back to ask for, to fill `limit` bars.
INTERVAL_LOOKBACK_DAYS = {
    "1m": 5, "5m": 10, "15m": 20, "30m": 40, "1h": 60, "1D": 400,
}

CHAIN_PAGE_LIMIT = 250      # vendor maximum for the chain snapshot
MAX_CHAIN_PAGES = 24        # 6,000 contracts is more than any listed underlying
FLOW_CONTRACTS = 18         # most-active contracts sampled for the flow panel


def _pick(d: Any, *names, default=None):
    """First present, non-null key wins. Plan tiers rename and omit fields."""
    for n in names:
        if isinstance(d, dict) and d.get(n) is not None:
            return d[n]
    return default


def _num(v, default=None) -> float | None:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _int(v, default=0) -> int:
    try:
        return int(float(v)) if v is not None else default
    except (TypeError, ValueError):
        return default


def _ts(v) -> datetime | None:
    """Vendor timestamps are epoch nanoseconds in most blocks, ms in a few."""
    if v is None:
        return None
    if isinstance(v, str):
        with contextlib.suppress(ValueError):
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        return None
    n = _num(v)
    if n is None or n <= 0:
        return None
    for scale in (1e9, 1e6, 1e3, 1.0):
        if n / scale > 1e8:
            return datetime.fromtimestamp(n / scale, tz=UTC)
    return None


def _to_date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        for fmt in ("%Y-%m-%d", "%Y%m%d"):
            with contextlib.suppress(ValueError):
                return datetime.strptime(v.strip()[:10], fmt).date()
    return None


class MassiveProvider(MarketDataProvider):
    name = "massive"
    supports_streaming = True

    def __init__(
        self,
        api_key: str,
        base_url: str,
        ws_url: str,
        realtime_entitled: bool = False,
        **kw,
    ):
        super().__init__(**kw)
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.ws_url = ws_url.rstrip("/")
        # Never inferred from the payload: the vendor does not flag delay, and
        # guessing upward would label delayed data LIVE.
        self.realtime_entitled = realtime_entitled

    # ---------------------------------------------------------------- helpers

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}

    @staticmethod
    def vendor_ticker(symbol: str) -> str:
        """SPX -> I:SPX. Equities and ETFs pass through unchanged."""
        s = symbol.upper().strip()
        return INDEX_TICKERS.get(s, s)

    @staticmethod
    def is_index(symbol: str) -> bool:
        return symbol.upper().strip() in INDEX_TICKERS

    async def _get(self, path: str, params: dict | None = None) -> Any:
        if not self.api_key:
            raise ProviderError(self.name, "MASSIVE_API_KEY is not set")
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        return await self.request_json("GET", url, headers=self._headers, params=params)

    async def _paged(self, path: str, params: dict, max_pages: int) -> list[dict]:
        """Follow `next_url` until the vendor stops handing out cursors."""
        out: list[dict] = []
        data = await self._get(path, params)
        for _ in range(max_pages):
            rows = _pick(data, "results", default=[]) or []
            out.extend(rows)
            nxt = _pick(data, "next_url")
            if not nxt or not rows:
                break
            data = await self._get(nxt)
        else:
            log.warning(
                "chain pagination hit the %d page cap for %s; result may be partial",
                max_pages, params.get("underlying_ticker") or path,
            )
        return out

    def _delay_status(self) -> DelayStatus:
        return DelayStatus.LIVE if self.realtime_entitled else DelayStatus.DELAYED_15M

    # ---------------------------------------------------------------- underlying

    async def get_underlying(self, symbol: str) -> Underlying:
        sym = symbol.upper()
        return (
            await self._index_snapshot(sym)
            if self.is_index(sym)
            else await self._equity_snapshot(sym)
        )

    async def _equity_snapshot(self, sym: str) -> Underlying:
        data = await self._get(f"/v2/snapshot/locale/us/markets/stocks/tickers/{sym}")
        body = _pick(data, "ticker", "results", default={}) or {}

        day = _pick(body, "day", default={}) or {}
        prev = _pick(body, "prevDay", default={}) or {}
        last = _pick(body, "lastTrade", default={}) or {}

        # Before the open, `day` is all zeros; the previous close is the honest price.
        price = (
            _num(_pick(last, "p"))
            or (_num(_pick(day, "c")) or None)
            or _num(_pick(prev, "c"))
        )
        if price is None:
            raise ProviderError(self.name, f"no usable price in snapshot for {sym}")

        prev_close = _num(_pick(prev, "c"))
        change = _num(_pick(body, "todaysChange"))
        if change is None and prev_close:
            change = price - prev_close
        change_pct = _num(_pick(body, "todaysChangePerc"))
        if change_pct is None and prev_close:
            change_pct = (change or 0.0) / prev_close * 100.0

        return Underlying(
            symbol=sym,
            price=price,
            previous_close=prev_close,
            open=_num(_pick(day, "o")) or None,
            high=_num(_pick(day, "h")) or None,
            low=_num(_pick(day, "l")) or None,
            volume=_int(_pick(day, "v"), 0) or None,
            vwap=_num(_pick(day, "vw")) or None,
            change=change,
            change_pct=change_pct,
            timestamp=_ts(_pick(body, "updated")) or datetime.now(UTC),
            source=self.name,
            delay_status=self._delay_status(),
        )

    async def _index_snapshot(self, sym: str) -> Underlying:
        """Indices have no trades or volume, so only price and session fields exist."""
        data = await self._get("/v3/snapshot/indices",
                               {"ticker.any_of": self.vendor_ticker(sym)})
        rows = _pick(data, "results", default=[]) or []
        if not rows:
            raise ProviderError(self.name, f"no index snapshot returned for {sym}")
        body = rows[0]
        session = _pick(body, "session", default={}) or {}

        price = _num(_pick(body, "value")) or _num(_pick(session, "close", "previous_close"))
        if price is None:
            raise ProviderError(self.name, f"no usable value for index {sym}")
        prev_close = _num(_pick(session, "previous_close"))

        return Underlying(
            symbol=sym,
            price=price,
            previous_close=prev_close,
            open=_num(_pick(session, "open")),
            high=_num(_pick(session, "high")),
            low=_num(_pick(session, "low")),
            volume=None,          # cash indices do not trade
            vwap=None,
            change=_num(_pick(session, "change")),
            change_pct=_num(_pick(session, "change_percent")),
            timestamp=_ts(_pick(body, "last_updated", "timestamp")) or datetime.now(UTC),
            source=self.name,
            delay_status=self._delay_status(),
        )

    # ---------------------------------------------------------------- chain

    async def get_expirations(self, symbol: str) -> list[date]:
        rows = await self._paged(
            "/v3/reference/options/contracts",
            {"underlying_ticker": self.vendor_ticker(symbol), "limit": 1000,
             "expired": "false", "sort": "expiration_date", "order": "asc"},
            max_pages=8,
        )
        out = {d for d in (_to_date(_pick(r, "expiration_date")) for r in rows) if d}
        return sorted(out)

    async def get_option_chain(
        self, symbol: str, expirations: list[date] | None = None
    ) -> OptionChain:
        sym = symbol.upper()
        underlying = await self.get_underlying(sym)
        now = datetime.now(UTC)
        vendor = self.vendor_ticker(sym)

        params: dict[str, Any] = {"limit": CHAIN_PAGE_LIMIT}
        rows: list[dict] = []
        if expirations:
            # The endpoint filters one expiry at a time; ask for exactly what we need.
            for exp in expirations:
                rows.extend(await self._paged(
                    f"/v3/snapshot/options/{vendor}",
                    {**params, "expiration_date": exp.isoformat()},
                    max_pages=MAX_CHAIN_PAGES,
                ))
        else:
            rows = await self._paged(
                f"/v3/snapshot/options/{vendor}", params, max_pages=MAX_CHAIN_PAGES
            )

        contracts: list[OptionContract] = []
        for row in rows:
            c = self._parse_contract(row, sym, underlying.price, now)
            if c:
                contracts.append(c)

        log.info("massive chain %s: %d rows -> %d contracts", sym, len(rows), len(contracts))

        return OptionChain(
            underlying=underlying,
            contracts=contracts,
            provider=self.name,
            freshness=Freshness(
                status=self._delay_status(),
                as_of=now,
                source=self.name,
                origin=DataOrigin.OBSERVED,
                note=(
                    "Open interest reflects the previous reporting session. "
                    + ("Quotes are real time."
                       if self.realtime_entitled
                       else "Quotes are 15-minute delayed on this plan tier.")
                ),
            ),
        )

    def _parse_contract(
        self, row: dict, underlying_symbol: str, spot: float, now: datetime
    ) -> OptionContract | None:
        details = _pick(row, "details", default={}) or {}
        greeks = _pick(row, "greeks", default={}) or {}
        quote = _pick(row, "last_quote", default={}) or {}
        trade = _pick(row, "last_trade", default={}) or {}
        day = _pick(row, "day", default={}) or {}
        under = _pick(row, "underlying_asset", default={}) or {}

        exp = _to_date(_pick(details, "expiration_date"))
        strike = _num(_pick(details, "strike_price"))
        raw_type = str(_pick(details, "contract_type", default="")).lower()
        if exp is None or strike is None or not raw_type.startswith(("c", "p")):
            return None
        opt_type = OptionType.CALL if raw_type.startswith("c") else OptionType.PUT

        bid = _num(_pick(quote, "bid"))
        ask = _num(_pick(quote, "ask"))
        mid = (bid + ask) / 2.0 if (bid is not None and ask is not None) else None

        return OptionContract(
            symbol=str(_pick(details, "ticker", default="")),
            underlying=underlying_symbol,
            expiration=exp,
            dte=dte_from(exp, now),
            strike=strike,
            type=opt_type,
            multiplier=_int(_pick(details, "shares_per_contract"), 100) or 100,
            bid=bid,
            ask=ask,
            mid=mid,
            last=_num(_pick(trade, "price")),
            volume=_int(_pick(day, "volume")),
            open_interest=_int(_pick(row, "open_interest")),
            iv=_num(_pick(row, "implied_volatility")),
            delta=_num(_pick(greeks, "delta")),
            gamma=_num(_pick(greeks, "gamma")),
            theta=_num(_pick(greeks, "theta")),
            vega=_num(_pick(greeks, "vega")),
            underlying_price=_num(_pick(under, "price")) or spot,
            quote_timestamp=_ts(_pick(quote, "last_updated", "sip_timestamp", "timestamp")),
            trade_timestamp=_ts(_pick(trade, "sip_timestamp", "timestamp")),
            source=self.name,
            delay_status=self._delay_status(),
        )

    # ---------------------------------------------------------------- bars

    async def get_historical_bars(
        self, symbol: str, interval: str = "5m", limit: int = 200
    ) -> list[Bar]:
        mult, span = INTERVAL_MAP.get(interval, (5, "minute"))
        lookback = INTERVAL_LOOKBACK_DAYS.get(interval, 10)
        end = date.today()
        start = end - timedelta(days=lookback)

        data = await self._get(
            f"/v2/aggs/ticker/{self.vendor_ticker(symbol)}/range/{mult}/{span}/"
            f"{start.isoformat()}/{end.isoformat()}",
            {"adjusted": "true", "sort": "asc", "limit": 50_000},
        )
        rows = _pick(data, "results", default=[]) or []

        out: list[Bar] = []
        for r in rows[-limit:]:
            t = _ts(_pick(r, "t"))
            o, h, low, c = (_num(_pick(r, "o")), _num(_pick(r, "h")),
                            _num(_pick(r, "l")), _num(_pick(r, "c")))
            if t is None or o is None or h is None or low is None or c is None:
                continue
            out.append(Bar(t=t, o=o, h=h, l=low, c=c,
                           v=_num(_pick(r, "v"), 0) or 0.0, vwap=_num(_pick(r, "vw"))))
        return out

    # ---------------------------------------------------------------- trades

    async def get_option_trades(self, symbol: str, limit: int = 200) -> list[OptionTrade]:
        """Assembled per contract: this vendor has no underlying-level trade feed.

        The chain snapshot picks the session's most active contracts, then each is
        queried for prints. That is where the flow actually is, and it bounds the
        request count instead of walking thousands of contracts.
        """
        chain = await self.get_option_chain(symbol)
        active = sorted(
            (c for c in chain.contracts if c.volume > 0),
            key=lambda c: -c.volume,
        )[:FLOW_CONTRACTS]
        if not active:
            return []

        per_contract = max(5, limit // max(len(active), 1))
        now = datetime.now(UTC)
        sem = asyncio.Semaphore(6)

        async def one(c: OptionContract) -> list[OptionTrade]:
            async with sem:
                try:
                    data = await self._get(f"/v3/trades/{c.symbol}",
                                           {"limit": per_contract, "order": "desc",
                                            "sort": "timestamp"})
                except ProviderError as exc:
                    log.info("no trades for %s: %s", c.symbol, exc)
                    return []
            out = []
            for r in _pick(data, "results", default=[]) or []:
                price = _num(_pick(r, "price"))
                size = _int(_pick(r, "size"))
                if price is None or size <= 0:
                    continue
                out.append(OptionTrade(
                    timestamp=_ts(_pick(r, "sip_timestamp", "participant_timestamp")) or now,
                    option_symbol=c.symbol,
                    underlying=chain.underlying.symbol,
                    type=c.type,
                    strike=c.strike,
                    expiration=c.expiration,
                    dte=c.dte,
                    price=price,
                    size=size,
                    multiplier=c.multiplier,
                    # The trades endpoint carries no quote, so the contract's
                    # prevailing quote is used to place the print.
                    bid=c.bid,
                    ask=c.ask,
                    mid=c.mid,
                    underlying_price=chain.underlying.price,
                ))
            return out

        batches = await asyncio.gather(*(one(c) for c in active))
        trades = [t for b in batches for t in b]
        trades.sort(key=lambda t: t.timestamp, reverse=True)
        return trades[:limit]

    # ---------------------------------------------------------------- search

    async def search_symbols(self, query: str) -> list[dict]:
        data = await self._get("/v3/reference/tickers",
                               {"search": query, "active": "true", "limit": 20})
        out = []
        for r in _pick(data, "results", default=[]) or []:
            raw = str(_pick(r, "ticker", default=""))
            if not raw:
                continue
            out.append({
                # Present I:SPX back to the app as plain SPX.
                "symbol": raw.split(":", 1)[-1].upper(),
                "name": _pick(r, "name", default=""),
                "type": _pick(r, "market", "type", default=""),
            })
        return out

    # ---------------------------------------------------------------- websocket

    async def _ws(self, cluster: str, channels: list[str], symbol: str) -> AsyncIterator[dict]:
        import websockets

        url = f"{self.ws_url}/{cluster}"
        async with websockets.connect(url, ping_interval=20) as ws:
            await ws.send(json.dumps({"action": "auth", "params": self.api_key}))
            await ws.send(json.dumps({
                "action": "subscribe",
                "params": ",".join(f"{c}.{symbol}" for c in channels),
            }))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                for item in msg if isinstance(msg, list) else [msg]:
                    if isinstance(item, dict):
                        yield item

    async def stream_underlying(self, symbol: str) -> AsyncIterator[Underlying]:
        sym = symbol.upper()
        if self.is_index(sym):
            cluster, channels, target = "indices", ["V"], self.vendor_ticker(sym)
        else:
            cluster, channels, target = "stocks", ["A"], sym

        async for item in self._ws(cluster, channels, target):
            price = _num(_pick(item, "val", "c", "p"))
            if price is None:
                continue
            yield Underlying(
                symbol=sym,
                price=price,
                volume=_int(_pick(item, "v"), 0) or None,
                vwap=_num(_pick(item, "vw")),
                timestamp=_ts(_pick(item, "t", "s")) or datetime.now(UTC),
                source=self.name,
                delay_status=DelayStatus.LIVE,
            )

    async def stream_options(self, symbol: str) -> AsyncIterator[dict]:
        # T.O:SPY* subscribes to every contract on the underlying.
        async for item in self._ws("options", ["T"], f"O:{self.vendor_ticker(symbol)}*"):
            yield item

    # ---------------------------------------------------------------- status

    async def provider_status(self) -> ProviderStatus:
        if not self.api_key:
            return ProviderStatus(
                name=self.name, available=False, authenticated=False,
                message="MASSIVE_API_KEY is not configured",
                checked_at=datetime.now(UTC),
            )
        authed, msg = True, None
        try:
            await self._get("/v1/marketstatus/now")
        except ProviderError as exc:
            authed = exc.status_code not in (401, 403)
            msg = str(exc)
        return ProviderStatus(
            name=self.name,
            available=authed and not self.breaker.is_open,
            authenticated=authed,
            realtime_entitled=self.realtime_entitled,
            latency_ms=self.last_latency_ms,
            message=msg or (
                None if self.realtime_entitled
                else "Reporting 15-minute delayed data. Set MASSIVE_REALTIME=true "
                     "only if your plan includes real-time options."
            ),
            checked_at=datetime.now(UTC),
        )
