"""Intraday GEX history and the watchlist roll-up."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query

from app.api.routes.market import DEFAULT_WATCHLIST
from app.services import analytics
from app.services import history as hist
from app.services.analytics import ChainRequest

router = APIRouter(tags=["history"])


@router.get("/history/{symbol}/gex")
async def gex_history(
    symbol: str,
    hours: float = Query(8.0, gt=0, le=168),
    limit: int = Query(500, ge=10, le=5000),
) -> dict:
    rows = hist.get_history(symbol, hours, limit)
    return {
        "symbol": symbol.upper(),
        "points": rows,
        "count": len(rows),
        "note": (
            "History accumulates while the app runs; each dashboard refresh records "
            "one point. An empty series simply means nothing has been captured yet."
        ),
    }


@router.get("/watchlist")
async def watchlist(
    symbols: str | None = Query(None, description="Comma separated; defaults to the built-in list"),
    max_dte: float | None = Query(None, ge=0),
) -> dict:
    names = (
        [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if symbols else DEFAULT_WATCHLIST
    )

    async def one(sym: str) -> dict:
        try:
            snap, _ = await analytics.build_snapshot(ChainRequest(symbol=sym, max_dte=max_dte))
            flip = snap.levels.get("gamma_flip")
            return {
                "symbol": sym,
                "ok": True,
                "spot": snap.spot,
                "net_gex": snap.totals.net_gex,
                "regime": snap.regime.regime,
                "gamma_flip": flip.price if flip else None,
                "gamma_flip_distance_pct": flip.distance_pct if flip else None,
                "call_wall": getattr(snap.levels.get("call_wall"), "price", None),
                "put_wall": getattr(snap.levels.get("put_wall"), "price", None),
                "dte0_net_gex": snap.dte0.net_gex,
                "atm_iv": snap.atm_iv,
            }
        except Exception as exc:
            # One bad symbol must not blank the whole watchlist.
            return {"symbol": sym, "ok": False, "error": str(exc)}

    rows = await asyncio.gather(*(one(s) for s in names))
    return {"rows": list(rows), "demo_banner": analytics.demo_banner()}
