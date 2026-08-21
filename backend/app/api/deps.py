"""Shared query parameters and helpers for the API layer."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException, Query

from app.providers.base import ProviderError, RateLimitError
from app.services.analytics import ChainRequest


def parse_expirations(raw: str | None) -> list[date] | None:
    if not raw:
        return None
    out: list[date] = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            out.append(datetime.strptime(token, "%Y-%m-%d").date())
        except ValueError as exc:
            raise HTTPException(422, f"invalid expiration '{token}', expected YYYY-MM-DD") from exc
    return out or None


def chain_request(
    symbol: str,
    max_dte: float | None = Query(None, ge=0, description="Include expiries up to this DTE"),
    min_dte: float | None = Query(None, ge=0),
    expirations: str | None = Query(None, description="Comma separated YYYY-MM-DD"),
    strike_band_pct: float | None = Query(
        None, gt=0, le=1, description="Keep strikes within +/- this fraction of spot"
    ),
    include_0dte: bool = Query(True),
    convention: str | None = Query(None, description="GEX sign convention override"),
    provider: str | None = Query(None, description="Override the configured provider"),
) -> ChainRequest:
    return ChainRequest(
        symbol=symbol.upper(),
        max_dte=max_dte,
        min_dte=min_dte,
        expirations=parse_expirations(expirations),
        strike_band_pct=strike_band_pct,
        include_0dte=include_0dte,
        convention=convention,
        provider=provider,
    )


def provider_http_error(exc: Exception) -> HTTPException:
    """Turn a vendor failure into an honest HTTP error.

    Never substitute demo or cached-stale data for a failed live call - the UI
    shows a provider-unavailable state instead.
    """
    if isinstance(exc, RateLimitError):
        return HTTPException(
            429,
            {
                "error": "rate_limited",
                "provider": exc.provider,
                "message": "Provider rate limit reached. Back off and retry.",
            },
        )
    if isinstance(exc, ProviderError):
        return HTTPException(
            502,
            {
                "error": "provider_unavailable",
                "provider": exc.provider,
                "message": str(exc),
            },
        )
    return HTTPException(500, {"error": "internal_error", "message": str(exc)})
