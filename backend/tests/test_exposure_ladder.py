"""Exposure Ladder aggregation and filtering invariants."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.exposure_models import ExpirationMode
from app.models import OptionType
from app.quant import gex_engine as engine
from app.services.exposure_ladder import (
    LadderFilters,
    _gamma_condition,
    _summary,
    aggregate_rows,
    filter_contracts,
)
from tests.conftest import SPOT, make_contract


def test_ladder_aggregates_contract_exposure_before_grouping():
    contracts = [
        make_contract(100, OptionType.CALL, gamma=0.02, delta=0.5, oi=100, volume=20),
        make_contract(100, OptionType.PUT, gamma=0.03, delta=-0.4, oi=50, volume=30),
    ]
    row = aggregate_rows(contracts, SPOT, engine.DEFAULT_CONVENTION)[0]

    assert row.call_gamma == pytest.approx(20_000)
    assert row.put_gamma == pytest.approx(-15_000)
    assert row.net_gamma == pytest.approx(5_000)
    assert row.call_delta == pytest.approx(500_000)
    assert row.put_delta == pytest.approx(200_000)
    assert row.net_delta == pytest.approx(700_000)
    # Raw contract DEX preserves the put delta sign; dealer DEX applies the
    # configured position convention and therefore exposes both interpretations.
    assert row.raw_call_delta == pytest.approx(500_000)
    assert row.raw_put_delta == pytest.approx(-200_000)
    assert row.raw_net_delta == pytest.approx(300_000)
    assert row.call_oi == 100
    assert row.put_oi == 50
    assert row.net_oi == 50
    assert row.total_oi == 150
    assert row.net_volume == -10


def test_all_expirations_sum_same_strike_without_averaging_gamma():
    today = date.today()
    contracts = [
        make_contract(
            100,
            OptionType.CALL,
            gamma=0.01,
            oi=100,
            expiration=today + timedelta(days=1),
            dte=1.2,
        ),
        make_contract(
            100,
            OptionType.CALL,
            gamma=0.04,
            oi=300,
            expiration=today + timedelta(days=7),
            dte=7.2,
        ),
    ]
    row = aggregate_rows(contracts, SPOT, engine.DEFAULT_CONVENTION)[0]
    # (0.01*100 + 0.04*300) * 100 * 100^2 * .01 = 130,000
    assert row.net_gamma == pytest.approx(130_000)
    assert len(row.contracts) == 2


def test_ladder_rows_are_descending_and_distances_are_percent_points():
    contracts = [
        make_contract(95, OptionType.CALL),
        make_contract(100, OptionType.CALL),
        make_contract(105, OptionType.CALL),
    ]
    rows = aggregate_rows(contracts, SPOT, engine.DEFAULT_CONVENTION)
    assert [row.strike for row in rows] == [105, 100, 95]
    assert rows[0].distance == pytest.approx(5)
    assert rows[0].distance_pct == pytest.approx(5)
    assert rows[1].distance_pct == pytest.approx(0)


def test_filter_modes_cover_0dte_1dte_and_bands():
    today = date.today()
    contracts = [
        make_contract(100, OptionType.CALL, dte=0.4, expiration=today),
        make_contract(100, OptionType.CALL, dte=1.4, expiration=today + timedelta(days=1)),
        make_contract(100, OptionType.CALL, dte=6.4, expiration=today + timedelta(days=6)),
        make_contract(100, OptionType.CALL, dte=20.4, expiration=today + timedelta(days=20)),
        make_contract(100, OptionType.CALL, dte=45.4, expiration=today + timedelta(days=45)),
    ]
    assert len(filter_contracts(contracts, SPOT, LadderFilters(ExpirationMode.DTE0))) == 1
    assert len(filter_contracts(contracts, SPOT, LadderFilters(ExpirationMode.DTE1))) == 1
    assert len(filter_contracts(contracts, SPOT, LadderFilters(ExpirationMode.LE7))) == 3
    assert len(filter_contracts(contracts, SPOT, LadderFilters(ExpirationMode.LE30))) == 4
    assert len(filter_contracts(contracts, SPOT, LadderFilters(ExpirationMode.ALL))) == 5


def test_custom_expiration_and_strike_range_filters():
    today = date.today()
    target = today + timedelta(days=7)
    contracts = [
        make_contract(98, OptionType.CALL, dte=7, expiration=target),
        make_contract(104, OptionType.CALL, dte=7, expiration=target),
        make_contract(99, OptionType.CALL, dte=14, expiration=today + timedelta(days=14)),
    ]
    selected = filter_contracts(
        contracts,
        SPOT,
        LadderFilters(
            expiration_mode=ExpirationMode.CUSTOM,
            expirations=[target],
            strike_range_pct=3,
        ),
    )
    assert [contract.strike for contract in selected] == [98]


def test_missing_greeks_are_computed_from_iv_not_replaced_with_zero():
    contract = make_contract(
        100,
        OptionType.CALL,
        gamma=0,
        delta=0,
        iv=0.2,
        oi=100,
        dte=30,
    )
    row = aggregate_rows([contract], SPOT, engine.DEFAULT_CONVENTION)[0]
    assert row.net_gamma > 0
    assert row.net_delta > 0
    assert row.net_vanna != 0
    assert row.net_charm != 0


def test_near_flip_does_not_round_a_real_distance_to_zero():
    arrays = engine.ChainArrays([make_contract(100, OptionType.CALL)], 100)
    summary = _summary(arrays, 100, engine.DEFAULT_CONVENTION)
    condition = _gamma_condition(summary, 100, 100.005)
    assert condition.flip_proximity_warning is True
    assert condition.flip_distance_pct == pytest.approx(0.005)
    assert "<0.01%" in condition.explanation
