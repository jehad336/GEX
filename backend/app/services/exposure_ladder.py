"""Exposure Ladder aggregation.

The service receives normalized contracts, calculates every contract exposure,
then aggregates by strike. It never averages a Greek and multiplies aggregate
open interest: that shortcut is wrong when expirations, IVs, or multipliers differ.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime

import numpy as np

from app.core.config import get_settings
from app.exposure_models import (
    ExpirationChoice,
    ExpirationContribution,
    ExpirationMode,
    ExpirationSelection,
    ExposureLadderResponse,
    ExposureLadderRow,
    ExposureSummary,
    GammaCondition,
    LadderContract,
    LadderFreshness,
)
from app.models import DataOrigin, DelayStatus, Level, OptionContract, StrikeGex
from app.quant import gex_engine as engine
from app.quant import levels as lv
from app.quant import quality, volatility
from app.services import analytics
from app.services.analytics import AnalyticsContext
from app.services.rates import get_risk_free_rate


@dataclass(frozen=True)
class LadderFilters:
    expiration_mode: ExpirationMode = ExpirationMode.ALL
    expirations: list[date] = field(default_factory=list)
    max_dte: float | None = None
    strike_range_pct: float | None = 3.0
    include_0dte: bool = True


def is_monthly_expiration(value: date) -> bool:
    """Standard monthly equity expiry: the third Friday of the month."""
    return value.weekday() == 4 and 15 <= value.day <= 21


def filter_contracts(
    contracts: list[OptionContract], spot: float, filters: LadderFilters
) -> list[OptionContract]:
    selected = set(filters.expirations)
    out: list[OptionContract] = []
    for contract in contracts:
        if not filters.include_0dte and contract.dte < 1:
            continue
        if filters.max_dte is not None and contract.dte > filters.max_dte:
            continue

        mode = filters.expiration_mode
        if mode == ExpirationMode.DTE0 and contract.dte >= 1:
            continue
        if mode == ExpirationMode.DTE1 and not (1 <= contract.dte < 2):
            continue
        if mode == ExpirationMode.LE7 and contract.dte > 7:
            continue
        if mode == ExpirationMode.LE30 and contract.dte > 30:
            continue
        if mode == ExpirationMode.MONTHLY and not is_monthly_expiration(contract.expiration):
            continue
        if (
            mode in (ExpirationMode.CUSTOM, ExpirationMode.SINGLE, ExpirationMode.MULTIPLE)
            and (not selected or contract.expiration not in selected)
        ):
            continue

        if (
            filters.strike_range_pct is not None
            and spot > 0
            and abs(contract.strike - spot) / spot * 100 > filters.strike_range_pct
        ):
            continue
        out.append(contract)
    return out


def _arrays(
    contracts: list[OptionContract], spot: float
) -> engine.ChainArrays:
    settings = get_settings()
    arrays = engine.ChainArrays(contracts, settings.contract_multiplier_default)
    if arrays.size:
        engine.fill_missing_greeks(
            arrays, spot, get_risk_free_rate(), settings.dividend_yield
        )
    return arrays


def _summary(arrays: engine.ChainArrays, spot: float, convention: str) -> ExposureSummary:
    totals = engine.compute_totals(arrays, spot, convention)
    raw_dex = arrays.delta * arrays.oi * arrays.multiplier * spot
    calls, puts = arrays.is_call, ~arrays.is_call
    total_oi = totals.call_oi + totals.put_oi
    total_volume = totals.call_volume + totals.put_volume
    return ExposureSummary(
        net_gex=totals.net_gex,
        call_gex=totals.call_gex,
        put_gex=totals.put_gex,
        absolute_gex=totals.absolute_gex,
        net_dex=totals.net_dex,
        call_dex=totals.call_dex,
        put_dex=totals.put_dex,
        raw_net_dex=float(raw_dex.sum()),
        raw_call_dex=float(raw_dex[calls].sum()),
        raw_put_dex=float(raw_dex[puts].sum()),
        net_vanna=totals.net_vanna,
        net_charm=totals.net_charm,
        total_oi=total_oi,
        call_oi=totals.call_oi,
        put_oi=totals.put_oi,
        total_volume=total_volume,
        call_volume=totals.call_volume,
        put_volume=totals.put_volume,
        put_call_oi_ratio=(totals.put_oi / totals.call_oi) if totals.call_oi else None,
        put_call_volume_ratio=(
            totals.put_volume / totals.call_volume if totals.call_volume else None
        ),
        contract_count=totals.contract_count,
    )


def aggregate_rows(
    contracts: list[OptionContract], spot: float, convention: str
) -> list[ExposureLadderRow]:
    arrays = _arrays(contracts, spot)
    if not arrays.size:
        return []

    gex = engine.gex_per_contract(arrays, spot, convention)
    dex = engine.dex_per_contract(arrays, spot, convention)
    raw_dex = arrays.delta * arrays.oi * arrays.multiplier * spot
    vanna = engine.vanna_per_contract(arrays, spot, convention)
    charm = engine.charm_per_contract(arrays, spot, convention)
    rows: list[ExposureLadderRow] = []

    for strike in sorted(np.unique(arrays.strike), reverse=True):
        mask = arrays.strike == strike
        calls = mask & arrays.is_call
        puts = mask & ~arrays.is_call
        indexes = np.flatnonzero(mask)
        live_iv = indexes[arrays.iv[indexes] > 0]
        weighted_iv = None
        if live_iv.size:
            weights = arrays.oi[live_iv].astype(float)
            weighted_iv = float(
                np.average(arrays.iv[live_iv], weights=weights)
                if weights.sum() > 0 else arrays.iv[live_iv].mean()
            )

        details = [
            LadderContract(
                symbol=contracts[i].symbol,
                expiration=contracts[i].expiration,
                dte=contracts[i].dte,
                type=contracts[i].type.value,
                strike=contracts[i].strike,
                multiplier=int(arrays.multiplier[i]),
                open_interest=int(arrays.oi[i]),
                volume=int(arrays.volume[i]),
                bid=contracts[i].bid,
                ask=contracts[i].ask,
                iv=float(arrays.iv[i]) if arrays.iv[i] > 0 else None,
                delta=float(arrays.delta[i]),
                gamma=float(arrays.gamma[i]),
                gex=float(gex[i]),
                dex=float(dex[i]),
                raw_dex=float(raw_dex[i]),
                vanna_exposure=float(vanna[i]),
                charm_exposure=float(charm[i]),
            )
            for i in indexes
        ]
        call_oi = int(arrays.oi[calls].sum())
        put_oi = int(arrays.oi[puts].sum())
        call_volume = int(arrays.volume[calls].sum())
        put_volume = int(arrays.volume[puts].sum())
        rows.append(
            ExposureLadderRow(
                strike=float(strike),
                distance=float(strike - spot),
                distance_pct=float((strike - spot) / spot * 100) if spot else 0.0,
                net_delta=float(dex[mask].sum()),
                call_delta=float(dex[calls].sum()),
                put_delta=float(dex[puts].sum()),
                raw_net_delta=float(raw_dex[mask].sum()),
                raw_call_delta=float(raw_dex[calls].sum()),
                raw_put_delta=float(raw_dex[puts].sum()),
                net_gamma=float(gex[mask].sum()),
                call_gamma=float(gex[calls].sum()),
                put_gamma=float(gex[puts].sum()),
                net_vanna=float(vanna[mask].sum()),
                call_vanna=float(vanna[calls].sum()),
                put_vanna=float(vanna[puts].sum()),
                net_charm=float(charm[mask].sum()),
                call_charm=float(charm[calls].sum()),
                put_charm=float(charm[puts].sum()),
                net_oi=call_oi - put_oi,
                total_oi=call_oi + put_oi,
                call_oi=call_oi,
                put_oi=put_oi,
                net_volume=call_volume - put_volume,
                total_volume=call_volume + put_volume,
                call_volume=call_volume,
                put_volume=put_volume,
                iv=weighted_iv,
                absolute_gex=float(np.abs(gex[mask]).sum()),
                contracts=details,
            )
        )
    return rows


def _to_strike_gex(rows: list[ExposureLadderRow]) -> list[StrikeGex]:
    return [
        StrikeGex(
            strike=row.strike,
            call_gex=row.call_gamma,
            put_gex=row.put_gamma,
            net_gex=row.net_gamma,
            call_oi=row.call_oi,
            put_oi=row.put_oi,
            total_oi=row.total_oi,
            call_volume=row.call_volume,
            put_volume=row.put_volume,
            call_dex=row.call_delta,
            put_dex=row.put_delta,
            net_dex=row.net_delta,
            net_vanna=row.net_vanna,
            net_charm=row.net_charm,
        )
        for row in rows
    ]


def _crossings(prices: np.ndarray, values: np.ndarray) -> list[float]:
    out: list[float] = []
    for i in range(len(values) - 1):
        x0, x1 = float(prices[i]), float(prices[i + 1])
        y0, y1 = float(values[i]), float(values[i + 1])
        if y0 == 0:
            out.append(x0)
        elif y0 * y1 < 0:
            out.append(x0 - y0 * (x1 - x0) / (y1 - y0))
    if len(values) and values[-1] == 0:
        out.append(float(prices[-1]))
    return list(dict.fromkeys(round(value, 8) for value in out))


def _levels(
    contracts: list[OptionContract], rows: list[ExposureLadderRow], spot: float, convention: str
) -> tuple[dict[str, Level], list[float]]:
    arrays = _arrays(contracts, spot)
    settings = get_settings()
    prices, net, _, _ = engine.gamma_profile(
        arrays,
        spot,
        convention,
        band_pct=0.12,
        steps=161,
        r=get_risk_free_rate(),
        q=settings.dividend_yield,
    )
    crossings = _crossings(prices, net)
    zero = min(crossings, key=lambda value: abs(value - spot)) if crossings else None
    strike_rows = _to_strike_gex(rows)
    levels: dict[str, Level] = {
        "spot": lv.make_level("Spot", spot, spot, origin=DataOrigin.OBSERVED),
        "gamma_flip": lv.make_level(
            "Gamma Flip", zero, spot, note="Nearest interpolated gamma-profile crossing."
        ),
        "call_wall": lv.call_wall(strike_rows, spot),
        "put_wall": lv.put_wall(strike_rows, spot),
        "largest_call_gamma": lv.largest_by(
            strike_rows, "call_gex", spot, "Largest Call Gamma"
        ),
        "largest_put_gamma": lv.largest_by(
            strike_rows, "put_gex", spot, "Largest Put Gamma"
        ),
        "largest_call_oi": lv.largest_by(
            strike_rows, "call_oi", spot, "Largest Call OI"
        ),
        "largest_put_oi": lv.largest_by(
            strike_rows, "put_oi", spot, "Largest Put OI"
        ),
    }
    lower = max((value for value in crossings if value < spot), default=None)
    upper = min((value for value in crossings if value > spot), default=None)
    levels["lower_gamma_transition"] = lv.make_level(
        "Lower Gamma Transition", lower, spot
    )
    levels["upper_gamma_transition"] = lv.make_level(
        "Upper Gamma Transition", upper, spot
    )
    return levels, crossings


def _gamma_condition(
    summary: ExposureSummary, spot: float, gamma_flip: float | None
) -> GammaCondition:
    gex_den = abs(summary.call_gex) + abs(summary.put_gex)
    oi_den = summary.total_oi
    volume_den = summary.total_volume
    gex_share = abs(summary.call_gex) / gex_den if gex_den else 0.5
    oi_share = summary.call_oi / oi_den if oi_den else 0.5
    volume_share = summary.call_volume / volume_den if volume_den else 0.5
    score = 0.5 * gex_share + 0.25 * oi_share + 0.25 * volume_share
    positioning = "Call Dominated" if score >= 0.60 else "Put Dominated" if score <= 0.40 else "Balanced"
    flip_distance = abs(spot - gamma_flip) / spot * 100 if gamma_flip and spot else None
    near_flip = flip_distance is not None and flip_distance <= 0.5
    flip_proximity_warning = flip_distance is not None and flip_distance < 0.05
    gamma_regime = "Positive Gamma" if summary.net_gex > 0 else "Negative Gamma" if summary.net_gex < 0 else "Balanced Gamma"
    label = "Near Gamma Flip" if near_flip else gamma_regime
    return GammaCondition(
        label=label,
        gamma_regime=gamma_regime,
        positioning=positioning,
        call_dominance_score=round(score, 4),
        near_flip=near_flip,
        flip_distance_pct=flip_distance,
        flip_proximity_warning=flip_proximity_warning,
        explanation=(
            f"{positioning}: weighted call share is {score * 100:.1f}% across absolute GEX "
            f"(50%), OI (25%), and volume (25%). {gamma_regime}."
            + (
                " Spot is <0.01% from the gamma flip."
                if flip_distance is not None and 0 < flip_distance < 0.01
                else f" Spot is {flip_distance:.2f}% from the gamma flip."
                if flip_distance is not None
                else ""
            )
        ),
        methodology=(
            "Call dominance = 50% absolute-GEX share + 25% OI share + 25% volume "
            "share. >=60% is call dominated, <=40% put dominated. Near flip means "
            "spot is within 0.50% of the nearest repriced gamma-profile crossing."
        ),
    )


def _expiration_contributions(
    contracts: list[OptionContract], spot: float, convention: str
) -> list[ExpirationContribution]:
    arrays = _arrays(contracts, spot)
    if not arrays.size:
        return []
    gex = engine.gex_per_contract(arrays, spot, convention)
    total_absolute = float(np.abs(gex).sum())
    output: list[ExpirationContribution] = []
    for expiration in sorted(set(arrays.expiration)):
        indexes = np.array([i for i, value in enumerate(arrays.expiration) if value == expiration])
        calls = indexes[arrays.is_call[indexes]]
        puts = indexes[~arrays.is_call[indexes]]
        absolute = float(np.abs(gex[indexes]).sum())
        output.append(
            ExpirationContribution(
                expiration=expiration,
                dte=float(arrays.dte[indexes].min()),
                call_gex=float(gex[calls].sum()) if calls.size else 0.0,
                put_gex=float(gex[puts].sum()) if puts.size else 0.0,
                net_gex=float(gex[indexes].sum()),
                absolute_gex=absolute,
                total_oi=int(arrays.oi[indexes].sum()),
                share_of_absolute=(absolute / total_absolute * 100) if total_absolute else 0.0,
            )
        )
    return output


def _expiration_selection(
    all_contracts: list[OptionContract], selected_contracts: list[OptionContract], mode: ExpirationMode
) -> ExpirationSelection:
    selected = sorted({contract.expiration for contract in selected_contracts})
    selected_set = set(selected)
    by_expiration: dict[date, float] = {}
    for contract in all_contracts:
        by_expiration[contract.expiration] = min(
            contract.dte, by_expiration.get(contract.expiration, contract.dte)
        )
    available = []
    for expiration, dte in sorted(by_expiration.items()):
        monthly = is_monthly_expiration(expiration)
        is_0dte = dte < 1
        kind = "0DTE" if is_0dte else "Monthly" if monthly else "Weekly" if expiration.weekday() == 4 else "Daily"
        available.append(
            ExpirationChoice(
                expiration=expiration,
                dte=dte,
                is_0dte=is_0dte,
                is_monthly=monthly,
                kind=kind,
                selected=expiration in selected_set,
            )
        )
    return ExpirationSelection(mode=mode, selected=selected, available=available)


def build_ladder(ctx: AnalyticsContext, filters: LadderFilters) -> ExposureLadderResponse:
    contracts = filter_contracts(ctx.contracts, ctx.spot, filters)
    rows = aggregate_rows(contracts, ctx.spot, ctx.convention)
    arrays = _arrays(contracts, ctx.spot)
    summary = _summary(arrays, ctx.spot, ctx.convention)
    dte0_contracts = [contract for contract in contracts if contract.dte < 1]
    dte0_summary = _summary(_arrays(dte0_contracts, ctx.spot), ctx.spot, ctx.convention)
    levels, _ = _levels(contracts, rows, ctx.spot, ctx.convention)
    expected_move = volatility.expected_move(contracts, ctx.spot)
    if expected_move:
        levels["expected_move_high"] = lv.make_level("Expected Move High", expected_move.upper, ctx.spot)
        levels["expected_move_low"] = lv.make_level("Expected Move Low", expected_move.lower, ctx.spot)
    underlying = ctx.chain.underlying
    levels["previous_close"] = lv.make_level(
        "Previous Close", underlying.previous_close, ctx.spot, origin=DataOrigin.OBSERVED
    )
    levels["day_open"] = lv.make_level(
        "Day Open", underlying.open, ctx.spot, origin=DataOrigin.OBSERVED
    )

    selected_status = quality.resolve_freshness(contracts) if contracts else DelayStatus.UNKNOWN
    quote_times = [contract.quote_timestamp for contract in contracts if contract.quote_timestamp]
    trade_times = [contract.trade_timestamp for contract in contracts if contract.trade_timestamp]
    oi_times = [contract.oi_timestamp for contract in contracts if contract.oi_timestamp]
    missing_vendor_greeks = sum(
        contract.delta is None or contract.gamma is None for contract in contracts
    )
    if contracts and missing_vendor_greeks == len(contracts):
        greeks_source = "calculated Δ/Γ/Vanna/Charm"
    elif missing_vendor_greeks:
        greeks_source = "mixed vendor/calculated Δ/Γ; calculated Vanna/Charm"
    else:
        greeks_source = "vendor Δ/Γ; calculated Vanna/Charm"
    freshness = LadderFreshness(
        underlying=underlying.delay_status,
        quotes=selected_status,
        trades=selected_status,
        greeks_as_of=max(quote_times) if quote_times else None,
        quote_as_of=max(quote_times) if quote_times else None,
        trade_as_of=max(trade_times) if trade_times else None,
        greeks_source=greeks_source,
        open_interest=DelayStatus.PREVIOUS_DAY_OI,
        oi_as_of=max(oi_times) if oi_times else None,
        excluded_contracts=int(ctx.quality.get("dropped", 0)),
        note=(
            "Open interest is a previous-session observation. Signed exposures and "
            "key levels are model-derived from the selected normalized contracts."
        ),
    )
    return ExposureLadderResponse(
        symbol=ctx.chain.underlying.symbol,
        spot=ctx.spot,
        timestamp=datetime.now(UTC),
        provider=ctx.provider_name,
        latency_ms=ctx.elapsed_ms,
        expiration_selection=_expiration_selection(ctx.contracts, contracts, filters.expiration_mode),
        strike_range_pct=filters.strike_range_pct,
        rows=rows,
        summary=summary,
        dte0_summary=dte0_summary,
        key_levels=levels,
        expected_move=expected_move,
        gamma_condition=_gamma_condition(
            summary, ctx.spot, levels["gamma_flip"].price
        ),
        expiration_contributions=_expiration_contributions(contracts, ctx.spot, ctx.convention),
        freshness=freshness,
        previous_close=underlying.previous_close,
        day_open=underlying.open,
        sign_convention=ctx.convention,
        methodology={
            "gex": "Gamma × OI × multiplier × spot² × 0.01, signed by configured convention.",
            "dex": "Assumed dealer DEX = raw contract DEX × configured call/put position sign. Raw DEX = signed option delta × OI × multiplier × spot; both are returned separately.",
            "vanna": "Black-Scholes-Merton dDelta/dVol × OI × multiplier × spot × 0.01.",
            "charm": "Black-Scholes-Merton dDelta/dTime × OI × multiplier × spot / 365.",
            "net_oi": "Call open interest minus put open interest; both legs are also reported.",
            "aggregation": "Exposure is calculated per contract first, then summed by strike.",
            "rates": f"RiskFreeRateProvider(env)={get_risk_free_rate():g}; dividend yield={get_settings().dividend_yield:g}.",
        },
        disclaimer=analytics.MODEL_DISCLAIMER,
        demo_banner=analytics.demo_banner(),
    )
