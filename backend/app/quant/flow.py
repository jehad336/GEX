"""Options flow classification.

Deliberately does NOT map call/put to bullish/bearish. A bought call can be a
covered-call unwind; a bought put can be a hedge on a long book. All this module
claims is where the print landed relative to the prevailing quote.
"""

from __future__ import annotations

from app.models import OptionTrade

PREMIUM_TIERS = [50_000, 100_000, 250_000, 500_000, 1_000_000]


def classify_aggressor(
    price: float, bid: float | None, ask: float | None, tol: float = 0.02
) -> str:
    """Where the print sat in the bid/ask. tol is a fraction of the spread."""
    if bid is None or ask is None or ask <= bid:
        return "unknown"
    spread = ask - bid
    mid = (bid + ask) / 2.0
    band = max(spread * tol, 1e-9)

    if price >= ask - band:
        return "at_ask"
    if price <= bid + band:
        return "at_bid"
    if abs(price - mid) <= band:
        return "at_mid"
    return "above_mid" if price > mid else "below_mid"


def enrich_trade(trade: OptionTrade) -> OptionTrade:
    if trade.aggressor == "unknown":
        trade.aggressor = classify_aggressor(trade.price, trade.bid, trade.ask)
    if trade.mid is None and trade.bid is not None and trade.ask is not None:
        trade.mid = (trade.bid + trade.ask) / 2.0
    return trade


def filter_by_premium(trades: list[OptionTrade], min_premium: float) -> list[OptionTrade]:
    return [t for t in trades if t.premium >= min_premium]


def summarise_flow(trades: list[OptionTrade]) -> dict:
    if not trades:
        return {
            "count": 0,
            "total_premium": 0.0,
            "call_premium": 0.0,
            "put_premium": 0.0,
            "by_aggressor": {},
            "tiers": {str(t): 0 for t in PREMIUM_TIERS},
        }

    by_aggressor: dict[str, float] = {}
    call_prem = put_prem = 0.0
    for t in trades:
        by_aggressor[t.aggressor] = by_aggressor.get(t.aggressor, 0.0) + t.premium
        if t.type.value == "call":
            call_prem += t.premium
        else:
            put_prem += t.premium

    return {
        "count": len(trades),
        "total_premium": call_prem + put_prem,
        "call_premium": call_prem,
        "put_premium": put_prem,
        "by_aggressor": by_aggressor,
        "tiers": {
            str(tier): sum(1 for t in trades if t.premium >= tier) for tier in PREMIUM_TIERS
        },
        "note": (
            "Aggressor tagging reflects print location versus quote only. It does not "
            "identify opening versus closing trades or directional intent."
        ),
    }
