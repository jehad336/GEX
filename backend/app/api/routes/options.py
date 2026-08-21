"""Option chain, OI, volume, IV/skew/term structure, expected move, flow."""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.deps import chain_request, provider_http_error
from app.models import DataOrigin
from app.providers.registry import get_orats, get_provider
from app.quant import flow as flow_mod
from app.quant import gex_engine as engine
from app.quant import levels as lv
from app.quant import volatility
from app.services import analytics, history
from app.services.analytics import ChainRequest

router = APIRouter(prefix="/options", tags=["options"])


@router.get("/{symbol}/chain")
async def option_chain(
    req: ChainRequest = Depends(chain_request),
    limit: int = Query(500, ge=1, le=5000),
) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    # Nearest-to-spot first, so a truncated response still holds what matters.
    rows = sorted(ctx.contracts, key=lambda c: (c.expiration, abs(c.strike - ctx.spot)))[:limit]
    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "underlying": ctx.chain.underlying.model_dump(mode="json"),
        "freshness": ctx.chain.freshness.model_dump(mode="json"),
        "quality": ctx.quality,
        "total_contracts": len(ctx.contracts),
        "returned": len(rows),
        "contracts": [c.model_dump(mode="json") for c in rows],
    }


@router.get("/{symbol}/oi")
async def open_interest(req: ChainRequest = Depends(chain_request)) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    totals = analytics.totals_for(ctx)
    by_expiry = analytics.by_expiry_for(ctx)
    oi_ts = next((c.oi_timestamp for c in ctx.contracts if c.oi_timestamp), None)

    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "call_oi": totals.call_oi,
        "put_oi": totals.put_oi,
        "total_oi": totals.call_oi + totals.put_oi,
        "put_call_oi_ratio": (totals.put_oi / totals.call_oi) if totals.call_oi else None,
        "by_strike": [
            {
                "strike": r.strike, "call_oi": r.call_oi, "put_oi": r.put_oi,
                "total_oi": r.total_oi,
            }
            for r in ctx.by_strike
        ],
        "by_expiry": [
            {
                "expiration": r.expiration.isoformat(), "dte": r.dte,
                "call_oi": r.call_oi, "put_oi": r.put_oi,
            }
            for r in by_expiry
        ],
        "largest_call_oi": lv.largest_by(
            ctx.by_strike, "call_oi", ctx.spot, "Largest Call OI").model_dump(),
        "largest_put_oi": lv.largest_by(
            ctx.by_strike, "put_oi", ctx.spot, "Largest Put OI").model_dump(),
        "oi_as_of": oi_ts.isoformat() if oi_ts else None,
        "oi_note": (
            "Open interest is published once per session and is not tick-by-tick. "
            "Figures reflect the previous reporting session unless the provider "
            "states otherwise."
        ),
        "change": history.oi_change(req.symbol, ctx.contracts),
        "origin": DataOrigin.OBSERVED.value,
    }


@router.get("/{symbol}/volume")
async def volume(
    req: ChainRequest = Depends(chain_request),
    unusual_ratio: float = Query(1.0, gt=0, description="Volume/OI threshold for unusual"),
) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    totals = analytics.totals_for(ctx)
    unusual = [
        {
            "strike": c.strike, "expiration": c.expiration.isoformat(), "dte": round(c.dte, 2),
            "type": c.type.value, "volume": c.volume, "open_interest": c.open_interest,
            "volume_oi_ratio": round(c.volume / c.open_interest, 2),
        }
        for c in ctx.contracts
        if c.open_interest > 0 and c.volume / c.open_interest >= unusual_ratio and c.volume > 100
    ]
    unusual.sort(key=lambda r: -r["volume_oi_ratio"])

    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "call_volume": totals.call_volume,
        "put_volume": totals.put_volume,
        "total_volume": totals.call_volume + totals.put_volume,
        "put_call_volume_ratio": (
            totals.put_volume / totals.call_volume if totals.call_volume else None
        ),
        "by_strike": [
            {
                "strike": r.strike, "call_volume": r.call_volume, "put_volume": r.put_volume,
                "total_volume": r.call_volume + r.put_volume, "total_oi": r.total_oi,
                "volume_oi_ratio": round((r.call_volume + r.put_volume) / r.total_oi, 3)
                if r.total_oi else None,
            }
            for r in ctx.by_strike
        ],
        "by_expiry": [
            {
                "expiration": r.expiration.isoformat(), "dte": r.dte,
                "call_volume": r.call_volume, "put_volume": r.put_volume,
            }
            for r in analytics.by_expiry_for(ctx)
        ],
        "unusual": unusual[:50],
        "origin": DataOrigin.OBSERVED.value,
    }


@router.get("/{symbol}/ratios")
async def ratios(req: ChainRequest = Depends(chain_request)) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    all_totals = analytics.totals_for(ctx)
    dte0 = analytics.dte0_totals(ctx)
    return {
        "symbol": req.symbol,
        "all": lv.put_call_ratios(
            all_totals.call_volume, all_totals.put_volume,
            all_totals.call_oi, all_totals.put_oi).model_dump(),
        "dte0": lv.put_call_ratios(
            dte0.call_volume, dte0.put_volume, dte0.call_oi, dte0.put_oi).model_dump(),
        "by_expiry": [
            {
                "expiration": r.expiration.isoformat(),
                "dte": r.dte,
                "volume_ratio": (r.put_volume / r.call_volume) if r.call_volume else None,
                "oi_ratio": (r.put_oi / r.call_oi) if r.call_oi else None,
            }
            for r in analytics.by_expiry_for(ctx)
        ],
    }


