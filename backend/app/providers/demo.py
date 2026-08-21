"""Demo provider - synthetic, deterministic, and always labelled DEMO.

This exists so the dashboard can be developed and demonstrated with no vendor
account. Every record it emits carries delay_status=DEMO, and the API refuses to
report DEMO data as LIVE. It is never a fallback for a failed live request: if a
real provider errors, the API surfaces the error instead of substituting this.

The chain is generated from a Black-Scholes surface with a realistic smile and an
OI/volume profile concentrated around round strikes, so the GEX maths exercises
the same code paths as real data.
"""

from __future__ import annotations

import math
import random
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time, timedelta

import numpy as np

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
from app.providers.base import MarketDataProvider, dte_from
from app.quant import black_scholes as bs

BASE_PRICES = {
    "SPX": 5820.0, "SPY": 580.0, "QQQ": 495.0, "NDX": 20300.0, "IWM": 228.0,
    "DIA": 428.0, "AAPL": 232.0, "NVDA": 138.0, "TSLA": 248.0, "AMD": 152.0,
    "MSFT": 428.0, "AMZN": 198.0, "META": 578.0, "GOOGL": 172.0, "NFLX": 745.0,
}
BASE_VOL = {
    "SPX": 0.13, "SPY": 0.135, "QQQ": 0.17, "NDX": 0.165, "IWM": 0.20, "DIA": 0.13,
    "AAPL": 0.26, "NVDA": 0.48, "TSLA": 0.55, "AMD": 0.45, "MSFT": 0.24,
    "AMZN": 0.30, "META": 0.32, "GOOGL": 0.28, "NFLX": 0.35,
}
INDEX_SYMBOLS = {"SPX", "NDX"}


def _strike_step(price: float) -> float:
    if price >= 4000:
        return 25.0
    if price >= 1000:
        return 10.0
    if price >= 300:
        return 5.0
    if price >= 100:
        return 1.0
    return 0.5


