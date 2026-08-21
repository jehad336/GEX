"""WebSocket push.

One upstream task per symbol regardless of how many browsers are watching, so
subscriber count never multiplies provider load. Clients get underlying ticks at
provider cadence and a recomputed GEX snapshot on the chain refresh interval.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.providers.registry import get_provider
from app.services import analytics
from app.services.alerts import get_alert_engine
from app.services.analytics import ChainRequest

log = logging.getLogger("gex.stream")

router = APIRouter()


class SymbolHub:
    """Fan-out for one symbol: one producer, many websocket consumers."""

    def __init__(self, symbol: str):
        self.symbol = symbol.upper()
        self.clients: set[WebSocket] = set()
        self.task: asyncio.Task | None = None
        self.last_snapshot: dict | None = None

    async def broadcast(self, message: dict) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def run(self) -> None:
        settings = get_settings()
        provider = get_provider()
        req = ChainRequest(symbol=self.symbol)
        ticks_per_snapshot = max(
            1, int(settings.cache_ttl_chain / max(settings.cache_ttl_underlying, 1))
        )
        counter = 0
        backoff = 1.0

        while self.clients:
            try:
                underlying = await provider.get_underlying(self.symbol)
                await self.broadcast(
                    {"type": "underlying", "data": underlying.model_dump(mode="json")}
                )
                backoff = 1.0

                if counter % ticks_per_snapshot == 0:
                    snapshot, ctx = await analytics.build_snapshot(req)
                    # Identical shape to GET /api/gex/{symbol}, so a pushed frame
                    # and a polled response are interchangeable in the UI.
                    self.last_snapshot = analytics.snapshot_envelope(snapshot, ctx)
                    await self.broadcast({"type": "gex", "data": self.last_snapshot})

                    events = get_alert_engine().evaluate(snapshot)
                    if events:
                        await self.broadcast(
                            {"type": "alerts", "data": [e.to_dict() for e in events]}
                        )

                counter += 1
                await asyncio.sleep(max(settings.cache_ttl_underlying, 1))

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("stream error for %s: %s", self.symbol, exc)
                await self.broadcast(
                    {"type": "error", "data": {"message": str(exc), "symbol": self.symbol}}
                )
                await asyncio.sleep(min(backoff, 30.0))
                backoff *= 2

        self.task = None


_hubs: dict[str, SymbolHub] = {}


def get_hub(symbol: str) -> SymbolHub:
    key = symbol.upper()
    if key not in _hubs:
        _hubs[key] = SymbolHub(key)
    return _hubs[key]


@router.websocket("/ws/{symbol}")
async def stream_symbol(websocket: WebSocket, symbol: str) -> None:
    await websocket.accept()
    hub = get_hub(symbol)
    hub.clients.add(websocket)

    banner = analytics.demo_banner()
    await websocket.send_json(
        {"type": "hello", "data": {"symbol": hub.symbol, "demo_banner": banner}}
    )
    if hub.last_snapshot:
        await websocket.send_json({"type": "gex", "data": hub.last_snapshot})

    if hub.task is None or hub.task.done():
        hub.task = asyncio.create_task(hub.run())

    try:
        while True:
            # Client messages are only used as a liveness ping today.
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.info("websocket closed for %s: %s", hub.symbol, exc)
    finally:
        hub.clients.discard(websocket)
        if not hub.clients and hub.task:
            hub.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await hub.task
            hub.task = None


async def shutdown_hubs() -> None:
    for hub in _hubs.values():
        if hub.task:
            hub.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await hub.task
    _hubs.clear()
