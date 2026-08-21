"""Analytics orchestrator.

Owns the pipeline: provider -> quality gate -> ChainArrays -> engine -> levels.
The API routes are thin wrappers over this; nothing here knows about HTTP.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from app.core.config import get_settings
from app.models import (
    DataOrigin,
    DelayStatus,
    ExpiryGex,
    Freshness,
    GammaProfile,
    GexSnapshot,
    GexTotals,
    Level,
    OptionChain,
    ProfilePoint,
    StrikeGex,
)
from app.providers.base import MarketDataProvider
from app.providers.registry import get_provider
from app.quant import gex_engine as engine
from app.quant import levels as lv
from app.quant import quality, volatility
from app.services.cache import get_cache

log = logging.getLogger("gex.analytics")

MODEL_DISCLAIMER = (
    "Signed exposure, gamma flip, call/put walls and pin risk are MODEL-DERIVED "
    "estimates based on an assumed dealer positioning convention. Open interest, "
    "volume, IV and vendor greeks are observed data. Dealer inventory is not "
    "published and cannot be recovered exactly from a public option chain."
)


@dataclass
class ChainRequest:
    """Everything the UI can vary about which contracts feed a calculation."""

    symbol: str
    max_dte: float | None = None
    min_dte: float | None = None
    expirations: list[date] | None = None
    strike_band_pct: float | None = None
    include_0dte: bool = True
    convention: str | None = None
    provider: str | None = None

    def cache_key(self, prefix: str) -> str:
        exps = ",".join(e.isoformat() for e in self.expirations) if self.expirations else "all"
        return (
            f"{prefix}:{self.symbol.upper()}:{self.provider or 'default'}:"
            f"{self.max_dte}:{self.min_dte}:{exps}:{self.strike_band_pct}:"
            f"{self.include_0dte}:{self.convention}"
        )


@dataclass
class AnalyticsContext:
    """One fully-prepared calculation, reused across every derived metric."""

    chain: OptionChain
    arrays: engine.ChainArrays
    contracts: list
    spot: float
    convention: str
    quality: dict
    provider_name: str
    elapsed_ms: float = 0.0
    by_strike: list[StrikeGex] = field(default_factory=list)


def _settings_convention(explicit: str | None) -> str:
    if explicit and explicit in engine.SIGN_CONVENTIONS:
        return explicit
    cfg = get_settings().gex_sign_convention
    return cfg if cfg in engine.SIGN_CONVENTIONS else engine.DEFAULT_CONVENTION


async def fetch_chain(symbol: str, provider_name: str | None = None) -> OptionChain:
    """Cached raw chain fetch. TTL is deliberately short but non-zero: chains are
    the single most expensive upstream call and OI does not move intraday."""
    settings = get_settings()
    provider: MarketDataProvider = get_provider(provider_name)
    cache = get_cache()
    key = f"chain:{provider.name}:{symbol.upper()}"

    async def load() -> OptionChain:
        started = time.perf_counter()
        chain = await provider.get_option_chain(symbol)
        log.info(
            "chain fetched symbol=%s provider=%s contracts=%d latency_ms=%.0f",
            symbol.upper(), provider.name, len(chain.contracts),
            (time.perf_counter() - started) * 1000,
        )
        return chain

    return await cache.get_or_set(key, settings.cache_ttl_chain, load)


async def build_context(req: ChainRequest) -> AnalyticsContext:
    started = time.perf_counter()
    settings = get_settings()
    convention = _settings_convention(req.convention)

    chain = await fetch_chain(req.symbol, req.provider)
    spot = chain.underlying.price

    clean, report = quality.validate_chain(chain.contracts, req.symbol.upper(), spot)
    if not report.ok:
        log.warning("quality gate flagged %s: %s", req.symbol, report.issues)

    filtered = engine.filter_contracts(
        clean,
        max_dte=req.max_dte,
        min_dte=req.min_dte,
        expirations=req.expirations,
        strike_band_pct=req.strike_band_pct,
        spot=spot,
        include_0dte=req.include_0dte,
    )

    arrays = engine.ChainArrays(filtered, settings.contract_multiplier_default)
    engine.fill_missing_greeks(arrays, spot, settings.risk_free_rate, settings.dividend_yield)

    ctx = AnalyticsContext(
        chain=chain,
        arrays=arrays,
        contracts=filtered,
        spot=spot,
        convention=convention,
        quality=report.to_dict(),
        provider_name=chain.provider,
        elapsed_ms=(time.perf_counter() - started) * 1000,
    )
    ctx.by_strike = engine.compute_by_strike(arrays, spot, convention)
    return ctx


# ------------------------------------------------------------------ metrics


def totals_for(ctx: AnalyticsContext) -> GexTotals:
    return engine.compute_totals(ctx.arrays, ctx.spot, ctx.convention)


def dte0_totals(ctx: AnalyticsContext) -> GexTotals:
    same_day = engine.dte0_contracts(ctx.contracts)
    arrays = engine.ChainArrays(same_day, get_settings().contract_multiplier_default)
    if arrays.size:
        s = get_settings()
        engine.fill_missing_greeks(arrays, ctx.spot, s.risk_free_rate, s.dividend_yield)
    return engine.compute_totals(arrays, ctx.spot, ctx.convention)


def by_expiry_for(ctx: AnalyticsContext) -> list[ExpiryGex]:
    return engine.compute_by_expiry(ctx.arrays, ctx.spot, ctx.convention)


def profile_for(
    ctx: AnalyticsContext, band_pct: float = 0.10, steps: int = 81
) -> GammaProfile:
    s = get_settings()
    prices, net, calls, puts = engine.gamma_profile(
        ctx.arrays, ctx.spot, ctx.convention, band_pct, steps,
        s.risk_free_rate, s.dividend_yield,
    )
    zero = engine.find_zero_gamma(prices, net)
    regime = "positive" if net[len(net) // 2] > 0 else "negative"
    return GammaProfile(
        points=[
            ProfilePoint(price=float(p), net_gex=float(n), call_gex=float(c), put_gex=float(q))
            for p, n, c, q in zip(prices, net, calls, puts, strict=True)
        ],
        spot=ctx.spot,
        zero_gamma=zero,
        regime=regime,
    )


def _dte0_strike_map(ctx: AnalyticsContext) -> dict[float, float]:
    same_day = engine.dte0_contracts(ctx.contracts)
    if not same_day:
        return {}
    arrays = engine.ChainArrays(same_day, get_settings().contract_multiplier_default)
    s = get_settings()
    engine.fill_missing_greeks(arrays, ctx.spot, s.risk_free_rate, s.dividend_yield)
    rows = engine.compute_by_strike(arrays, ctx.spot, ctx.convention)
    return {r.strike: r.net_gex for r in rows}


def levels_for(ctx: AnalyticsContext, profile: GammaProfile | None = None) -> dict[str, Level]:
    profile = profile or profile_for(ctx)
    dte0_map = _dte0_strike_map(ctx)

    flip = lv.make_level(
        "Gamma Flip",
        profile.zero_gamma,
        ctx.spot,
        note=(
            "Interpolated crossing of the modelled net gamma profile. "
            "Model-derived, not exchange reported."
        ),
    )
    cw = lv.call_wall(ctx.by_strike, ctx.spot, dte0_map)
    pw = lv.put_wall(ctx.by_strike, ctx.spot, dte0_map)

    out = {"gamma_flip": flip, "call_wall": cw, "put_wall": pw}

    for field_name, label, key in (
        ("call_oi", "Largest Call OI", "largest_call_oi"),
        ("put_oi", "Largest Put OI", "largest_put_oi"),
        ("call_volume", "Largest Call Volume", "largest_call_volume"),
        ("put_volume", "Largest Put Volume", "largest_put_volume"),
        ("call_gex", "Largest Call Gamma", "largest_call_gamma"),
        ("put_gex", "Largest Put Gamma", "largest_put_gamma"),
    ):
        out[key] = lv.largest_by(ctx.by_strike, field_name, ctx.spot, label)

    return out


async def build_snapshot(req: ChainRequest) -> tuple[GexSnapshot, AnalyticsContext]:
    ctx = await build_context(req)
    started = time.perf_counter()

    totals = totals_for(ctx)
    dte0 = dte0_totals(ctx)
    profile = profile_for(ctx)
    levels = levels_for(ctx, profile)

    dte0_share = (
        abs(dte0.net_gex) / abs(totals.net_gex) if totals.net_gex else 0.0
    )
    regime = lv.classify_regime(
        totals.net_gex, ctx.spot, profile.zero_gamma, dte0.net_gex
    )
    ratios = lv.put_call_ratios(
        totals.call_volume, totals.put_volume, totals.call_oi, totals.put_oi
    )
    em = volatility.expected_move(ctx.contracts, ctx.spot)
    ivs = volatility.iv_summary(ctx.contracts, ctx.spot)

    pin = lv.pin_risk(
        ctx.by_strike,
        ctx.spot,
        min((c.dte for c in ctx.contracts), default=99.0),
        dte0_share,
    )
    levels["pin_risk"] = Level(
        label="Pin Risk",
        price=pin.nearest_strike,
        distance_pct=pin.distance_pct,
        confidence=pin.level,
        note=pin.explanation,
    )

    status = quality.resolve_freshness(ctx.contracts)
    snapshot = GexSnapshot(
        symbol=req.symbol.upper(),
        spot=ctx.spot,
        totals=totals,
        dte0=dte0,
        levels=levels,
        regime=regime,
        ratios=ratios,
        expected_move=em,
        atm_iv=ivs.atm_iv,
        provider=ctx.provider_name,
        computed_at=datetime.now(UTC),
        calculation_ms=(time.perf_counter() - started) * 1000,
        sign_convention=ctx.convention,
        freshness=Freshness(
            status=status,
            as_of=ctx.chain.freshness.as_of,
            source=ctx.provider_name,
            origin=DataOrigin.MODEL_DERIVED,
            note=(
                "Exposure figures are model estimates built on an assumed dealer "
                "positioning convention, using the latest available open interest. "
                "They are not exchange-reported dealer inventory."
            ),
        ),
    )
    return snapshot, ctx


def snapshot_envelope(snapshot: GexSnapshot, ctx: AnalyticsContext) -> dict:
    """The single wire format for a GEX snapshot.

    REST and WebSocket must emit exactly this, otherwise a pushed frame silently
    drops the quality report and the demo banner that the UI relies on.
    """
    return {
        **snapshot.model_dump(mode="json"),
        "quality": ctx.quality,
        "disclaimer": MODEL_DISCLAIMER,
        "demo_banner": demo_banner(),
    }


def market_status(now: datetime | None = None) -> dict:
    """US equity session state in America/New_York. Holidays are not modelled."""
    from zoneinfo import ZoneInfo

    ny = ZoneInfo("America/New_York")
    now = (now or datetime.now(UTC)).astimezone(ny)
    minutes = now.hour * 60 + now.minute
    weekend = now.weekday() >= 5

    if weekend or minutes < 4 * 60:
        state = "CLOSED"
    elif minutes < 9 * 60 + 30:
        state = "PRE_MARKET"
    elif minutes < 16 * 60:
        state = "OPEN"
    elif minutes < 20 * 60:
        state = "AFTER_HOURS"
    else:
        state = "CLOSED"

    return {
        "state": state,
        "timezone": "America/New_York",
        "local_time": now.isoformat(),
        "utc_time": datetime.now(UTC).isoformat(),
        "note": "Exchange holidays are not accounted for.",
    }


def demo_banner() -> dict | None:
    s = get_settings()
    if s.effective_provider() == "demo":
        return {
            "demo": True,
            "message": (
                "DEMO DATA - synthetic option chain generated locally. "
                "Not market data. Set DEMO_MODE=false and provide a provider API key "
                "for real quotes."
            ),
            "delay_status": DelayStatus.DEMO.value,
        }
    return None