class DemoProvider(MarketDataProvider):
    name = "demo"
    supports_streaming = True

    def __init__(self, **kw):
        super().__init__(**kw)
        self.risk_free = 0.043

    def _seed(self, symbol: str) -> random.Random:
        # Deterministic per symbol per day, so the dashboard is stable on refresh.
        return random.Random(f"{symbol}:{date.today().isoformat()}")

    def _base_price(self, symbol: str) -> float:
        sym = symbol.upper()
        if sym in BASE_PRICES:
            return BASE_PRICES[sym]
        # Unknown ticker: stable pseudo-price derived from the name.
        return 40.0 + (sum(ord(ch) for ch in sym) % 260)

    def _base_vol(self, symbol: str) -> float:
        return BASE_VOL.get(symbol.upper(), 0.34)

    def _spot(self, symbol: str) -> float:
        base = self._base_price(symbol)
        rng = self._seed(symbol)
        # Intraday drift keyed to the minute, so the price moves as time passes.
        minutes = datetime.now(UTC).hour * 60 + datetime.now(UTC).minute
        wave = math.sin(minutes / 90.0) * 0.004 + math.sin(minutes / 23.0) * 0.0015
        return round(base * (1 + wave + rng.uniform(-0.002, 0.002)), 2)

    async def get_underlying(self, symbol: str) -> Underlying:
        sym = symbol.upper()
        rng = self._seed(sym)
        price = self._spot(sym)
        prev_close = round(self._base_price(sym) * (1 + rng.uniform(-0.01, 0.01)), 2)
        change = round(price - prev_close, 2)

        return Underlying(
            symbol=sym,
            price=price,
            previous_close=prev_close,
            open=round(prev_close * (1 + rng.uniform(-0.004, 0.004)), 2),
            high=round(max(price, prev_close) * 1.004, 2),
            low=round(min(price, prev_close) * 0.996, 2),
            volume=int(rng.uniform(2e6, 9e7)),
            vwap=round((price + prev_close) / 2, 2),
            change=change,
            change_pct=round(change / prev_close * 100, 3),
            timestamp=datetime.now(UTC),
            source=self.name,
            delay_status=DelayStatus.DEMO,
        )

    async def get_expirations(self, symbol: str) -> list[date]:
        """0DTE plus the next dailies, weeklies and monthlies."""
        today = date.today()
        out: set[date] = {today}
        d = today
        for _ in range(45):
            d += timedelta(days=1)
            if d.weekday() >= 5:
                continue
            # SPX/SPY/QQQ list every weekday; single names list Fridays only.
            if symbol.upper() in {"SPX", "SPY", "QQQ", "NDX", "IWM"} or d.weekday() == 4:
                out.add(d)
        # A few monthlies further out (third Friday).
        for m in range(1, 5):
            probe = (today.replace(day=1) + timedelta(days=32 * m)).replace(day=15)
            while probe.weekday() != 4:
                probe += timedelta(days=1)
            out.add(probe)
        return sorted(out)

    def _iv_for(self, symbol: str, strike: float, spot: float, tenor: float) -> float:
        """Smile: skewed downside, term structure rising with tenor."""
        base = self._base_vol(symbol)
        moneyness = math.log(strike / spot) if strike > 0 and spot > 0 else 0.0
        skew = -0.9 * moneyness                        # puts bid over calls
        smile = 2.2 * moneyness**2
        term = base * (0.75 + 0.35 * math.sqrt(max(tenor, 1 / 365) / (30 / 365)))
        return max(0.03, min(term + skew + smile, 3.0))

    async def get_option_chain(
        self, symbol: str, expirations: list[date] | None = None
    ) -> OptionChain:
        sym = symbol.upper()
        underlying = await self.get_underlying(sym)
        spot = underlying.price
        rng = self._seed(sym)
        now = datetime.now(UTC)

        exps = expirations or (await self.get_expirations(sym))[:10]
        step = _strike_step(spot)
        center = round(spot / step) * step
        n_strikes = 41
        strikes = [center + (i - n_strikes // 2) * step for i in range(n_strikes)]
        strikes = [k for k in strikes if k > 0]
        multiplier = 100

        contracts: list[OptionContract] = []
        for exp in exps:
            dte = dte_from(exp, now)
            tenor = max(dte / 365.0, 1 / (365 * 24))
            # Near-dated expiries carry the bulk of open interest.
            exp_weight = math.exp(-dte / 21.0) + 0.15
            for k in strikes:
                iv = self._iv_for(sym, k, spot, tenor)
                rel = abs(k - spot) / spot
                # OI clusters at the money and at round strikes.
                round_bonus = 1.8 if (k % (step * 5) == 0) else 1.0
                oi_base = 18000 * math.exp(-((rel / 0.035) ** 2)) * exp_weight * round_bonus
                for typ in (OptionType.CALL, OptionType.PUT):
                    is_call = typ == OptionType.CALL
                    # Calls skew OI upside, puts downside - the usual hedging footprint.
                    side_bias = 1.35 if (is_call and k > spot) or (not is_call and k < spot) else 0.7
                    oi = int(max(0, oi_base * side_bias * rng.uniform(0.55, 1.45)))
                    vol = int(oi * rng.uniform(0.05, 0.9) * (2.5 if dte < 1 else 1.0))

                    gamma = float(bs.gamma(spot, k, tenor, iv, self.risk_free))
                    delta = float(bs.delta(spot, k, tenor, iv, self.risk_free, 0.0, is_call))
                    theta = float(bs.theta(spot, k, tenor, iv, self.risk_free, 0.0, is_call)) / 365
                    vega = float(bs.vega(spot, k, tenor, iv, self.risk_free)) / 100
                    px = float(bs.price(spot, k, tenor, iv, self.risk_free, 0.0, is_call))
                    spread = max(0.02, px * 0.02)

                    contracts.append(
                        OptionContract(
                            symbol=(
                                f"{sym}{exp:%y%m%d}{'C' if is_call else 'P'}"
                                f"{int(k * 1000):08d}"
                            ),
                            underlying=sym,
                            expiration=exp,
                            dte=dte,
                            strike=float(k),
                            type=typ,
                            multiplier=multiplier,
                            bid=round(max(0.0, px - spread / 2), 2),
                            ask=round(px + spread / 2, 2),
                            mid=round(px, 2),
                            last=round(px * rng.uniform(0.98, 1.02), 2),
                            volume=vol,
                            open_interest=oi,
                            iv=round(iv, 4),
                            delta=round(delta, 5),
                            gamma=round(gamma, 8),
                            theta=round(theta, 5),
                            vega=round(vega, 5),
                            underlying_price=spot,
                            quote_timestamp=now,
                            trade_timestamp=now,
                            oi_timestamp=datetime.combine(
                                date.today() - timedelta(days=1), time(21, 0), tzinfo=UTC
                            ),
                            source=self.name,
                            delay_status=DelayStatus.DEMO,
                        )
                    )

        return OptionChain(
            underlying=underlying,
            contracts=contracts,
            provider=self.name,
            freshness=Freshness(
                status=DelayStatus.DEMO,
                as_of=now,
                source=self.name,
                origin=DataOrigin.OBSERVED,
                note="SYNTHETIC DEMO DATA. Not market data. Do not trade on this.",
            ),
        )

    async def get_historical_bars(
        self, symbol: str, interval: str = "5m", limit: int = 200
    ) -> list[Bar]:
        sym = symbol.upper()
        rng = np.random.default_rng(abs(hash((sym, date.today(), interval))) % (2**32))
        spot = self._spot(sym)
        minutes = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "1D": 1440}.get(interval, 5)
        vol_per_bar = self._base_vol(sym) / math.sqrt(252 * (390 / minutes))

        steps = rng.normal(0, vol_per_bar, limit)
        path = spot * np.exp(np.cumsum(steps) - np.cumsum(steps)[-1])
        now = datetime.now(UTC)

        bars: list[Bar] = []
        for i, close in enumerate(path):
            t = now - timedelta(minutes=minutes * (limit - i))
            o = float(path[i - 1]) if i else float(close)
            hi = max(o, float(close)) * (1 + abs(rng.normal(0, vol_per_bar / 2)))
            lo = min(o, float(close)) * (1 - abs(rng.normal(0, vol_per_bar / 2)))
            bars.append(
                Bar(t=t, o=round(o, 2), h=round(hi, 2), l=round(lo, 2), c=round(float(close), 2),
                    v=float(int(rng.uniform(1e4, 5e6))), vwap=round((hi + lo + float(close)) / 3, 2))
            )
        return bars

    async def get_option_trades(self, symbol: str, limit: int = 200) -> list[OptionTrade]:
        sym = symbol.upper()
        rng = random.Random(f"{sym}:{datetime.now(UTC).minute}")
        spot = self._spot(sym)
        step = _strike_step(spot)
        exps = (await self.get_expirations(sym))[:5]
        now = datetime.now(UTC)

        out: list[OptionTrade] = []
        for i in range(limit):
            exp = rng.choice(exps)
            dte = dte_from(exp, now)
            k = round((spot * rng.uniform(0.96, 1.04)) / step) * step
            is_call = rng.random() > 0.48
            iv = self._iv_for(sym, k, spot, max(dte / 365, 1 / (365 * 24)))
            px = float(bs.price(spot, k, max(dte / 365, 1 / (365 * 24)), iv,
                                self.risk_free, 0.0, is_call))
            px = max(round(px, 2), 0.01)
            spread = max(0.02, px * 0.02)
            bid, ask = round(px - spread / 2, 2), round(px + spread / 2, 2)
            trade_px = round(rng.choice([bid, px, ask, round((px + ask) / 2, 2)]), 2)
            # Occasional block prints so the premium filters have something to catch.
            size = rng.choice([1, 5, 10, 25, 50, 100, 250, 500, 1500])

            out.append(
                OptionTrade(
                    timestamp=now - timedelta(seconds=i * rng.randint(1, 12)),
                    option_symbol=(
                        f"{sym}{exp:%y%m%d}{'C' if is_call else 'P'}{int(k * 1000):08d}"
                    ),
                    underlying=sym,
                    type=OptionType.CALL if is_call else OptionType.PUT,
                    strike=float(k),
                    expiration=exp,
                    dte=dte,
                    price=trade_px,
                    size=size,
                    multiplier=100,
                    bid=bid,
                    ask=ask,
                    mid=px,
                    underlying_price=spot,
                )
            )
        return sorted(out, key=lambda t: t.timestamp, reverse=True)

    async def search_symbols(self, query: str) -> list[dict]:
        q = query.upper().strip()
        return [
            {"symbol": s, "name": f"{s} (demo universe)", "type":
             "index" if s in INDEX_SYMBOLS else "equity"}
            for s in BASE_PRICES
            if q in s
        ][:20]

    async def stream_underlying(self, symbol: str) -> AsyncIterator[Underlying]:
        import asyncio

        while True:
            yield await self.get_underlying(symbol)
            await asyncio.sleep(1.0)

    async def provider_status(self) -> ProviderStatus:
        return ProviderStatus(
            name=self.name,
            available=True,
            authenticated=True,
            realtime_entitled=False,
            latency_ms=0.0,
            message="Synthetic demo data - not market data.",
            checked_at=datetime.now(UTC),
        )
