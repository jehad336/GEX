"""Exposure Ladder endpoint - per-strike delta, gamma, vanna, charm, OI and volume."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import parse_expirations, provider_http_error
from app.services.exposure_ladder import (
    DEFAULT_STRIKE_RANGE_PCT,
    EXPIRATION_MODES,
    STRIKE_RANGE_PRESETS,
    LadderRequest,
    get_ladder,
)

router = APIRouter(prefix="/exposure", tags=["exposure"])


@router.get("/modes")
async def ladder_modes() -> dict:
    """Filter options the screen offers, so the UI does not hard-code them."""
    return {
        "expirationModes": [
            {"value": "0dte", "label": "0DTE", "maxDte": EXPIRATION_MODES["0dte"]},
            {"value": "1dte", "label": "1DTE", "maxDte": EXPIRATION_MODES["1dte"]},
            {"value": "weekly", "label": "7DTE", "maxDte": EXPIRATION_MODES["weekly"]},
            {"value": "monthly", "label": "30DTE", "maxDte": EXPIRATION_MODES["monthly"]},
            {"value": "all", "label": "All", "maxDte": None},
            {"value": "single", "label": "Single expiry", "maxDte": None},
            {"value": "custom", "label": "Custom", "maxDte": None},
        ],
        "strikeRangePresets": STRIKE_RANGE_PRESETS,
        "defaultStrikeRangePct": DEFAULT_STRIKE_RANGE_PCT,
        "metrics": ["gex", "dex", "vanna", "charm", "oi", "volume", "all"],
        "views": ["compact", "advanced"],
    }


@router.get("/{symbol}/ladder")
async def exposure_ladder(
    symbol: str,
    expirationMode: str = Query("all", pattern="^(0dte|1dte|weekly|monthly|all|single|custom)$"),
    expiration: str | None = Query(
        None, description="Comma separated YYYY-MM-DD. Required for mode=single."
    ),
    maxDte: float | None = Query(None, ge=0, description="Overrides the mode window"),
    strikeRange: float | None = Query(
        DEFAULT_STRIKE_RANGE_PCT, ge=0.1, le=100,
        description="Percent band around spot; omit for all strikes",
    ),
    include0dte: bool = Query(True),
    convention: str | None = Query(None),
    provider: str | None = Query(None),
) -> dict:
    """Per-strike exposure plus the key levels drawn over the ladder.

    Exposure is summed from per-contract values; greeks are never averaged and
    multiplied by aggregate open interest.
    """
    req = LadderRequest(
        symbol=symbol.upper(),
        expiration_mode=expirationMode,
        expirations=parse_expirations(expiration),
        max_dte=maxDte,
        strike_range_pct=strikeRange,
        include_0dte=include0dte,
        convention=convention,
        provider=provider,
    )
    try:
        return await get_ladder(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc
