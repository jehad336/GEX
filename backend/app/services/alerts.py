"""Alert rule evaluation.

In-process and in-app only: this module produces events that the dashboard
renders. It deliberately sends nothing outward - no email, no push, no webhook.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

RuleType = Literal[
    "approach_flip",
    "cross_flip",
    "approach_call_wall",
    "approach_put_wall",
    "gex_sign_change",
    "dte0_gex_spike",
    "high_volume_oi",
]

DEFAULT_DISTANCES = [0.25, 0.5, 1.0]


@dataclass
class AlertRule:
    symbol: str
    rule_type: RuleType
    threshold_pct: float = 0.5
    threshold_abs: float | None = None
    enabled: bool = True
    id: int = 0


@dataclass
class AlertEvent:
    symbol: str
    rule_type: str
    message: str
    spot: float | None = None
    level_price: float | None = None
    fired_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    acknowledged: bool = False

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "rule_type": self.rule_type,
            "message": self.message,
            "spot": self.spot,
            "level_price": self.level_price,
            "fired_at": self.fired_at.isoformat(),
            "acknowledged": self.acknowledged,
        }


class AlertEngine:
    """Evaluates rules against consecutive snapshots. State lives in memory."""

    def __init__(self, max_events: int = 200):
        self.rules: list[AlertRule] = []
        self.events: list[AlertEvent] = []
        self.max_events = max_events
        self._last: dict[str, dict] = {}

    def add_rule(self, rule: AlertRule) -> AlertRule:
        rule.id = (max((r.id for r in self.rules), default=0)) + 1
        self.rules.append(rule)
        return rule

    def remove_rule(self, rule_id: int) -> bool:
        before = len(self.rules)
        self.rules = [r for r in self.rules if r.id != rule_id]
        return len(self.rules) < before

    def _emit(self, event: AlertEvent) -> None:
        self.events.insert(0, event)
        del self.events[self.max_events:]

    def evaluate(self, snapshot) -> list[AlertEvent]:
        """Compare this snapshot against the previous one for the same symbol."""
        sym = snapshot.symbol
        spot = snapshot.spot
        prev = self._last.get(sym)
        fired: list[AlertEvent] = []

        flip = getattr(snapshot.levels.get("gamma_flip"), "price", None)
        call_wall = getattr(snapshot.levels.get("call_wall"), "price", None)
        put_wall = getattr(snapshot.levels.get("put_wall"), "price", None)
        net_gex = snapshot.totals.net_gex

        def pct_away(level: float | None) -> float | None:
            return abs(spot - level) / spot * 100.0 if level and spot else None

        for rule in self.rules:
            if not rule.enabled or rule.symbol.upper() != sym.upper():
                continue

            if rule.rule_type == "approach_flip":
                d = pct_away(flip)
                if d is not None and d <= rule.threshold_pct:
                    fired.append(AlertEvent(
                        sym, rule.rule_type,
                        f"Spot {spot:,.2f} is {d:.2f}% from the modelled gamma flip "
                        f"at {flip:,.2f}.",
                        spot, flip))

            elif rule.rule_type == "cross_flip" and prev and flip and prev.get("flip"):
                was_above = prev["spot"] > prev["flip"]
                is_above = spot > flip
                if was_above != is_above:
                    fired.append(AlertEvent(
                        sym, rule.rule_type,
                        f"Spot crossed the modelled gamma flip "
                        f"({'up' if is_above else 'down'}) at {flip:,.2f}.",
                        spot, flip))

            elif rule.rule_type == "approach_call_wall":
                d = pct_away(call_wall)
                if d is not None and d <= rule.threshold_pct:
                    fired.append(AlertEvent(
                        sym, rule.rule_type,
                        f"Spot {spot:,.2f} is {d:.2f}% from the call wall at "
                        f"{call_wall:,.2f}.", spot, call_wall))

            elif rule.rule_type == "approach_put_wall":
                d = pct_away(put_wall)
                if d is not None and d <= rule.threshold_pct:
                    fired.append(AlertEvent(
                        sym, rule.rule_type,
                        f"Spot {spot:,.2f} is {d:.2f}% from the put wall at "
                        f"{put_wall:,.2f}.", spot, put_wall))

            elif rule.rule_type == "gex_sign_change" and prev:
                if prev["net_gex"] * net_gex < 0:
                    fired.append(AlertEvent(
                        sym, rule.rule_type,
                        f"Net GEX flipped sign: {prev['net_gex']:,.0f} -> {net_gex:,.0f}.",
                        spot))

            elif rule.rule_type == "dte0_gex_spike" and prev:
                before = abs(prev.get("dte0", 0.0))
                now = abs(snapshot.dte0.net_gex)
                if before > 0 and now / before - 1 >= (rule.threshold_pct / 100.0):
                    fired.append(AlertEvent(
                        sym, rule.rule_type,
                        f"Same-day gamma exposure rose {((now / before) - 1) * 100:.0f}% "
                        "since the last capture.", spot))

        for e in fired:
            self._emit(e)

        self._last[sym] = {
            "spot": spot, "flip": flip, "net_gex": net_gex,
            "dte0": snapshot.dte0.net_gex,
        }
        return fired


_engine: AlertEngine | None = None


def get_alert_engine() -> AlertEngine:
    global _engine
    if _engine is None:
        _engine = AlertEngine()
    return _engine
