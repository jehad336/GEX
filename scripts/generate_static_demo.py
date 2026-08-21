"""Capture the demo backend's public dashboard responses for static hosting."""

import json
import os
from pathlib import Path

import httpx

BASE = os.getenv("DEMO_CAPTURE_BASE", "http://127.0.0.1:8001")
SYMBOL = "SPY"
PATHS = [
    "/api/market/status",
    "/api/providers",
    "/api/watchlist",
    "/api/symbols/search?q=SP",
    f"/api/gex/{SYMBOL}",
    f"/api/gex/{SYMBOL}/by-strike",
    f"/api/gex/{SYMBOL}/profile?band_pct=0.1&steps=121",
    f"/api/gex/{SYMBOL}/heatmap?metric=net&max_strikes=50",
    f"/api/market/{SYMBOL}",
    f"/api/market/{SYMBOL}/bars?interval=5m&limit=240",
    f"/api/gex/{SYMBOL}/0dte",
    f"/api/gex/{SYMBOL}/levels",
    f"/api/gex/{SYMBOL}/by-expiry",
    f"/api/options/{SYMBOL}/oi",
    f"/api/options/{SYMBOL}/volume",
    f"/api/options/{SYMBOL}/iv",
    f"/api/options/{SYMBOL}/flow",
    f"/api/history/{SYMBOL}/gex?hours=8",
]


def key(path: str) -> str:
    return path.split("?", 1)[0]


def main() -> None:
    output: dict[str, object] = {}
    with httpx.Client(base_url=BASE, timeout=60) as client:
        for path in PATHS:
            response = client.get(path)
            response.raise_for_status()
            output[key(path)] = response.json()
    destination = Path(__file__).parents[1] / "frontend" / "lib" / "demoFixtures.json"
    destination.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {destination} ({destination.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

