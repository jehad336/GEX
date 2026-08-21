---
name: realtime-market-streaming
description: Work on WebSocket streaming — the backend symbol hub, provider stream adapters, and the frontend reconnect hook. Use when adding a stream, debugging reconnects or stale pushes, or changing how live updates reach the UI.
---

# Real-Time Market Streaming

## Purpose

Push live updates to every connected browser without multiplying provider load, and degrade to
polling honestly when the stream is unavailable.

## When to use

- Adding a streaming channel (trades, quotes, aggregates)
- The dashboard shows STREAM DOWN or stops updating
- Reconnect storms, duplicated upstream subscriptions, or stale pushes after a symbol change

## Inputs

- `backend/app/api/routes/stream.py` — `SymbolHub`, the fan-out
- `backend/app/providers/massive.py` — `_ws_connect`, `stream_underlying`, `stream_options`
- `frontend/lib/hooks.ts` — `useSymbolStream`
- `frontend/components/TopNav.tsx` — the stream-state badge

## Workflow

1. **One producer per symbol.** `SymbolHub` runs a single upstream task regardless of how many
   browsers are watching. Subscriber count must never multiply provider requests. The task is
   started on first client and cancelled when the last disconnects.

2. **Broadcast defensively.** A send failure removes that client from the set; it must not
   abort the loop or affect other viewers.

3. **Message envelope** is `{ type, data }` with types `hello`, `underlying`, `gex`, `alerts`,
   `error`, `pong`. Add a new type rather than overloading an existing one.

4. **Errors reach the client.** On an upstream exception, broadcast `{type: 'error'}` and back
   off exponentially (capped at 30 s). Silence looks identical to a working-but-flat market,
   which is dangerous.

5. **Frontend reconnect:** exponential backoff capped at 30 s, reset on open. A deliberate
   close (unmount, symbol change) must not trigger a reconnect — that is what `closedByUs` is for.

6. **Tag pushes with their symbol.** `useSymbolStream` stores the symbol alongside the payload
   and returns `null` when it does not match the requested symbol. Without this, a symbol switch
   leaves the previous instrument's spot and levels on screen under the new name.

7. **Streaming supplements polling; it never replaces it.** SWR keeps panels current when the
   socket is down. The header shows `STREAM` / `POLLING` / `STREAM DOWN` so the degraded state
   is visible rather than implied.

8. **Do not claim LIVE without entitlement.** A stream that is actually delayed must still carry
   `DELAYED_15M`.

## Expected outputs

- One upstream connection per symbol
- Clean teardown with no leaked tasks
- A visible, accurate connection state in the UI

## Validation

```bash
cd backend && .venv/Scripts/python.exe -m pytest tests/test_api.py -k websocket -q
```

Manual: open two browser tabs on the same symbol and confirm the backend log shows one upstream
subscription. Kill the backend and confirm the badge flips to STREAM DOWN while panels keep
polling. Switch symbols rapidly and confirm no cross-symbol values appear.

## Failure handling

- Reconnect storm → `closedByUs` is not set on deliberate close, or backoff is not resetting
- Task leak → the hub's task is not cancelled when the client set empties
- Stale data after a symbol switch → the symbol tag check is missing
- Duplicate upstream subscriptions → a hub is being created per connection instead of per symbol
