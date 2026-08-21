"""Shared fixtures, including a synthetic chain small enough to check by hand."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.models import DelayStatus, OptionContract, OptionType

SPOT = 100.0
# Tolerances used across the quant tests, documented once here.
#   ABS_TOL: absolute dollars of exposure - exposures run into the millions, so a
#            sub-cent absolute tolerance is meaningless; 1e-6 is float noise.
#   REL_TOL: relative tolerance for Black-Scholes values checked against
#            independently computed reference numbers.
ABS_TOL = 1e-6
REL_TOL = 1e-9
# Greeks cross-checked by finite difference are only good to a few decimals.
FD_TOL = 1e-4


def make_contract(
    strike: float,
    option_type: OptionType,
    *,
    gamma: float = 0.01,
    oi: int = 1000,
    volume: int = 100,
    dte: float = 30.0,
    iv: float | None = 0.20,
    delta: float | None = None,
    multiplier: int = 100,
    expiration: date | None = None,
    underlying: str = "TEST",
) -> OptionContract:
    exp = expiration or (date.today() + timedelta(days=int(dte)))
    return OptionContract(
        symbol=f"{underlying}{exp:%y%m%d}{'C' if option_type == OptionType.CALL else 'P'}"
               f"{int(strike * 1000):08d}",
        underlying=underlying,
        expiration=exp,
        dte=dte,
        strike=strike,
        type=option_type,
        multiplier=multiplier,
        bid=1.0,
        ask=1.1,
        mid=1.05,
        last=1.05,
        volume=volume,
        open_interest=oi,
        iv=iv,
        delta=delta,
        gamma=gamma,
        underlying_price=SPOT,
        quote_timestamp=datetime.now(UTC),
        source="test",
        delay_status=DelayStatus.DEMO,
    )


@pytest.fixture
def synthetic_chain() -> list[OptionContract]:
    """Four contracts with round numbers, so every aggregate is checkable by hand.

    With spot = 100, multiplier = 100 and the 0.01 percent-move scaler:
        per-contract GEX = gamma * OI * 100 * 100^2 * 0.01 = gamma * OI * 10_000

        95C : 0.010 * 1000 * 10_000 = +100_000
        105C: 0.020 * 2000 * 10_000 = +400_000   -> call GEX = +500_000
        95P : 0.030 * 3000 * 10_000 = -900_000
        105P: 0.040 *  500 * 10_000 = -200_000   -> put GEX  = -1_100_000

        net GEX      = -600_000
        absolute GEX = 1_600_000
    """
    return [
        make_contract(95.0, OptionType.CALL, gamma=0.010, oi=1000, volume=10),
        make_contract(105.0, OptionType.CALL, gamma=0.020, oi=2000, volume=20),
        make_contract(95.0, OptionType.PUT, gamma=0.030, oi=3000, volume=30),
        make_contract(105.0, OptionType.PUT, gamma=0.040, oi=500, volume=40),
    ]


@pytest.fixture
def expected_synthetic() -> dict:
    return {
        "call_gex": 500_000.0,
        "put_gex": -1_100_000.0,
        "net_gex": -600_000.0,
        "absolute_gex": 1_600_000.0,
        "call_oi": 3000,
        "put_oi": 3500,
        "call_volume": 30,
        "put_volume": 70,
        "by_strike": {
            95.0: {"call": 100_000.0, "put": -900_000.0, "net": -800_000.0},
            105.0: {"call": 400_000.0, "put": -200_000.0, "net": 200_000.0},
        },
    }
