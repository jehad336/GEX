---
name: market-data-quality
description: Work on the data-quality gate that validates normalized option chains before the engine runs — duplicates, negative or missing values, stale timestamps, OI freshness, and provider inconsistencies. Use when bad vendor data reaches a calculation or when adding a validation rule.
---

# Market Data Quality

## Purpose

Catch bad vendor data before it becomes a confident wrong number on a trading screen.

## When to use

- A calculation produced an implausible result and the chain is suspect
- Adding a validation rule
- A provider is returning duplicates, crossed quotes, or stale timestamps

## Inputs

- `backend/app/quant/quality.py` — `validate_chain`, `QualityReport`, `resolve_freshness`
- `backend/app/services/analytics.py` — where the gate runs, before `ChainArrays`
- `frontend/components/ui.tsx` — `QualityIndicator`, which surfaces findings on hover

## Workflow

1. **Report, do not silently repair.** The default is to record an issue and keep the contract.
   Only clamp values that would make the maths meaningless (negative OI or volume → 0, missing
   multiplier → 100, implausible IV → `None`), and flag every clamp.

2. **Drop only what is unusable:** duplicate `(underlying, expiry, strike, type)` rows,
   mismatched underlying, non-positive strike, already-expired contracts. Everything else is
   kept and flagged.

3. **Severity drives the UI.** `error` turns `report.ok` false and renders red; `warning` renders
   amber; `info` is informational only. An empty chain, an all-rejected chain, and a mismatched
   underlying are errors — they mean the request produced nothing trustworthy.

4. **Adding a rule:** add the check in the loop, then add matching entries to both the
   `severities` and `descriptions` dicts. A code missing from either will raise a `KeyError` —
   that coupling is deliberate.

5. **Freshness resolves to the worst case.** `resolve_freshness` returns the least fresh status
   across the chain. Never upgrade to `LIVE` because most contracts happen to be live.

6. **Open interest gets special treatment.** It is published once per session. Preserve
   `oi_timestamp`, surface it, and never describe OI as real-time.

## Expected outputs

- `(clean_contracts, QualityReport)` from `validate_chain`
- A report carrying `ok`, `checked`, `dropped`, and a list of coded issues
- The report attached to API responses so the UI can display it

## Validation

```bash
cd backend && .venv/Scripts/python.exe -m pytest tests/test_volatility_and_quality.py -q
```

Each new rule needs a test proving it fires, and a test proving a clean chain does not trip it.

## Failure handling

- `KeyError` on a code → the `severities` or `descriptions` entry is missing
- A whole chain rejected → check the underlying-symbol comparison first; index symbols often
  arrive with a prefix (`^SPX`, `SPXW`) that must be normalized in the adapter, not here
- Everything flagged stale → the vendor is sending timestamps in a different epoch unit; fix
  the parser in the adapter
