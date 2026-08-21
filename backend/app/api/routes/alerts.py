"""In-app alert rules and the event log. Nothing is sent outside the browser."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.alerts import DEFAULT_DISTANCES, AlertRule, get_alert_engine

router = APIRouter(prefix="/alerts", tags=["alerts"])

RULE_TYPES = [
    "approach_flip", "cross_flip", "approach_call_wall", "approach_put_wall",
    "gex_sign_change", "dte0_gex_spike", "high_volume_oi",
]


class RuleIn(BaseModel):
    symbol: str
    rule_type: str
    threshold_pct: float = Field(0.5, gt=0, le=25)
    threshold_abs: float | None = None
    enabled: bool = True


@router.get("")
async def list_alerts() -> dict:
    engine = get_alert_engine()
    return {
        "rules": [r.__dict__ for r in engine.rules],
        "events": [e.to_dict() for e in engine.events],
        "rule_types": RULE_TYPES,
        "default_distances_pct": DEFAULT_DISTANCES,
        "delivery": "in-app only - no external notifications are sent",
    }


@router.post("")
async def create_alert(rule: RuleIn) -> dict:
    if rule.rule_type not in RULE_TYPES:
        raise HTTPException(422, f"unknown rule_type; expected one of {RULE_TYPES}")
    created = get_alert_engine().add_rule(
        AlertRule(
            symbol=rule.symbol.upper(),
            rule_type=rule.rule_type,  # type: ignore[arg-type]
            threshold_pct=rule.threshold_pct,
            threshold_abs=rule.threshold_abs,
            enabled=rule.enabled,
        )
    )
    return {"rule": created.__dict__}


@router.delete("/{rule_id}")
async def delete_alert(rule_id: int) -> dict:
    if not get_alert_engine().remove_rule(rule_id):
        raise HTTPException(404, "rule not found")
    return {"deleted": rule_id}


@router.post("/events/acknowledge")
async def acknowledge_events() -> dict:
    engine = get_alert_engine()
    for e in engine.events:
        e.acknowledged = True
    return {"acknowledged": len(engine.events)}
