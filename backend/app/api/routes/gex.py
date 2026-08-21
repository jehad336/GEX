"""GEX endpoints - snapshot, by-strike, by-expiry, profile, levels, 0DTE, heatmap."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import chain_request, provider_http_error
from app.core.config import get_settings
from app.quant import gex_engine as engine
from app.quant import levels as lv
from app.services import analytics, history
from app.services.analytics import ChainRequest

router = APIRouter(prefix="/gex", tags=["gex"])

# Defined in the service layer so the WebSocket hub emits the identical envelope.
MODEL_DISCLAIMER = analytics.MODEL_DISCLAIMER


@router.get("/{symbol}")
async def gex_snapshot(req: ChainRequest = Depends(chain_request), persist: bool = True) -> dict:
    """Top-of-dashboard summary: totals, regime, every key level, expected move."""
    try:
        snapshot, ctx = await analytics.build_snapshot(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    if persist:
        history.record_snapshot(snapshot)
        history.record_oi(req.symbol, ctx.contracts)

    return analytics.snapshot_envelope(snapshot, ctx)


@router.get("/{symbol}/by-strike")
async def gex_by_strike(
    req: ChainRequest = Depends(chain_request),
    limit: int | None = Query(None, ge=1, le=2000),
) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    rows = ctx.by_strike
    if limit and len(rows) > limit:
        # Keep the strikes nearest spot: they are the ones that trade.
        rows = sorted(sorted(rows, key=lambda r: abs(r.strike - ctx.spot))[:limit],
                      key=lambda r: r.strike)

    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "sign_convention": ctx.convention,
        "rows": [r.model_dump() for r in rows],
        "provider": ctx.provider_name,
        "disclaimer": MODEL_DISCLAIMER,
        "demo_banner": analytics.demo_banner(),
    }


@router.get("/{symbol}/by-expiry")
async def gex_by_expiry(req: ChainRequest = Depends(chain_request)) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    rows = analytics.by_expiry_for(ctx)
    buckets = {
        "dte0": [r for r in rows if r.dte < 1],
        "dte1": [r for r in rows if r.dte < 2],
        "weekly": [r for r in rows if r.dte <= 7],
        "monthly": [r for r in rows if r.dte <= 35],
    }
    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "rows": [r.model_dump(mode="json") for r in rows],
        "buckets": {
            k: {
                "net_gex": sum(r.net_gex for r in v),
                "call_gex": sum(r.call_gex for r in v),
                "put_gex": sum(r.put_gex for r in v),
                "expirations": len(v),
            }
            for k, v in buckets.items()
        },
        "provider": ctx.provider_name,
        "disclaimer": MODEL_DISCLAIMER,
    }


@router.get("/{symbol}/profile")
async def gamma_profile(
    req: ChainRequest = Depends(chain_request),
    band_pct: float = Query(0.10, gt=0.005, le=0.5),
    steps: int = Query(81, ge=11, le=401),
) -> dict:
    """Net GEX repriced across a band of hypothetical spot prices."""
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    profile = analytics.profile_for(ctx, band_pct, steps)
    levels = analytics.levels_for(ctx, profile)
    return {
        "symbol": req.symbol,
        **profile.model_dump(),
        "call_wall": levels["call_wall"].model_dump(),
        "put_wall": levels["put_wall"].model_dump(),
        "gamma_flip": levels["gamma_flip"].model_dump(),
        "method": (
            "Each contract's gamma is recomputed with Black-Scholes at every "
            "hypothetical spot, then aggregated. Contracts without an IV are excluded."
        ),
        "disclaimer": MODEL_DISCLAIMER,
    }


@router.get("/{symbol}/levels")
async def gex_levels(req: ChainRequest = Depends(chain_request), top_n: int = 5) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    profile = analytics.profile_for(ctx)
    levels = analytics.levels_for(ctx, profile)
    totals = analytics.totals_for(ctx)
    dte0 = analytics.dte0_totals(ctx)
    tops = lv.top_gamma_strikes(ctx.by_strike, ctx.spot, top_n)
    concentration = lv.gamma_concentration(ctx.by_strike, ctx.spot)
    pin = lv.pin_risk(
        ctx.by_strike, ctx.spot,
        min((c.dte for c in ctx.contracts), default=99.0),
        abs(dte0.net_gex) / abs(totals.net_gex) if totals.net_gex else 0.0,
    )

    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "levels": {k: v.model_dump() for k, v in levels.items()},
        "top_gamma": {k: [x.model_dump() for x in v] for k, v in tops.items()},
        "concentration": [c.model_dump() for c in concentration],
        "pin_risk": pin.model_dump(),
        "regime": lv.classify_regime(
            totals.net_gex, ctx.spot, profile.zero_gamma, dte0.net_gex
        ).model_dump(),
        "disclaimer": MODEL_DISCLAIMER,
    }


@router.get("/{symbol}/0dte")
async def dte0_panel(req: ChainRequest = Depends(chain_request)) -> dict:
    """Same-session expiries only - the gamma that actually decays into the close."""
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    same_day = engine.dte0_contracts(ctx.contracts)
    if not same_day:
        return {
            "symbol": req.symbol,
            "spot": ctx.spot,
            "available": False,
            "reason": "No expirations dated today for this underlying.",
        }

    s = get_settings()
    arrays = engine.ChainArrays(same_day, s.contract_multiplier_default)
    engine.fill_missing_greeks(arrays, ctx.spot, s.risk_free_rate, s.dividend_yield)
    totals = engine.compute_totals(arrays, ctx.spot, ctx.convention)
    by_strike = engine.compute_by_strike(arrays, ctx.spot, ctx.convention)

    from app.quant import volatility

    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "available": True,
        "expiration": min(c.expiration for c in same_day).isoformat(),
        "dte": min(c.dte for c in same_day),
        "totals": totals.model_dump(),
        "by_strike": [r.model_dump() for r in by_strike],
        "ratios": lv.put_call_ratios(
            totals.call_volume, totals.put_volume, totals.call_oi, totals.put_oi
        ).model_dump(),
        "key_strikes": {
            "largest_call_gamma": lv.largest_by(
                by_strike, "call_gex", ctx.spot, "Largest Call Gamma").model_dump(),
            "largest_put_gamma": lv.largest_by(
                by_strike, "put_gex", ctx.spot, "Largest Put Gamma").model_dump(),
            "largest_call_oi": lv.largest_by(
                by_strike, "call_oi", ctx.spot, "Largest Call OI").model_dump(),
            "largest_put_oi": lv.largest_by(
                by_strike, "put_oi", ctx.spot, "Largest Put OI").model_dump(),
            "largest_call_volume": lv.largest_by(
                by_strike, "call_volume", ctx.spot, "Largest Call Volume").model_dump(),
            "largest_put_volume": lv.largest_by(
                by_strike, "put_volume", ctx.spot, "Largest Put Volume").model_dump(),
        },
        "expected_move": (
            em.model_dump(mode="json")
            if (em := volatility.expected_move(same_day, ctx.spot)) else None
        ),
        "share_of_total_gex": (
            abs(totals.net_gex) / abs(analytics.totals_for(ctx).net_gex)
            if analytics.totals_for(ctx).net_gex else 0.0
        ),
        "disclaimer": MODEL_DISCLAIMER,
    }


@router.get("/{symbol}/heatmap")
async def gex_heatmap(
    req: ChainRequest = Depends(chain_request),
    metric: str = Query("net", pattern="^(net|call|put)$"),
    max_strikes: int = Query(60, ge=10, le=300),
) -> dict:
    """Strike x expiration grid. Aggregated server-side so the UI gets a matrix,
    not thousands of contract rows."""
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    s = get_settings()
    by_exp: dict = {}
    for c in ctx.contracts:
        by_exp.setdefault(c.expiration, []).append(c)

    all_strikes = sorted({c.strike for c in ctx.contracts})
    if len(all_strikes) > max_strikes:
        all_strikes = sorted(
            sorted(all_strikes, key=lambda k: abs(k - ctx.spot))[:max_strikes]
        )
    strike_index = {k: i for i, k in enumerate(all_strikes)}
    expirations = sorted(by_exp)

    cells: list[dict] = []
    for xi, exp in enumerate(expirations):
        arrays = engine.ChainArrays(by_exp[exp], s.contract_multiplier_default)
        engine.fill_missing_greeks(arrays, ctx.spot, s.risk_free_rate, s.dividend_yield)
        for row in engine.compute_by_strike(arrays, ctx.spot, ctx.convention):
            yi = strike_index.get(row.strike)
            if yi is None:
                continue
            value = {"net": row.net_gex, "call": row.call_gex, "put": row.put_gex}[metric]
            if value == 0:
                continue
            cells.append(
                {
                    "x": xi, "y": yi, "value": value, "strike": row.strike,
                    "expiration": exp.isoformat(),
                    "dte": round(min(c.dte for c in by_exp[exp]), 2),
                    "call_oi": row.call_oi, "put_oi": row.put_oi,
                    "call_volume": row.call_volume, "put_volume": row.put_volume,
                    "net_dex": row.net_dex,
                }
            )

    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "metric": metric,
        "expirations": [e.isoformat() for e in expirations],
        "strikes": all_strikes,
        "cells": cells,
        "disclaimer": MODEL_DISCLAIMER,
    }


@router.get("/{symbol}/concentration")
async def concentration(req: ChainRequest = Depends(chain_request)) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc
    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "bands": [c.model_dump() for c in lv.gamma_concentration(ctx.by_strike, ctx.spot)],
    }