@router.get("/{symbol}/iv")
async def implied_volatility(req: ChainRequest = Depends(chain_request)) -> dict:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    summary = volatility.iv_summary(ctx.contracts, ctx.spot)
    payload = {"symbol": req.symbol, "spot": ctx.spot, **summary.model_dump()}

    # IV rank/percentile need a history this app does not keep; ORATS supplies it.
    orats = get_orats()
    if orats.enabled:
        try:
            payload["historical"] = await orats.iv_rank(req.symbol)
            payload["historical_source"] = "orats"
        except Exception as exc:
            payload["historical"] = None
            payload["historical_error"] = str(exc)
    else:
        payload["historical"] = None
        payload["historical_note"] = (
            "IV Rank and IV Percentile require a historical IV series. "
            "Set ORATS_API_KEY to enable them."
        )
    return payload


@router.get("/{symbol}/expected-move")
async def expected_move(
    req: ChainRequest = Depends(chain_request),
    expiration: str | None = Query(None, description="YYYY-MM-DD; defaults to nearest"),
) -> dict:
    from datetime import datetime as _dt

    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    target = _dt.strptime(expiration, "%Y-%m-%d").date() if expiration else None
    selected = volatility.expected_move(ctx.contracts, ctx.spot, target)

    exps = sorted({c.expiration for c in ctx.contracts})
    presets: dict = {}
    same_day = engine.dte0_contracts(ctx.contracts)
    if same_day:
        presets["dte0"] = volatility.expected_move(same_day, ctx.spot)
    if len(exps) > 1:
        presets["dte1"] = volatility.expected_move(ctx.contracts, ctx.spot, exps[1])
    weekly = [e for e in exps if any(c.dte <= 7 for c in ctx.contracts if c.expiration == e)]
    if weekly:
        presets["weekly"] = volatility.expected_move(ctx.contracts, ctx.spot, weekly[-1])

    return {
        "symbol": req.symbol,
        "spot": ctx.spot,
        "selected": selected.model_dump(mode="json") if selected else None,
        "presets": {k: v.model_dump(mode="json") for k, v in presets.items() if v},
        "available_expirations": [e.isoformat() for e in exps],
        "method": (
            "ATM straddle: the mid price of the call plus the put at the strike "
            "closest to spot with both legs quoted."
        ),
    }


@router.get("/{symbol}/flow")
async def option_flow(
    symbol: str,
    min_premium: float = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    provider: str | None = None,
) -> dict:
    p = get_provider(provider)
    try:
        trades = await p.get_option_trades(symbol, limit)
    except NotImplementedError:
        return {
            "symbol": symbol.upper(),
            "available": False,
            "reason": (
                f"Provider '{p.name}' does not expose an options trade feed. "
                "Options flow requires a real-time trades entitlement."
            ),
            "trades": [],
        }
    except Exception as exc:
        raise provider_http_error(exc) from exc

    trades = [flow_mod.enrich_trade(t) for t in trades]
    if min_premium > 0:
        trades = flow_mod.filter_by_premium(trades, min_premium)

    return {
        "symbol": symbol.upper(),
        "available": True,
        "provider": p.name,
        "summary": flow_mod.summarise_flow(trades),
        "premium_tiers": flow_mod.PREMIUM_TIERS,
        "trades": [
            {**t.model_dump(mode="json"), "premium": t.premium} for t in trades
        ],
        "note": (
            "Call does not mean bullish and put does not mean bearish. Aggressor "
            "tagging describes where the print landed in the quote, nothing more."
        ),
    }


@router.get("/{symbol}/export")
async def export_csv(
    req: ChainRequest = Depends(chain_request),
    dataset: str = Query("by-strike", pattern="^(by-strike|by-expiry|chain|oi|volume)$"),
) -> StreamingResponse:
    try:
        ctx = await analytics.build_context(req)
    except Exception as exc:
        raise provider_http_error(exc) from exc

    buf = io.StringIO()
    if dataset == "chain":
        rows = [c.model_dump(mode="json") for c in ctx.contracts]
    elif dataset == "by-expiry":
        rows = [r.model_dump(mode="json") for r in analytics.by_expiry_for(ctx)]
    elif dataset == "oi":
        rows = [
            {"strike": r.strike, "call_oi": r.call_oi, "put_oi": r.put_oi,
             "total_oi": r.total_oi}
            for r in ctx.by_strike
        ]
    elif dataset == "volume":
        rows = [
            {"strike": r.strike, "call_volume": r.call_volume, "put_volume": r.put_volume}
            for r in ctx.by_strike
        ]
    else:
        rows = [r.model_dump() for r in ctx.by_strike]

    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)

    filename = f"{req.symbol}_{dataset}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
