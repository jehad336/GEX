"""Continuous analytical option-candidate scan and bounded in-app log."""

from __future__ import annotations

from fastapi import APIRouter

from app.services import analytics
from app.services.analytics import ChainRequest
from app.services.opportunities import get_opportunity_scanner

router = APIRouter(prefix="/opportunities", tags=["opportunities"])


@router.get("/{symbol}")
async def scan_opportunities(symbol: str, provider: str | None = None) -> dict:
    snapshot, ctx = await analytics.build_snapshot(
        ChainRequest(symbol=symbol.upper(), provider=provider)
    )
    scanner = get_opportunity_scanner()
    created = scanner.evaluate(snapshot, ctx)
    records = scanner.for_symbol(symbol)[:50]
    return {
        "symbol": symbol.upper(),
        "scanning": True,
        "last_scan_at": scanner.last_scan_at.get(symbol.upper()),
        "created": [row.to_dict() for row in created],
        "records": [row.to_dict() for row in records],
        "minimum_score": 65,
        "cooldown_minutes": int(scanner.cooldown.total_seconds() / 60),
        "provider": ctx.provider_name,
        "demo": ctx.provider_name == "demo",
        "delivery": "in-app analytical log only; no order is created or transmitted",
    }

