"""Risk-free rate and dividend yield inputs for the pricing model.

The rate is a real input to every greek this app computes, so it is resolved
through a provider rather than pinned in a formula. Today the only source is
configuration; a Treasury feed can be added behind the same interface without
touching the quant code.

Dividend yield matters for the same reason: a cash-settled index and a
dividend-paying single name do not price the same way, and assuming q=0 for
everything biases delta and charm on the equities.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import date

log = logging.getLogger("gex.rates")

# Cash-settled index options are European and have no dividend on the index
# itself; the forward already carries the constituents' yield.
INDEX_SYMBOLS = {"SPX", "XSP", "NDX", "RUT", "DJI", "VIX", "OEX"}

# Broad-market ETFs distribute dividends, so a non-zero q is closer to correct
# than assuming zero. These are indicative annual yields, not live data, and are
# only used when no better source is configured.
DEFAULT_ETF_YIELDS = {
    "SPY": 0.0125, "QQQ": 0.0055, "IWM": 0.0125, "DIA": 0.0165,
}


class ExerciseStyle:
    """Exercise style drives whether a European model is the right one."""

    EUROPEAN = "european"
    AMERICAN = "american"


class RiskFreeRateProvider(ABC):
    """Interface for rate resolution. Swap the implementation, not the callers."""

    @abstractmethod
    def rate(self, as_of: date | None = None, tenor_years: float | None = None) -> float:
        """Continuously-compounded annual risk-free rate."""

    @abstractmethod
    def dividend_yield(self, symbol: str) -> float:
        """Continuous annual dividend yield for the underlying."""

    def source(self) -> str:
        return self.__class__.__name__


class StaticRiskFreeRateProvider(RiskFreeRateProvider):
    """Configuration-backed rates. The MVP default.

    A flat curve is a real approximation: it ignores the term structure, which
    matters most for long-dated options and barely at all for the 0-30 DTE range
    this dashboard focuses on.
    """

    def __init__(self, rate: float, default_dividend_yield: float = 0.0):
        self._rate = rate
        self._q = default_dividend_yield

    def rate(self, as_of: date | None = None, tenor_years: float | None = None) -> float:
        return self._rate

    def dividend_yield(self, symbol: str) -> float:
        sym = symbol.upper().strip()
        if sym in INDEX_SYMBOLS:
            # The index level is already ex-dividend; applying a yield would
            # double-count it.
            return 0.0
        if self._q:
            return self._q
        return DEFAULT_ETF_YIELDS.get(sym, 0.0)

    def source(self) -> str:
        return f"static(RISK_FREE_RATE={self._rate})"


def exercise_style(symbol: str) -> str:
    """Cash-settled index options are European; listed equity options are American.

    The engine prices with Black-Scholes-Merton either way. For indices that is
    exact. For American equity options it is an approximation that is close for
    the near-the-money, short-dated contracts that carry the gamma, and least
    accurate for deep-ITM puts where early exercise has value.
    """
    return (
        ExerciseStyle.EUROPEAN
        if symbol.upper().strip() in INDEX_SYMBOLS
        else ExerciseStyle.AMERICAN
    )


_provider: RiskFreeRateProvider | None = None


def get_rate_provider() -> RiskFreeRateProvider:
    global _provider
    if _provider is None:
        from app.core.config import get_settings

        s = get_settings()
        _provider = StaticRiskFreeRateProvider(s.risk_free_rate, s.dividend_yield)
        log.info("rate provider: %s", _provider.source())
    return _provider


def set_rate_provider(provider: RiskFreeRateProvider) -> None:
    """Test seam, and the hook a future Treasury-backed provider plugs into."""
    global _provider
    _provider = provider
