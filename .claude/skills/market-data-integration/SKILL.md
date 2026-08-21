---
name: market-data-integration
description: Add or modify a market data provider adapter (Massive, Tradier, ORATS, or a new vendor) in the GEX dashboard — REST/WebSocket wiring, response normalization, rate limits, retries, and honest delay-status tagging. Use when integrating a vendor API, debugging a provider response, or adding a field to the normalized schema.
---

# Market Data Integration

## Purpose

Keep every vendor difference inside `backend/app/providers/`. The rest of the application
speaks only the normalized schema in `backend/app/models.py`.

## When to use

- Adding a new data provider
- A vendor changed a field name or response shape
- A provider is returning 401/429/5xx and the dashboard shows the wrong thing
- Adding a field that must flow from a vendor through to the UI

## Inputs

- Vendor API documentation, including the plan tier's **entitlements** (real-time vs delayed)
- An existing adapter to mirror: `massive.py` (rich, WebSocket) or `tradier.py` (simpler, REST)
- `backend/app/models.py` — the target types

## Workflow

1. **Read the schema first.** `OptionContract`, `Underlying`, `Bar`, `OptionTrade`,
   `ProviderStatus`, `Freshness`. If the vendor exposes something with no home there, add the
   field to the model before touching the adapter — never leak a vendor-shaped dict outward.

2. **Subclass `MarketDataProvider`** (`providers/base.py`). Required:
   `get_underlying`, `get_expirations`, `get_option_chain`. Optional:
   `get_option_trades`, `get_historical_bars`, `search_symbols`, `stream_underlying`,
   `stream_options`, `provider_status`. Unimplemented methods must raise `NotImplementedError`
   so routes can report "this provider does not expose X" instead of failing opaquely.

3. **Parse defensively.** Use the `_pick(d, *names)` pattern: vendors rename fields between
   plan tiers, and a missing key must degrade one field, not the whole chain. A contract that
   cannot be parsed returns `None` and is skipped, never a half-populated record.

4. **Use `self.request_json`** rather than calling httpx directly. It provides retry with
   exponential backoff, `Retry-After` handling, 401/403 classification, and the circuit
   breaker. Never bypass it.

5. **Set `delay_status` honestly.** This is the rule that matters most:
   - `LIVE` only when the vendor's own entitlement flag confirms real time
   - `DELAYED_15M` for standard market-data plans
   - `DEMO` for synthetic data
   - `UNKNOWN` when the vendor says nothing — never guess upward
   Also set `oi_timestamp` when available; OI is a once-per-session figure.

6. **Register in `providers/registry.py`** and add the key to `Settings` plus `.env.example`.

7. **Verify** with a real call and a forced-failure call:
   ```bash
   cd backend && .venv/Scripts/python.exe -c "
   import asyncio
   from app.providers.registry import get_provider
   p = get_provider('yourprovider')
   c = asyncio.run(p.get_option_chain('SPY'))
   print(len(c.contracts), c.freshness.status, c.contracts[0])"
   ```

## Expected outputs

- An adapter returning only normalized models
- Correct `delay_status` on every record
- `provider_status()` distinguishing "no key configured" from "authenticated but down"
- Registry entry, settings field, and `.env.example` line

## Validation

- `pytest tests/` still passes
- `ruff check .` and `mypy app` clean
- `GET /api/providers` shows the new provider with accurate availability
- Chain fetch produces contracts whose `underlying` matches the request (the quality gate
  rejects mismatches)

## Failure handling

- Missing key → `ProviderError` with a message naming the env var; do not fall back to demo
  silently in a live request path
- 429 → `RateLimitError`, surfaced as HTTP 429; the UI backs off rather than hammering
- 5xx / timeout → retried with backoff, then `ProviderError` → HTTP 502
- **Never** substitute demo or stale data for a failed live call. An honest error beats a
  plausible wrong number.
