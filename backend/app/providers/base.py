"""MarketDataProvider - the single seam between vendors and the rest of the app.

Swapping DATA_PROVIDER must never require a change outside this package.
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from typing import Any

import httpx

from app.models import (
    Bar,
    OptionChain,
    OptionContract,
    OptionTrade,
    ProviderStatus,
    Underlying,
)

log = logging.getLogger("gex.provider")


class ProviderError(Exception):
    """Vendor call failed in a way the caller should surface, not swallow."""

    def __init__(self, provider: str, message: str, status_code: int | None = None):
        self.provider = provider
        self.status_code = status_code
        super().__init__(f"[{provider}] {message}")


class RateLimitError(ProviderError):
    pass


class CircuitBreaker:
    """Stops hammering a vendor that is already failing."""

    def __init__(self, threshold: int = 5, reset_after: float = 30.0):
        self.threshold = threshold
        self.reset_after = reset_after
        self.failures = 0
        self.opened_at: float | None = None

    @property
    def is_open(self) -> bool:
        if self.opened_at is None:
            return False
        if time.monotonic() - self.opened_at >= self.reset_after:
            # Half-open: let the next call through and see what happens.
            self.opened_at = None
            self.failures = 0
            return False
        return True

    def record_success(self) -> None:
        self.failures = 0
        self.opened_at = None

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = time.monotonic()


class MarketDataProvider(ABC):
    """Every adapter implements this. Returns normalized models only."""

    name: str = "base"
    supports_streaming: bool = False

    def __init__(self, timeout: float = 12.0, max_retries: int = 3):
        self.timeout = timeout
        self.max_retries = max_retries
        self.breaker = CircuitBreaker()
        self._client: httpx.AsyncClient | None = None
        self._inflight: dict[str, asyncio.Task] = {}
        self.last_latency_ms: float | None = None

    # ---------------------------------------------------------- http plumbing

    async def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout),
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def request_json(
        self, method: str, url: str, *, headers: dict | None = None, params: dict | None = None
    ) -> Any:
        """Retry with exponential backoff, honour Retry-After, trip the breaker."""
        if self.breaker.is_open:
            raise ProviderError(self.name, "circuit breaker open - provider recently failing")

        delay = 0.5
        last_exc: Exception | None = None
        client = await self.client()

        for attempt in range(self.max_retries):
            started = time.perf_counter()
            try:
                resp = await client.request(method, url, headers=headers, params=params)
                self.last_latency_ms = (time.perf_counter() - started) * 1000
                log.info(
                    "provider=%s method=%s path=%s status=%s latency_ms=%.1f",
                    self.name, method, httpx.URL(url).path, resp.status_code,
                    self.last_latency_ms,
                )

                if resp.status_code == 429:
                    retry_after = float(resp.headers.get("Retry-After", delay))
                    if attempt == self.max_retries - 1:
                        self.breaker.record_failure()
                        raise RateLimitError(self.name, "rate limited", 429)
                    await asyncio.sleep(min(retry_after, 10.0))
                    delay *= 2
                    continue

                if resp.status_code in (401, 403):
                    self.breaker.record_failure()
                    raise ProviderError(
                        self.name, "authentication or entitlement rejected", resp.status_code
                    )

                if resp.status_code >= 500:
                    last_exc = ProviderError(self.name, f"server error {resp.status_code}",
                                             resp.status_code)
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue

                resp.raise_for_status()
                self.breaker.record_success()
                return resp.json()

            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_exc = exc
                await asyncio.sleep(delay)
                delay *= 2
            except ProviderError:
                raise

        self.breaker.record_failure()
        raise ProviderError(self.name, f"request failed after {self.max_retries} attempts: {last_exc}")

    async def deduplicated(self, key: str, coro_factory):
        """Collapse identical concurrent requests into one upstream call."""
        existing = self._inflight.get(key)
        if existing and not existing.done():
            return await existing
        task = asyncio.ensure_future(coro_factory())
        self._inflight[key] = task
        try:
            return await task
        finally:
            self._inflight.pop(key, None)

    # ---------------------------------------------------------- interface

    @abstractmethod
    async def get_underlying(self, symbol: str) -> Underlying: ...

    @abstractmethod
    async def get_expirations(self, symbol: str) -> list[date]: ...

    @abstractmethod
    async def get_option_chain(
        self, symbol: str, expirations: list[date] | None = None
    ) -> OptionChain: ...

    async def get_option_quotes(self, symbols: list[str]) -> list[OptionContract]:
        raise NotImplementedError(f"{self.name} does not expose per-contract quotes")

    async def get_option_trades(self, symbol: str, limit: int = 200) -> list[OptionTrade]:
        raise NotImplementedError(f"{self.name} does not expose option trades")

    async def get_historical_bars(
        self, symbol: str, interval: str = "5m", limit: int = 200
    ) -> list[Bar]:
        raise NotImplementedError(f"{self.name} does not expose historical bars")

    async def search_symbols(self, query: str) -> list[dict]:
        raise NotImplementedError(f"{self.name} does not expose symbol search")

    async def stream_underlying(self, symbol: str) -> AsyncIterator[Underlying]:
        raise NotImplementedError(f"{self.name} does not support streaming")
        yield  # pragma: no cover

    async def stream_options(self, symbol: str) -> AsyncIterator[dict]:
        raise NotImplementedError(f"{self.name} does not support streaming")
        yield  # pragma: no cover

    async def provider_status(self) -> ProviderStatus:
        return ProviderStatus(
            name=self.name,
            available=not self.breaker.is_open,
            authenticated=True,
            latency_ms=self.last_latency_ms,
            checked_at=datetime.now(UTC),
        )


def dte_from(expiration: date, now: datetime | None = None) -> float:
    """Fractional calendar DTE measured to the 16:00 ET close on the expiry date."""
    now = now or datetime.now(UTC)
    # 16:00 ET is 20:00 UTC (21:00 during EST); 20:00 is close enough for DTE.
    expiry_dt = datetime(expiration.year, expiration.month, expiration.day, 20, 0,
                         tzinfo=UTC)
    return max((expiry_dt - now).total_seconds() / 86400.0, 0.0)
