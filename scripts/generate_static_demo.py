"""Capture the demo backend's dashboard responses for static hosting.

Every symbol the UI can select is captured separately. An earlier version stored
only SPY and rewrote the ``symbol`` field to whatever the user clicked, which
made NVDA render SPY's spot, walls and gamma flip under NVDA's name — the exact
class of error this project exists to avoid. Symbols the backend cannot serve are
reported and left out, so the UI shows them as unavailable rather than borrowing
another instrument's numbers.

Usage:
    python -m uvicorn app.main:app --port 8001     # from backend/, DEMO_MODE=true
    python scripts/generate_static_demo.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

BASE = os.getenv("DEMO_CAPTURE_BASE", "http://127.0.0.1:8001")

# Must stay in step with QUICK_SYMBOLS in frontend/app/page.tsx.
SYMBOLS = [
    "SPX", "SPY", "QQQ", "NDX", "IWM", "DIA",
    "NVDA", "TSLA", "AAPL", "AMD", "MSFT", "AMZN", "META",
]

# Captured once; these carry no symbol.
GLOBAL_PATHS = [
    "/api/market/status",
    "/api/providers",
    "/api/config",
    "/api/watchlist",
    "/api/symbols",
]

# Captured per symbol. Keep the query strings identical to what the UI requests,
# because the fixture is keyed on the path alone.
SYMBOL_PATHS = [
    "/api/gex/{s}",
    "/api/gex/{s}/by-strike",
    "/api/gex/{s}/profile?band_pct=0.1&steps=121",
    "/api/gex/{s}/heatmap?metric=net&max_strikes=50",
    "/api/gex/{s}/0dte",
    "/api/gex/{s}/levels",
    "/api/gex/{s}/by-expiry",
    "/api/market/{s}",
    "/api/market/{s}/bars?interval=5m&limit=240",
    "/api/options/{s}/oi",
    "/api/options/{s}/volume",
    "/api/options/{s}/iv",
    "/api/options/{s}/flow",
    "/api/history/{s}/gex?hours=8",
]


def key(path: str) -> str:
    """Fixtures are keyed on the path; the query string only shapes the capture."""
    return path.split("?", 1)[0]


def main() -> int:
    output: dict[str, object] = {}
    captured: list[str] = []
    skipped: list[tuple[str, str]] = []

    with httpx.Client(base_url=BASE, timeout=120) as client:
        for path in GLOBAL_PATHS:
            resp = client.get(path)
            resp.raise_for_status()
            output[key(path)] = resp.json()

        for symbol in SYMBOLS:
            rows: dict[str, object] = {}
            try:
                for template in SYMBOL_PATHS:
                    path = template.format(s=symbol)
                    resp = client.get(path)
                    resp.raise_for_status()
                    rows[key(path)] = resp.json()
            except httpx.HTTPError as exc:
                # Better to omit the symbol than to ship another symbol's numbers.
                skipped.append((symbol, str(exc)[:90]))
                continue
            output.update(rows)
            captured.append(symbol)

    output["__symbols__"] = captured

    dest = Path(__file__).parents[1] / "frontend" / "lib" / "demoFixtures.json"
    dest.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")

    print(f"captured {len(captured)} symbols: {', '.join(captured)}")
    for symbol, err in skipped:
        print(f"  skipped {symbol}: {err}", file=sys.stderr)
    print(f"wrote {dest} ({dest.stat().st_size:,} bytes, {len(output)} keys)")
    return 0 if captured else 1


if __name__ == "__main__":
    raise SystemExit(main())
