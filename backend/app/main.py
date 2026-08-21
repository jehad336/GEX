"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import alerts, exposure, gex, history, market, opportunities, options, stream
from app.core.config import get_settings
from app.providers.registry import shutdown_providers
from app.services.cache import get_cache


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    )
    # Never let a stray debug log print a bearer token.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    log = logging.getLogger("gex")
    resolved = settings.effective_provider()
    log.info("starting GEX backend | provider=%s demo_mode=%s", resolved, resolved == "demo")
    if resolved == "demo" and not settings.demo_mode:
        log.warning(
            "DATA_PROVIDER=%s has no API key configured; serving DEMO data instead.",
            settings.data_provider,
        )
    yield
    await shutdown_providers()
    await stream.shutdown_hubs()
    await get_cache().aclose()
    log.info("shutdown complete")


app = FastAPI(
    title="GEX Trading Dashboard API",
    version="0.1.0",
    description=(
        "Options gamma exposure analytics. Observed data (open interest, volume, IV, "
        "vendor greeks) is kept distinct from model-derived metrics (signed GEX, "
        "gamma flip, call/put walls, pin risk)."
    ),
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
    if elapsed_ms > 2000:
        logging.getLogger("gex.api").warning(
            "slow request %s %s took %.0fms", request.method, request.url.path, elapsed_ms
        )
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.getLogger("gex.api").exception("unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": str(exc), "path": request.url.path},
    )


@app.get("/health", tags=["meta"])
async def health() -> dict:
    s = get_settings()
    return {
        "status": "ok",
        "provider": s.effective_provider(),
        "demo_mode": s.effective_provider() == "demo",
        "version": app.version,
    }


api_prefix = "/api"
app.include_router(market.router, prefix=api_prefix)
app.include_router(gex.router, prefix=api_prefix)
app.include_router(exposure.router, prefix=api_prefix)
app.include_router(options.router, prefix=api_prefix)
app.include_router(history.router, prefix=api_prefix)
app.include_router(alerts.router, prefix=api_prefix)
app.include_router(opportunities.router, prefix=api_prefix)
app.include_router(stream.router)
