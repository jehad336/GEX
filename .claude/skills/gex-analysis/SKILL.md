---
name: gex-analysis
description: Work on the derived trading levels — gamma flip, call wall, put wall, gamma profile, top gamma strikes, concentration bands, pin risk, and market regime — in backend/app/quant/levels.py. Use when a level looks wrong, when tuning the wall scoring, or when adding a new derived level.
---

# GEX Analysis

## Purpose

Turn per-strike exposure into the handful of prices a trader actually watches, with scoring
rules that are inspectable rather than fitted.

## When to use

- A call/put wall is landing on an implausible strike
- The gamma flip is jumping around between refreshes
- Adding a new derived level or regime rule
- Tuning pin risk or concentration bands

## Inputs

- `backend/app/quant/levels.py` — wall scoring, pin risk, regime, concentration
- `backend/app/quant/gex_engine.py` — `gamma_profile`, `find_zero_gamma`
- `backend/app/services/analytics.py` — the pipeline that assembles levels
- A `list[StrikeGex]` and a spot price

## Workflow

1. **Everything here is model-derived.** Set `origin=DataOrigin.MODEL_DERIVED` and write a
   `note` explaining the method. The only exception is `largest_by` on an OI or volume field,
   which is observed.

2. **Always return a `Level`, never a bare float.** `make_level()` attaches distance and
   distance-percent. A price without its distance from spot is unusable on a trading screen.

3. **Wall scoring** — candidates must sit on the correct side of spot. The score is:
   ```
   (W_GEX × normalised gamma + W_OI × normalised OI)
     × (W_PROXIMITY + (1 - W_PROXIMITY) × gaussian proximity)
     × (1 + 0.35 × normalised 0DTE gamma)
   ```
   If you change a weight, update the constant at the top of the file, the `note` string, the
   README methodology section, and the tests together — they must not drift apart.

4. **Confidence is a first-class output.** It comes from the margin between the winner and the
   runner-up. A wall that barely beats its neighbour is not a wall.

5. **Gamma flip must be interpolated.** Use `find_zero_gamma`, which interpolates across the
   sign change nearest the middle of the range. Never snap to the nearest sampled price: on
   SPX the grid step is tens of index points. When several crossings exist, the one bracketing
   the centre wins.

6. **Regime rules stay explicit.** `classify_regime` is deliberately a readable if/else chain
   with a human-readable `explanation`. Do not replace it with a fitted model.

7. **Never present a heuristic as a fact.** Pin risk returns Low/Medium/High plus a score plus
   an explanation that says it is a heuristic. Keep that framing.

## Expected outputs

- `Level` objects with price, distance, distance_pct, origin, note, and confidence where relevant
- `RegimeAssessment` with a plain-English explanation naming its inputs
- `PinRisk` with level, score, and explanation

## Validation

```bash
cd backend && .venv/Scripts/python.exe -m pytest tests/test_levels.py -q
```

Invariants that must hold:
- call wall > spot, put wall < spot, always
- a far strike never outranks a near strike of comparable size
- the 0DTE boost decides ties but cannot override a large proximity gap
- empty or all-zero chains return an empty level with a note, never an exception
- concentration shares reach 100% at the widest band

## Failure handling

- Wall on an absurd strike → check the proximity decay (`decay_pct`) and whether normalisation
  is being applied to the correct side's gamma
- Flip flickering between refreshes → the profile band or step count is too coarse; raise
  `steps`, and confirm contracts without IV are being excluded
- Flip is `None` → the profile never crosses zero in the band; that is a valid answer, report
  it as unavailable rather than fabricating a level
