---
name: options-quant-engine
description: Work on the Black-Scholes pricing, greeks, and exposure formulas (GEX, DEX, Vanna, Charm, VGEX) in backend/app/quant. Use when adding or changing a greek, an exposure metric, an expected-move or IV calculation, or when a numeric result looks wrong.
---

# Options Quant Engine

## Purpose

Own the mathematics. This layer takes normalized contracts plus a spot price and returns
numbers. It has no knowledge of HTTP, vendors, or React.

## When to use

- Adding a greek or a new exposure metric
- Changing a formula, a scaler, or a sign convention
- Investigating a value that looks numerically wrong
- Adding an IV or expected-move calculation

## Inputs

- `backend/app/quant/black_scholes.py` — vectorized BSM pricing and greeks
- `backend/app/quant/gex_engine.py` — `ChainArrays`, per-contract exposures, aggregation
- `backend/app/quant/volatility.py` — ATM IV, skew, term structure, expected move
- A reference value you can verify independently (a textbook figure, a finite difference,
  or a parity identity)

## Workflow

1. **Write the identity first.** Before implementing, decide how the result will be checked:
   put-call parity, a finite difference of an adjacent greek, a closed-form limit, or a
   hand-computed number. If you cannot state a check, you do not yet understand the formula.

2. **Vectorize over NumPy.** Every function accepts scalars or arrays via `_prep()` and
   `np.broadcast_arrays`. Never loop over contracts — real chains run to thousands of rows.

3. **Handle degenerate inputs as limits, not NaN.** `T <= 0`, `sigma <= 0`, `S <= 0`, `K <= 0`
   all occur in live chains. Return the mathematically correct limit:
   gamma → 0 at expiry, delta → the intrinsic indicator, price → intrinsic.
   The `valid` mask from `d1_d2` exists for this; use it.

4. **Add the exposure to `ChainArrays` and the per-contract functions**, then to
   `compute_totals`, `compute_by_strike`, and `compute_by_expiry` so aggregates stay consistent.
   Every aggregation must sum back to the total.

5. **Respect the provider's multiplier.** `CONTRACT_MULTIPLIER_DEFAULT` is only a fallback for
   when the vendor omits it. Never hard-code 100.

6. **Fill greeks only where you can.** `fill_missing_greeks` computes gamma/delta from IV when
   the vendor omitted them. A contract with neither gamma nor IV contributes zero — it is not
   guessed at.

## Reference formulas

```
GEX   = gamma × OI     × multiplier × spot² × 0.01     # $ per 1% move
VGEX  = gamma × volume × multiplier × spot² × 0.01     # activity proxy, NOT inventory
DEX   = delta × OI     × multiplier × spot
Vanna = vanna × OI     × multiplier × spot × 0.01      # per 1 vol point
Charm = charm × OI     × multiplier × spot / 365       # per calendar day
```

Sign is applied from `SIGN_CONVENTIONS[convention]`, never hard-coded.

## Expected outputs

- A vectorized function with a docstring stating units and sign
- Wiring through totals / by-strike / by-expiry
- Tests in `tests/test_gex_engine.py` or `tests/test_black_scholes.py`

## Validation

```bash
cd backend && .venv/Scripts/python.exe -m pytest tests/test_black_scholes.py tests/test_gex_engine.py -q
```

Required checks for any new greek:
- finite-difference agreement with the greek it differentiates (tolerance `1e-4`, see conftest)
- correct limit at `T=0` and `sigma=0` — a value, not NaN
- array and scalar inputs both work
- aggregation sums to the total within `1e-6`

## Failure handling

- NaN in output → a degenerate input escaped the `valid` mask; fix the mask, do not
  `np.nan_to_num` the symptom
- Aggregate does not match the sum of parts → a sign or filter is applied in one path only
- Result off by 100× → a percentage/decimal confusion; IV is a decimal (0.20), vol points are
  percentages (20%)
