---
name: quant-validation
description: Write and run tests for the quant engine — synthetic chains, hand-computed expected values, finite-difference greek checks, numerical tolerances, and regression tests. Use when adding a formula, changing a calculation, or verifying that engine output is arithmetically correct.
---

# Quant Validation

## Purpose

Prove the numbers are right against something other than the code that produced them.

## When to use

- Any change to `backend/app/quant/`
- A result is disputed or looks wrong
- Before shipping a formula or a sign-convention change

## Inputs

- `backend/tests/conftest.py` — the synthetic chain and the documented tolerances
- `backend/tests/test_black_scholes.py`, `test_gex_engine.py`, `test_levels.py`,
  `test_volatility_and_quality.py`
- An independent reference: a textbook value, a parity identity, or a finite difference

## Workflow

1. **Prefer a hand-computable fixture.** The `synthetic_chain` fixture is four contracts with
   round numbers at spot 100, so every aggregate is arithmetic you can do on paper. Its
   docstring shows the full derivation:
   ```
   per-contract GEX = gamma × OI × 100 × 100² × 0.01 = gamma × OI × 10_000
   net GEX = +500_000 − 1_100_000 = −600_000
   ```
   When the expected value is worked out by hand, the test checks the maths rather than
   checking the code against itself.

2. **Document the tolerance and say why.** `conftest.py` defines:
   - `ABS_TOL = 1e-6` — absolute dollars; exposures run to millions, so this is float noise
   - `REL_TOL = 1e-9` — for closed-form comparisons
   - `FD_TOL = 1e-4` — finite-difference greek checks are only good to a few decimals
   Never introduce an undocumented tolerance, and never loosen one to make a test pass without
   explaining the numerical reason.

3. **Verify greeks three ways:**
   - against an independently computed reference value
   - by finite difference of the greek they differentiate
     (gamma vs dDelta/dS, vanna vs dDelta/dSigma, charm vs −dDelta/dT)
   - by an identity such as put-call parity

4. **Test the edge cases that live chains actually contain:** missing gamma, missing IV, zero
   OI, negative OI, zero volume, deep ITM and OTM, zero DTE, empty chain, single-sided strikes,
   absent multiplier.

5. **Test invariants, not just values.** These catch whole classes of regression:
   - `net_gex == call_gex + put_gex`
   - by-strike sums == totals
   - by-expiry sums == totals
   - `all_positive` convention makes net == absolute
   - inverting the convention negates net GEX exactly

6. **When a test fails, decide which side is wrong.** Sometimes the test encodes a false
   assumption — for example, expecting peak gamma at the spot strike when a non-zero rate over a
   one-year tenor puts it near the forward. Fix the wrong one and say which it was in the commit.

## Expected outputs

- Tests with descriptive names stating the property under test
- Expected values derived independently of the implementation
- Documented tolerances

## Validation

```bash
cd backend
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m ruff check .
.venv/Scripts/python.exe -m mypy app
```

All three must pass before a quant change is considered done.

## Failure handling

- Test passes but production is wrong → the fixture is not representative; add a case from the
  real chain that exposed it
- Flaky tolerance → the comparison is relative where it should be absolute, or vice versa
- A finite-difference check fails → try a different step size before doubting the formula;
  too small a step is dominated by floating-point cancellation
