"""ORATS adapter - optional advanced volatility analytics.

Not required for the MVP. Wired into the registry only when ORATS_API_KEY is set,
and used purely to enrich IV analytics (surface, skew, term structure, historical
IV rank). It is never the source of the primary chain.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.models import ProviderStatus
from app.providers.base import ProviderError


class OratsClient:
    name = "orats"

    def __init__(self, api_key: str, base_url: str, timeout: float = 12.0):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def _get(self, path: str, params: dict | None = None) -> Any:
        if not self.enabled:
            raise ProviderError(self.name, "ORATS_API_KEY is not set")
        import httpx

        p = dict(params or {})
        p["token"] = self.api_key
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{self.base_url}{path}", params=p)
            if resp.status_code in (401, 403):
                raise ProviderError(self.name, "authentication rejected", resp.status_code)
            resp.raise_for_status()
            return resp.json()

    async def iv_rank(self, symbol: str) -> dict | None:
        """Core summary: IV rank, IV percentile, realised vol, term slope."""
        data = await self._get("/summaries", {"ticker": symbol.upper()})
        rows = (data or {}).get("data") or []
        if not rows:
            return None
        r = rows[0]
        return {
            "iv_rank": r.get("ivRank1m") or r.get("ivRank"),
            "iv_percentile": r.get("ivPct1m") or r.get("ivPercentile"),
            "iv_30d": r.get("iv30d"),
            "iv_60d": r.get("iv60d"),
            "iv_90d": r.get("iv90d"),
            "realised_20d": r.get("orHv20d"),
            "slope": r.get("slope"),
            "as_of": r.get("tradeDate"),
        }

    async def volatility_surface(self, symbol: str) -> list[dict]:
        data = await self._get("/monies/implied", {"ticker": symbol.upper()})
        return (data or {}).get("data") or []

    async def historical_iv(self, symbol: str, start: str, end: str) -> list[dict]:
        data = await self._get(
            "/hist/cores",
            {"ticker": symbol.upper(), "tradeDate": f"{start},{end}"},
        )
        return (data or {}).get("data") or []

    async def provider_status(self) -> ProviderStatus:
        if not self.enabled:
            return ProviderStatus(
                name=self.name, available=False, authenticated=False,
                message="ORATS_API_KEY not configured (optional provider)",
                checked_at=datetime.now(UTC),
            )
        ok, msg = True, None
        try:
            await self._get("/summaries", {"ticker": "SPY"})
        except Exception as exc:
            ok, msg = False, str(exc)
        return ProviderStatus(
            name=self.name, available=ok, authenticated=ok, message=msg,
            checked_at=datetime.now(UTC),
        )
