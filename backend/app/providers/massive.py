"""Massive Market Data adapter (primary provider).

REST for chains and snapshots, WebSocket for trades/quotes/aggregates when the
account is entitled to real time. Field names are read defensively via _pick():
vendor payloads vary between plan tiers, and a missing key must degrade a single
field rather than blow up the whole chain.
"""

from __future__ import annotations

import contextlib
import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
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

INTERVAL_MAP = {
    "1m": ("1", "minute"),
    "5m": ("5", "minute"),
    "15m": ("15", "minute"),
    "30m": ("30", "minute"),
    "1h": ("1", "hour"),
    "1D": ("1", "day"),
}


def _pick(d: dict, *names, default=None):
    """First present, non-null key wins. Vendors rename fields between tiers."""
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
    if v is None:
        return None
    if isinstance(v, str):
        with contextlib.suppress(ValueError):
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        return None
    n = _num(v)
    if n is None:
        return None
    # Heuristically detect ns / us / ms / s epochs.
    for scale in (1e9, 1e6, 1e3, 1.0):
        if n / scale > 1e8:
            return datetime.fromtimestamp(n / scale, tz=UTC)
    return None


def _to_date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%Y-%m-%d", "%Y%m%d"):
            with contextlib.suppress(ValueError):
                return datetime.strptime(s, fmt).date()
    return None


