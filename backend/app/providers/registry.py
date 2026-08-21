"""Provider registry - the only place that knows which adapters exist."""

from __future__ import annotations

import logging

from app.core.config import Settings, get_settings
from app.providers.base import MarketDataProvider, ProviderError
from app.providers.demo import DemoProvider
from app.providers.massive import MassiveProvider
from app.providers.orats import OratsClient
from app.providers.tradier import TradierProvider

log = logging.getLogger("gex.registry")

_instances: dict[str, MarketDataProvider] = {}
_orats: OratsClient | None = None


def build_provider(name: str, settings: Settings) -> MarketDataProvider:
    kw = {"timeout": settings.http_timeout, "max_retries": settings.max_retries}
    if name == "massive":
        return MassiveProvider(
            settings.massive_api_key,
            settings.massive_base_url,
            settings.massive_ws_url,
            realtime_entitled=settings.massive_realtime,
            **kw,
        )
    if name == "tradier":
        return TradierProvider(settings.tradier_api_key, settings.tradier_base_url, **kw)
    if name == "demo":
        return DemoProvider(**kw)
    raise ValueError(f"unknown provider: {name}")


def get_provider(name: str | None = None) -> MarketDataProvider:
    """Resolve a provider instance.

    A caller that names a provider explicitly gets that provider or an error -
    never a silent substitution. Only the implicit path (name=None) falls back,
    and that fallback is resolved in Settings.effective_provider().
    """
    settings = get_settings()

    if name is not None:
        if name not in ("massive", "tradier", "demo"):
            raise ProviderError(name, f"unknown provider '{name}'")
        if name != "demo" and not settings.has_credentials(name):
            raise ProviderError(
                name,
                f"provider '{name}' was requested explicitly but has no API key configured. "
                f"Set {name.upper()}_API_KEY, or omit the provider parameter to use the "
                "configured default.",
            )
        resolved = name
    else:
        resolved = settings.effective_provider()

    if resolved not in _instances:
        _instances[resolved] = build_provider(resolved, settings)
        log.info("initialised provider: %s", resolved)
    return _instances[resolved]


def get_orats() -> OratsClient:
    global _orats
    if _orats is None:
        s = get_settings()
        _orats = OratsClient(s.orats_api_key, s.orats_base_url, s.http_timeout)
    return _orats


def available_providers() -> list[str]:
    s = get_settings()
    return [p for p in ("massive", "tradier", "demo") if p == "demo" or s.has_credentials(p)]


async def shutdown_providers() -> None:
    for p in _instances.values():
        await p.aclose()
    _instances.clear()
