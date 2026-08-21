"""Exposure Ladder API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import parse_expirations, provider_http_error
from app.exposure_models import ExpirationMode, ExposureLadderResponse
from app.services import analytics, exposure_ladder
from app.services.analytics import ChainRequest

router = APIRouter(prefix="/exposure", tags=["exposure"])


@router.get("/{symbol}/ladder", response_model=ExposureLadderResponse)
async def exposure_ladder_endpoint(
    symbol: str,
    expiration_mode: ExpirationMode = Query(ExpirationMode.ALL, alias="expirationMode"),
    expiration: str | None = Query(
        None, description="One or more comma-separated YYYY-MM-DD expirations"
    ),
    max_dte: float | None = Query(None, alias="maxDte", ge=0),
    strike_range: float | None = Query(3.0, alias="strikeRange", ge=0, le=100),
    include_0dte: bool = Query(True, alias="include0dte"),
    metric: str = Query("all", pattern="^(gex|dex|vanna|charm|oi|volume|all)$"),
    convention: str | None = Query(None),
    provider: str | None = Query(None),
) -> ExposureLadderResponse:
    """Return a contract-first, strike-aggregated exposure matrix.

    ``metric`` is accepted as shareable UI state; the backend always returns every
    metric so changing columns never causes another provider request.
    """
    del metric
    expirations = parse_expirations(expiration)
    if expiration_mode in (
        ExpirationMode.CUSTOM,
        ExpirationMode.SINGLE,
        ExpirationMode.MULTIPLE,
    ) and not expirations:
        raise HTTPException(422, "expiration is required for this expirationMode")

    try:
        ctx = await analytics.build_context(
            ChainRequest(
                symbol=symbol.upper(),
                include_0dte=True,
                convention=convention,
                provider=provider,
            )
        )
        return exposure_ladder.build_ladder(
            ctx,
            exposure_ladder.LadderFilters(
                expiration_mode=expiration_mode,
                expirations=expirations or [],
                max_dte=max_dte,
                strike_range_pct=None if strike_range == 0 else strike_range,
                include_0dte=include_0dte,
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise provider_http_error(exc) from exc
