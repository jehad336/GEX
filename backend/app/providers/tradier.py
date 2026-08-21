"""Tradier adapter (fallback provider).

Tradier ships greeks and IV inside the chain response when greeks=true, sourced
from ORATS end-of-day surfaces. That is EOD-derived data on an intraday quote, so
greeks are tagged accordingly rather than presented as live.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, date, datetime
from typing import Any

from app.models import (
    Bar,
    DataOrigin,
    DelayStatus,
    Freshness,
    OptionChain,
    OptionContract,
    OptionType,
    ProviderStatus,
    Underlying,
)
from app.providers.base import MarketDataProvider, ProviderError, dte_from

INTERVAL_MAP = {
    "1m": "1min", "5m": "5min", "15m": "15min",
    "30m": "15min", "1h": "15min", "1D": "daily",
}


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


def _to_date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        with contextlib.suppress(ValueError):
            return datetime.strptime(v.strip()[:10], "%Y-%m-%d").date()
    return None


def _listify(v) -> list:
    """Tradier collapses single-element arrays into a bare object."""
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


class TradierProvider(MarketDataProvider):
    name = "tradier"
    supports_streaming = False

    def __init__(self, api_key: str, base_url: str, **kw):
        super().__init__(**kw)
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}

    async def _get(self, path: str, params: dict | None = None) -> Any:
        if not self.api_key:
            raise ProviderError(self.name, "TRADIER_API_KEY is not set")
        return await self.request_json(
            "GET", f"{self.base_url}{path}", headers=self._headers, params=params
        )

    async def get_underlying(self, symbol: str) -> Underlying:
        data = await self._get("/markets/quotes", {"symbols": symbol.upper()})
        quotes = _listify(((data or {}).get("quotes") or {}).get("quote"))
        if not quotes:
            raise ProviderError(self.name, f"no quote returned for {symbol}")
        q = quotes[0]

        price = _num(q.get("last")) or _num(q.get("close")) or _num(q.get("prevclose"))
        if price is None:
            raise ProviderError(self.name, f"no usable price for {symbol}")

        ts = q.get("trade_date") or q.get("bid_date")
        timestamp = (
            datetime.fromtimestamp(float(ts) / 1000, tz=UTC)
            if ts else datetime.now(UTC)
        )

        return Underlying(
            symbol=symbol.upper(),
            price=price,
            previous_close=_num(q.get("prevclose")),
            open=_num(q.get("open")),
            high=_num(q.get("high")),
            low=_num(q.get("low")),
            volume=_int(q.get("volume"), 0) or None,
            change=_num(q.get("change")),
            change_pct=_num(q.get("change_percentage")),
            timestamp=timestamp,
            source=self.name,
            # Tradier delivers real time only on a funded brokerage account;
            # market-data-only tokens are 15-minute delayed.
            delay_status=DelayStatus.DELAYED_15M,
        )

    async def get_expirations(self, symbol: str) -> list[date]:
        data = await self._get(
            "/markets/options/expirations",
            {"symbol": symbol.upper(), "includeAllRoots": "true", "strikes": "false"},
        )
        raw = ((data or {}).get("expirations") or {}).get("date")
        return sorted({d for d in (_to_date(x) for x in _listify(raw)) if d})

    async def get_option_chain(
        self, symbol: str, expirations: list[date] | None = None
    ) -> OptionChain:
        sym = symbol.upper()
        underlying = await self.get_underlying(sym)

        # Tradier is strictly one expiry per request, so fetch the requested set.
        targets = expirations or (await self.get_expirations(sym))[:8]
        now = datetime.now(UTC)
        contracts: list[OptionContract] = []

        for exp in targets:
            data = await self._get(
                "/markets/options/chains",
                {"symbol": sym, "expiration": exp.isoformat(), "greeks": "true"},
            )
            for row in _listify(((data or {}).get("options") or {}).get("option")):
                c = self._parse_contract(row, sym, underlying.price, now)
                if c:
                    contracts.append(c)

        return OptionChain(
            underlying=underlying,
            contracts=contracts,
            provider=self.name,
            freshness=Freshness(
                status=DelayStatus.DELAYED_15M,
                as_of=now,
                source=self.name,
                origin=DataOrigin.OBSERVED,
                note=(
                    "Tradier greeks and IV are ORATS end-of-day derived; open interest "
                    "reflects the previous reporting session."
                ),
            ),
        )

    def _parse_contract(
        self, row: dict, underlying: str, spot: float, now: datetime
    ) -> OptionContract | None:
        exp = _to_date(row.get("expiration_date"))
        strike = _num(row.get("strike"))
        raw_type = str(row.get("option_type") or "").lower()
        if exp is None or strike is None or raw_type not in ("call", "put"):
            return None

        greeks = row.get("greeks") or {}
        bid, ask = _num(row.get("bid")), _num(row.get("ask"))

        return OptionContract(
            symbol=str(row.get("symbol") or ""),
            underlying=underlying,
            expiration=exp,
            dte=dte_from(exp, now),
            strike=strike,
            type=OptionType.CALL if raw_type == "call" else OptionType.PUT,
            multiplier=_int(row.get("contract_size"), 100) or 100,
            bid=bid,
            ask=ask,
            mid=((bid + ask) / 2.0) if (bid is not None and ask is not None) else None,
            last=_num(row.get("last")),
            volume=_int(row.get("volume")),
            open_interest=_int(row.get("open_interest")),
            iv=_num(greeks.get("mid_iv")) or _num(greeks.get("smv_vol")),
            delta=_num(greeks.get("delta")),
            gamma=_num(greeks.get("gamma")),
            theta=_num(greeks.get("theta")),
            vega=_num(greeks.get("vega")),
            underlying_price=spot,
            quote_timestamp=now,
            source=self.name,
            delay_status=DelayStatus.DELAYED_15M,
        )

    async def get_historical_bars(
        self, symbol: str, interval: str = "5m", limit: int = 200
    ) -> list[Bar]:
        iv = INTERVAL_MAP.get(interval, "5min")
        if iv == "daily":
            data = await self._get("/markets/history",
                                   {"symbol": symbol.upper(), "interval": "daily"})
            rows = _listify(((data or {}).get("history") or {}).get("day"))
            key = "date"
        else:
            data = await self._get("/markets/timesales",
                                   {"symbol": symbol.upper(), "interval": iv})
            rows = _listify(((data or {}).get("series") or {}).get("data"))
            key = "time"

        out: list[Bar] = []
        for r in rows[-limit:]:
            raw_t = r.get(key)
            t = None
            if raw_t:
                with contextlib.suppress(ValueError):
                    t = datetime.fromisoformat(str(raw_t))
            if t is None:
                continue
            if t.tzinfo is None:
                t = t.replace(tzinfo=UTC)
            o = _num(r.get("open"))
            h = _num(r.get("high"))
            low = _num(r.get("low"))
            c = _num(r.get("close"))
            if o is None or h is None or low is None or c is None:
                continue
            out.append(Bar(t=t, o=o, h=h, l=low, c=c,
                           v=_num(r.get("volume"), 0) or 0.0, vwap=_num(r.get("vwap"))))
        return out

    async def search_symbols(self, query: str) -> list[dict]:
        data = await self._get("/markets/search", {"q": query, "indexes": "true"})
        rows = _listify(((data or {}).get("securities") or {}).get("security"))
        return [
            {
                "symbol": str(r.get("symbol", "")).upper(),
                "name": r.get("description", ""),
                "type": r.get("type", ""),
            }
            for r in rows
            if r.get("symbol")
        ]

    async def provider_status(self) -> ProviderStatus:
        if not self.api_key:
            return ProviderStatus(
                name=self.name, available=False, authenticated=False,
                message="TRADIER_API_KEY is not configured",
                checked_at=datetime.now(UTC),
            )
        try:
            await self._get("/markets/clock")
            authed, msg = True, None
        except ProviderError as exc:
            authed, msg = exc.status_code not in (401, 403), str(exc)
        return ProviderStatus(
            name=self.name,
            available=authed and not self.breaker.is_open,
            authenticated=authed,
            realtime_entitled=False,
            latency_ms=self.last_latency_ms,
            message=msg,
            checked_at=datetime.now(UTC),
        )
