"""Risk-free-rate abstraction used by exposure models.

The default implementation is deliberately environment-backed.  Keeping this
behind a protocol lets a Treasury/FRED/market-curve adapter replace it later
without coupling option analytics to an external data source today.
"""

from __future__ import annotations

from typing import Protocol

from app.core.config import get_settings


class RiskFreeRateProvider(Protocol):
    def get_rate(self) -> float:
        """Return the annual continuously-compounded decimal rate."""


class EnvironmentRiskFreeRateProvider:
    def get_rate(self) -> float:
        return get_settings().risk_free_rate


_provider: RiskFreeRateProvider = EnvironmentRiskFreeRateProvider()


def get_risk_free_rate() -> float:
    return _provider.get_rate()