class MassiveProvider(MarketDataProvider):
    name = "massive"
    supports_streaming = True

    def __init__(self, api_key: str, base_url: str, ws_url: str, **kw):
        super().__init__(**kw)
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.ws_url = ws_url
        self.realtime_entitled = False

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}

    async def _get(self, path: str, params: dict | None = None) -> Any:
        if not self.api_key:
            raise ProviderError(self.name, "MASSIVE_API_KEY is not set")
        return await self.request_json(
            "GET", f"{self.base_url}{path}", headers=self._headers, params=params
        )

    def _delay_status(self, payload: dict | None = None) -> DelayStatus:
        """Trust the vendor's own entitlement flag. Never assume LIVE."""
        if isinstance(payload, dict):
            flag = str(_pick(payload, "delay", "delayed", "feed", default="")).lower()
            if flag in ("realtime", "real_time", "live", "false"):
                return DelayStatus.LIVE
            if "15" in flag or flag in ("true", "delayed"):
                return DelayStatus.DELAYED_15M
        return DelayStatus.LIVE if self.realtime_entitled else DelayStatus.DELAYED_15M

    # ---------------------------------------------------------------- REST

    async def get_underlying(self, symbol: str) -> Underlying:
        data = await self._get(f"/stocks/{symbol.upper()}/snapshot")
        body = _pick(data, "results", "result", "data", "snapshot", default=data) or {}
        if isinstance(body, list):
            body = body[0] if body else {}

        day = _pick(body, "day", "session", default={}) or {}
        prev = _pick(body, "prevDay", "previous_day", "prev", default={}) or {}
        last = _pick(body, "lastTrade", "last_trade", "last", default={}) or {}

        price = _num(
            _pick(body, "price", "last_price", "close")
            or _pick(last, "p", "price")
            or _pick(day, "c", "close")
        )
        if price is None:
            raise ProviderError(self.name, f"no price in snapshot for {symbol}")

        prev_close = _num(_pick(prev, "c", "close") or _pick(body, "previous_close", "prevClose"))
        change = price - prev_close if prev_close else _num(_pick(body, "change", "todaysChange"))
        change_pct = (change / prev_close * 100.0) if (prev_close and change is not None) else None

        return Underlying(
            symbol=symbol.upper(),
            price=price,
            previous_close=prev_close,
            open=_num(_pick(day, "o", "open")),
            high=_num(_pick(day, "h", "high")),
            low=_num(_pick(day, "l", "low")),
            volume=_int(_pick(day, "v", "volume"), 0) or None,
            vwap=_num(_pick(day, "vw", "vwap")),
            change=change,
            change_pct=change_pct,
            timestamp=_ts(_pick(body, "updated", "timestamp", "t")) or datetime.now(UTC),
            source=self.name,
            delay_status=self._delay_status(body),
        )

    async def get_expirations(self, symbol: str) -> list[date]:
        data = await self._get(f"/options/{symbol.upper()}/expirations")
        raw = _pick(data, "results", "expirations", "data", default=data) or []
        if isinstance(raw, dict):
            raw = _pick(raw, "date", "expirations", default=[])
        out = [d for d in (_to_date(x) for x in raw) if d]
        return sorted(set(out))

    async def get_option_chain(
        self, symbol: str, expirations: list[date] | None = None
    ) -> OptionChain:
        sym = symbol.upper()
        underlying = await self.get_underlying(sym)

        params: dict[str, Any] = {"limit": 5000}
        if expirations:
            params["expiration"] = ",".join(e.isoformat() for e in expirations)

        data = await self._get(f"/options/{sym}/chain", params)
        rows = _pick(data, "results", "options", "data", "chain", default=[]) or []
        if isinstance(rows, dict):
            rows = _pick(rows, "options", "contracts", default=[])

        now = datetime.now(UTC)
        contracts: list[OptionContract] = []
        for row in rows:
            c = self._parse_contract(row, sym, underlying.price, now)
            if c:
                contracts.append(c)

        return OptionChain(
            underlying=underlying,
            contracts=contracts,
            provider=self.name,
            freshness=Freshness(
                status=self._delay_status(),
                as_of=now,
                source=self.name,
                origin=DataOrigin.OBSERVED,
                note="Open interest reflects the previous reporting session.",
            ),
        )

    def _parse_contract(
        self, row: dict, underlying_symbol: str, spot: float, now: datetime
    ) -> OptionContract | None:
        details = _pick(row, "details", "contract", default=row) or row
        greeks = _pick(row, "greeks", "greek", default={}) or {}
        quote = _pick(row, "last_quote", "quote", default={}) or {}
        trade = _pick(row, "last_trade", "trade", default={}) or {}
        day = _pick(row, "day", "session", default={}) or {}

        exp = _to_date(
            _pick(details, "expiration_date", "expiration", "expiry", "exp_date")
        )
        strike = _num(_pick(details, "strike_price", "strike"))
        raw_type = str(
            _pick(details, "contract_type", "type", "option_type", "side", default="")
        ).lower()
        if exp is None or strike is None or raw_type not in ("call", "put", "c", "p"):
            return None
        opt_type = OptionType.CALL if raw_type.startswith("c") else OptionType.PUT

        bid = _num(_pick(quote, "bid", "bid_price", "bp"))
        ask = _num(_pick(quote, "ask", "ask_price", "ap"))
        mid = (bid + ask) / 2.0 if (bid is not None and ask is not None) else None

        return OptionContract(
            symbol=str(_pick(details, "ticker", "symbol", "occ_symbol",
                             default=f"{underlying_symbol}{exp:%y%m%d}"
                                     f"{'C' if opt_type == OptionType.CALL else 'P'}"
                                     f"{int(strike * 1000):08d}")),
            underlying=underlying_symbol,
            expiration=exp,
            dte=dte_from(exp, now),
            strike=strike,
            type=opt_type,
            multiplier=_int(_pick(details, "shares_per_contract", "multiplier"), 100) or 100,
            bid=bid,
            ask=ask,
            mid=mid,
            last=_num(_pick(trade, "price", "p", "last")),
            volume=_int(_pick(day, "volume", "v") or _pick(row, "volume")),
            open_interest=_int(_pick(row, "open_interest", "oi") or _pick(details, "open_interest")),
            iv=_num(_pick(row, "implied_volatility", "iv") or _pick(greeks, "iv", "mid_iv")),
            delta=_num(_pick(greeks, "delta")),
            gamma=_num(_pick(greeks, "gamma")),
            theta=_num(_pick(greeks, "theta")),
            vega=_num(_pick(greeks, "vega")),
            underlying_price=spot,
            quote_timestamp=_ts(_pick(quote, "timestamp", "t", "sip_timestamp")),
            trade_timestamp=_ts(_pick(trade, "timestamp", "t", "sip_timestamp")),
            oi_timestamp=_ts(_pick(row, "oi_date", "open_interest_date")),
            source=self.name,
            delay_status=self._delay_status(),
        )

    async def get_historical_bars(
        self, symbol: str, interval: str = "5m", limit: int = 200
    ) -> list[Bar]:
        mult, span = INTERVAL_MAP.get(interval, ("5", "minute"))
        data = await self._get(
            f"/stocks/{symbol.upper()}/aggregates",
            {"multiplier": mult, "timespan": span, "limit": limit, "sort": "asc"},
        )
        rows = _pick(data, "results", "bars", "data", default=[]) or []
        out: list[Bar] = []
        for r in rows:
            t = _ts(_pick(r, "t", "timestamp", "time"))
            o = _num(_pick(r, "o", "open"))
            h = _num(_pick(r, "h", "high"))
            low = _num(_pick(r, "l", "low"))
            c = _num(_pick(r, "c", "close"))
            if t is None or o is None or h is None or low is None or c is None:
                continue
            out.append(Bar(t=t, o=o, h=h, l=low, c=c,
                           v=_num(_pick(r, "v", "volume"), 0) or 0.0,
                           vwap=_num(_pick(r, "vw", "vwap"))))
        return out

    async def get_option_trades(self, symbol: str, limit: int = 200) -> list[OptionTrade]:
        data = await self._get(f"/options/{symbol.upper()}/trades", {"limit": limit})
        rows = _pick(data, "results", "trades", "data", default=[]) or []
        now = datetime.now(UTC)
        out: list[OptionTrade] = []
        for r in rows:
            t = self._parse_trade(r, symbol.upper(), now)
            if t:
                out.append(t)
        return out

    def _parse_trade(self, r: dict, underlying: str, now: datetime) -> OptionTrade | None:
        exp = _to_date(_pick(r, "expiration_date", "expiration", "expiry"))
        strike = _num(_pick(r, "strike_price", "strike"))
        raw_type = str(_pick(r, "contract_type", "type", "option_type", default="")).lower()
        price = _num(_pick(r, "price", "p"))
        size = _int(_pick(r, "size", "s", "quantity"))
        if not exp or strike is None or price is None or not raw_type or size <= 0:
            return None
        bid, ask = _num(_pick(r, "bid", "bp")), _num(_pick(r, "ask", "ap"))
        return OptionTrade(
            timestamp=_ts(_pick(r, "timestamp", "t", "sip_timestamp")) or now,
            option_symbol=str(_pick(r, "ticker", "symbol", default="")),
            underlying=underlying,
            type=OptionType.CALL if raw_type.startswith("c") else OptionType.PUT,
            strike=strike,
            expiration=exp,
            dte=dte_from(exp, now),
            price=price,
            size=size,
            multiplier=_int(_pick(r, "multiplier"), 100) or 100,
            bid=bid,
            ask=ask,
            mid=((bid + ask) / 2.0) if (bid is not None and ask is not None) else None,
            underlying_price=_num(_pick(r, "underlying_price")),
        )

    async def search_symbols(self, query: str) -> list[dict]:
        data = await self._get("/reference/tickers", {"search": query, "limit": 20})
        rows = _pick(data, "results", "tickers", "data", default=[]) or []
        return [
            {
                "symbol": str(_pick(r, "ticker", "symbol", default="")).upper(),
                "name": _pick(r, "name", "description", default=""),
                "type": _pick(r, "type", "asset_class", default=""),
            }
            for r in rows
            if _pick(r, "ticker", "symbol")
        ]

    # ---------------------------------------------------------------- WS

    async def _ws_connect(self, channels: list[str], symbol: str) -> AsyncIterator[dict]:
        import websockets

        async with websockets.connect(self.ws_url, ping_interval=20) as ws:
            await ws.send(json.dumps({"action": "auth", "params": self.api_key}))
            await ws.send(
                json.dumps({"action": "subscribe",
                            "params": ",".join(f"{c}.{symbol.upper()}" for c in channels)})
            )
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                for item in msg if isinstance(msg, list) else [msg]:
                    yield item

    async def stream_underlying(self, symbol: str) -> AsyncIterator[Underlying]:
        async for item in self._ws_connect(["A", "T"], symbol):
            price = _num(_pick(item, "c", "p", "price", "close"))
            if price is None:
                continue
            yield Underlying(
                symbol=symbol.upper(),
                price=price,
                volume=_int(_pick(item, "v", "volume"), 0) or None,
                vwap=_num(_pick(item, "vw", "vwap")),
                timestamp=_ts(_pick(item, "t", "timestamp")) or datetime.now(UTC),
                source=self.name,
                delay_status=DelayStatus.LIVE,
            )

    async def stream_options(self, symbol: str) -> AsyncIterator[dict]:
        async for item in self._ws_connect(["OT", "OQ"], symbol):
            yield item

    async def provider_status(self) -> ProviderStatus:
        if not self.api_key:
            return ProviderStatus(
                name=self.name, available=False, authenticated=False,
                message="MASSIVE_API_KEY is not configured",
                checked_at=datetime.now(UTC),
            )
        try:
            await self._get("/reference/status")
            authed = True
            msg = None
        except ProviderError as exc:
            authed = exc.status_code not in (401, 403)
            msg = str(exc)
        return ProviderStatus(
            name=self.name,
            available=authed and not self.breaker.is_open,
            authenticated=authed,
            realtime_entitled=self.realtime_entitled,
            latency_ms=self.last_latency_ms,
            message=msg,
            checked_at=datetime.now(UTC),
        )
