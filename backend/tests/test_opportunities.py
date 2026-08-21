"""Deterministic opportunity-scanner rules and de-duplication."""

from types import SimpleNamespace

from app.models import DelayStatus, Level, OptionType
from app.services.opportunities import OpportunityScanner
from tests.conftest import make_contract


def test_negative_gamma_scanner_records_explainable_liquid_contract():
    contracts = [
        make_contract(102, OptionType.CALL, dte=3, delta=0.45, oi=2000, volume=500),
        make_contract(105, OptionType.CALL, dte=3, delta=0.30, oi=500, volume=50),
        make_contract(98, OptionType.PUT, dte=3, delta=-0.40, oi=1500, volume=300),
    ]
    snapshot = SimpleNamespace(
        symbol="TEST",
        spot=101.0,
        totals=SimpleNamespace(net_gex=-1_000_000.0),
        levels={
            "gamma_flip": Level(label="Gamma Flip", price=100.0),
            "call_wall": Level(label="Call Wall", price=103.0),
            "put_wall": Level(label="Put Wall", price=97.0),
        },
        freshness=SimpleNamespace(status=DelayStatus.DEMO),
        sign_convention="calls_positive_puts_negative",
    )
    context = SimpleNamespace(contracts=contracts, provider_name="demo")
    scanner = OpportunityScanner()

    created = scanner.evaluate(snapshot, context)

    assert len(created) == 1
    candidate = created[0]
    assert candidate.direction == "call"
    assert candidate.option_symbol == contracts[0].symbol
    assert candidate.score >= 65
    assert candidate.demo is True
    assert candidate.score_components["market_structure"] == 35
    assert "not investment advice" in candidate.disclaimer

    # The same snapshot cannot spam the log during the cooldown window.
    assert scanner.evaluate(snapshot, context) == []
    assert len(scanner.records) == 1


def test_scanner_returns_no_candidate_without_gamma_flip():
    snapshot = SimpleNamespace(
        symbol="TEST",
        spot=100.0,
        totals=SimpleNamespace(net_gex=-1.0),
        levels={"gamma_flip": Level(label="Gamma Flip", price=None)},
        freshness=SimpleNamespace(status=DelayStatus.LIVE),
        sign_convention="calls_positive_puts_negative",
    )
    context = SimpleNamespace(
        contracts=[make_contract(100, OptionType.CALL, dte=3, delta=0.5)],
        provider_name="test",
    )
    assert OpportunityScanner().evaluate(snapshot, context) == []

