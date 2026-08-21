"""Symbols, underlying quotes, price bars, market status, provider health."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import provider_http_error
from app.core.config import get_settings
from app.models import Bar, Underlying
from app.providers.registry import available_providers, get_orats, get_provider
from app.services.analytics import demo_banner, market_status
from app.services.cache import get_cache

router = APIRouter(tags=["market"])

DEFAULT_SYMBOLS = [
    {"symbol": "SPX", "name": "S&P 500 Index", "type": "index"},
    {"symbol": "SPY", "name": "SPDR S&P 500 ETF", "type": "etf"},
    {"symbol": "QQQ", "name": "Invesco QQQ Trust", "type": "etf"},
    {"symbol": "NDX", "name": "Nasdaq 100 Index", "type": "index"},
    {"symbol": "IWM", "name": "iShares Russell 2000 ETF", "type": "etf"},
    {"symbol": "DIA", "name": "SPDR Dow Jones Industrial Average ETF", "type": "etf"},
    {"symbol": "AAPL", "name": "Apple Inc.", "type": "equity"},
    {"symbol": "NVDA", "name": "NVIDIA Corporation", "type": "equity"},
    {"symbol": "TSLA", "name": "Tesla, Inc.", "type": "equity"},
    {"symbol": "AMD", "name": "Advanced Micro Devices", "type": "equity"},
    {"symbol": "MSFT", "name": "Microsoft Corporation", "type": "equity"},
    {"symbol": "AMZN", "name": "Amazon.com, Inc.", "type": "equity"},
    {"symbol": "META", "name": "Meta Platforms, Inc.", "type": "equity"},
]

DEFAULT_WATCHLIST = ["SPX", "SPY", "QQQ", "NVDA", "TSLA"]


@router.get("/symbols")
async def list_symbols() -> dict:
    return {"symbols": DEFAULT_SYMBOLS, "watchlist": DEFAULT_WATCHLIST}


@router.get("/symbols/search")
async def search_symbols(q: str = Query(..., min_length=1, max_length=12)) -> dict:
    query = q.strip().upper()
    builtin = [s for s in DEFAULT_SYMBOLS if query in s["symbol"] or query in s["name"].upper()]

    remote: list[dict] = []
    try:
        remote = await get_provider().search_symbols(query)
    except NotImplementedError:
        pass
    except Exception:
        # Search is a convenience; a provider outage should not empty the box.
        pass

    seen = {s["symbol"] for s in builtin}
    merged = builtin + [r for r in remote if r["symbol"] not in seen]
    return {"query": query, "results": merged[:25]}


@router.get("/market/status")
async def get_market_status() -> dict:
    return market_status()


@router.get("/market/{symbol}", response_model=Underlying)
async def get_underlying(symbol: str, provider: str | None = None) -> Underlying:
    settings = get_settings()
    cache = get_cache()
    p = get_provider(provider)
    try:
        return await cache.get_or_set(
            f"underlying:{p.name}:{symbol.upper()}",
            settings.cache_ttl_underlying,
            lambda: p.get_underlying(symbol),
        )
    except Exception as exc:
        raise provider_http_error(exc) from exc


@router.get("/market/{symbol}/bars", response_model=list[Bar])
async def get_bars(
    symbol: str,
    interval: str = Query("5m", pattern="^(1m|5m|15m|30m|1h|1D)$"),
    limit: int = Query(200, ge=10, le=2000),
    provider: str | None = None,
) -> list[Bar]:
    settings = get_settings()
    p = get_provider(provider)
    cache = get_cache()
    try:
        return await cache.get_or_set(
            f"bars:{p.name}:{symbol.upper()}:{interval}:{limit}",
            settings.cache_ttl_bars,
            lambda: p.get_historical_bars(symbol, interval, limit),
        )
    except NotImplementedError as exc:
        raise provider_http_error(exc) from exc
    except Exception as exc:
        raise provider_http_error(exc) from exc


@router.get("/market/{symbol}/expirations")
async def get_expirations(symbol: str, provider: str | None = None) -> dict:
    settings = get_settings()
    p = get_provider(provider)
    cache = get_cache()
    try:
        exps = await cache.get_or_set(
            f"expirations:{p.name}:{symbol.upper()}",
            settings.cache_ttl_expirations,
            lambda: p.get_expirations(symbol),
        )
    except Exception as exc:
        raise provider_http_error(exc) from exc
    return {"symbol": symbol.upper(), "expirations": [e.isoformat() for e in exps]}


@router.get("/providers")
async def providers_status() -> dict:
    settings = get_settings()
    active = get_provider()
    statuses = []
    for name in available_providers():
        try:
            statuses.append((await get_provider(name).provider_status()).model_dump())
        except Exception as exc:
            statuses.append({"name": name, "available": False, "message": str(exc)})

    orats = get_orats()
    return {
        "active": active.name,
        "configured": settings.data_provider,
        "fallback": settings.fallback_provider,
        "demo_mode": settings.demo_mode,
        "providers": statuses,
        "orats_enabled": orats.enabled,
        "demo_banner": demo_banner(),
    }


@router.get("/config")
async def public_config() -> dict:
    """Non-secret runtime config the UI needs. No API keys are ever included."""
    s = get_settings()
    return {
        "provider": s.effective_provider(),
        "demo_mode": s.effective_provider() == "demo",
        "sign_convention": s.gex_sign_convention,
        "contract_multiplier_default": s.contract_multiplier_default,
        "risk_free_rate": s.risk_free_rate,
        "refresh": {
            "chain_seconds": s.cache_ttl_chain,
            "underlying_seconds": s.cache_ttl_underlying,
        },
        "default_symbols": [s_["symbol"] for s_ in DEFAULT_SYMBOLS],
        "watchlist": DEFAULT_WATCHLIST,
        "demo_banner": demo_banner(),
    }
