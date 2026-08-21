"""Data-quality gate. Runs on every normalized chain before the engine touches it.

Findings are reported, not silently repaired - except for values that would make
the maths meaningless (negative OI/volume), which are clamped and flagged.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime

from app.models import DelayStatus, OptionContract

STALE_AFTER_SECONDS = 15 * 60


class QualityReport:
    def __init__(self) -> None:
        self.issues: list[dict] = []
        self.checked: int = 0
        self.dropped: int = 0

    def add(self, code: str, detail: str, count: int = 1, severity: str = "warning") -> None:
        self.issues.append(
            {"code": code, "detail": detail, "count": count, "severity": severity}
        )

    @property
    def ok(self) -> bool:
        return not any(i["severity"] == "error" for i in self.issues)

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "checked": self.checked,
            "dropped": self.dropped,
            "issues": self.issues,
        }


def validate_chain(
    contracts: list[OptionContract], underlying_symbol: str, spot: float | None = None
) -> tuple[list[OptionContract], QualityReport]:
    report = QualityReport()
    report.checked = len(contracts)
    if not contracts:
        report.add("empty_chain", "Provider returned no option contracts", severity="error")
        return [], report

    now = datetime.now(UTC)
    seen: Counter[tuple] = Counter()
    clean: list[OptionContract] = []

    counts: Counter[str] = Counter()
    for c in contracts:
        key = (c.underlying, c.expiration, c.strike, c.type)
        seen[key] += 1
        if seen[key] > 1:
            counts["duplicate_contract"] += 1
            report.dropped += 1
            continue

        if c.underlying.upper() != underlying_symbol.upper():
            counts["underlying_mismatch"] += 1
            report.dropped += 1
            continue

        if c.strike <= 0:
            counts["invalid_strike"] += 1
            report.dropped += 1
            continue

        if c.dte < 0:
            counts["expired_contract"] += 1
            report.dropped += 1
            continue

        if c.open_interest < 0:
            counts["negative_oi"] += 1
            c = c.model_copy(update={"open_interest": 0})
        if c.volume < 0:
            counts["negative_volume"] += 1
            c = c.model_copy(update={"volume": 0})
        if not c.multiplier or c.multiplier <= 0:
            counts["missing_multiplier"] += 1
            c = c.model_copy(update={"multiplier": 100})
        if c.iv is not None and (c.iv <= 0 or c.iv > 5.0):
            counts["implausible_iv"] += 1
            c = c.model_copy(update={"iv": None})
        if c.gamma is None and c.iv is None:
            counts["no_gamma_no_iv"] += 1
        if c.bid is not None and c.ask is not None and c.bid > c.ask:
            counts["crossed_quote"] += 1

        ts = c.quote_timestamp or c.trade_timestamp
        if ts is not None:
            age = (now - ts.astimezone(UTC)).total_seconds()
            if age > STALE_AFTER_SECONDS:
                counts["stale_quote"] += 1

        if spot and c.strike > spot * 10:
            counts["implausible_strike"] += 1

        clean.append(c)

    severities = {
        "duplicate_contract": "warning",
        "underlying_mismatch": "error",
        "invalid_strike": "error",
        "expired_contract": "warning",
        "negative_oi": "warning",
        "negative_volume": "warning",
        "missing_multiplier": "warning",
        "implausible_iv": "warning",
        "no_gamma_no_iv": "warning",
        "crossed_quote": "info",
        "stale_quote": "warning",
        "implausible_strike": "warning",
    }
    descriptions = {
        "duplicate_contract": "Duplicate (expiry, strike, type) rows dropped",
        "underlying_mismatch": "Contract underlying did not match the requested symbol",
        "invalid_strike": "Strike was zero or negative",
        "expired_contract": "Expiration is already in the past",
        "negative_oi": "Negative open interest clamped to zero",
        "negative_volume": "Negative volume clamped to zero",
        "missing_multiplier": "Contract multiplier missing, defaulted to 100",
        "implausible_iv": "IV outside (0, 500%] discarded",
        "no_gamma_no_iv": "Contract has neither gamma nor IV, contributes nothing to GEX",
        "crossed_quote": "Bid above ask",
        "stale_quote": "Quote timestamp older than 15 minutes",
        "implausible_strike": "Strike more than 10x spot",
    }
    for code, n in counts.items():
        report.add(code, descriptions[code], n, severities[code])

    if not clean:
        report.add("all_contracts_rejected", "Every contract failed validation", severity="error")

    return clean, report


def resolve_freshness(contracts: list[OptionContract]) -> DelayStatus:
    """Worst-case status across the chain. Never upgrade to LIVE on a guess."""
    if not contracts:
        return DelayStatus.UNKNOWN
    statuses = {c.delay_status for c in contracts}
    for worst in (
        DelayStatus.STALE,
        DelayStatus.EOD,
        DelayStatus.DELAYED_15M,
        DelayStatus.UNKNOWN,
        DelayStatus.DEMO,
        DelayStatus.PREVIOUS_DAY_OI,
        DelayStatus.LIVE,
    ):
        if worst in statuses:
            return worst
    return DelayStatus.UNKNOWN
