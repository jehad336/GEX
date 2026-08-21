"""Capture the demo backend's public dashboard responses for static hosting."""

import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

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
    f"/api/opportunities/{SYMBOL}",
]

EXPOSURE_MODES = ("0dte", "1dte", "le7", "le30", "monthly", "all")
EXPOSURE_RANGES = ("1", "2", "3", "5", "10", "0")


def key(path: str) -> str:
    parsed = urlsplit(path)
    if parsed.path.startswith("/api/exposure/"):
        query = parse_qs(parsed.query)
        canonical = {
            "expirationMode": query.get("expirationMode", ["all"])[0],
            "strikeRange": query.get("strikeRange", ["3"])[0],
        }
        if query.get("expiration"):
            canonical["expiration"] = query["expiration"][0]
        return f"{parsed.path}?{urlencode(canonical)}"
    return path.split("?", 1)[0]


def main() -> None:
    destination = Path(__file__).parents[1] / "frontend" / "lib" / "demoFixtures.json"
    exposure_only = os.getenv("DEMO_CAPTURE_ONLY_EXPOSURE", "").lower() == "true"
    output: dict[str, object] = (
        json.loads(destination.read_text(encoding="utf-8"))
        if exposure_only and destination.exists()
        else {}
    )
    with httpx.Client(base_url=BASE, timeout=60) as client:
        for path in ([] if exposure_only else PATHS):
            response = client.get(path)
            response.raise_for_status()
            output[key(path)] = response.json()

        exposure_paths = {
            f"/api/exposure/{SYMBOL}/ladder?expirationMode={mode}&strikeRange=3"
            for mode in EXPOSURE_MODES
        }
        exposure_paths.update(
            f"/api/exposure/{SYMBOL}/ladder?expirationMode=all&strikeRange={strike_range}"
            for strike_range in EXPOSURE_RANGES
        )
        for path in sorted(exposure_paths):
            response = client.get(path)
            response.raise_for_status()
            output[key(path)] = response.json()

        opportunity_path = f"/api/opportunities/{SYMBOL}"
        opportunity_response = client.get(opportunity_path)
        opportunity_response.raise_for_status()
        output[key(opportunity_path)] = opportunity_response.json()

        all_exposure = output[key(f"/api/exposure/{SYMBOL}/ladder?expirationMode=all&strikeRange=3")]
        for choice in all_exposure["expiration_selection"]["available"]:
            expiration = choice["expiration"]
            path = (
                f"/api/exposure/{SYMBOL}/ladder?expirationMode=single"
                f"&strikeRange=3&expiration={expiration}"
            )
            response = client.get(path)
            response.raise_for_status()
            output[key(path)] = response.json()

    destination.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {destination} ({destination.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
