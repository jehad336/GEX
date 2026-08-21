"""Intraday GEX snapshot history and prior-day OI storage.

Backed by SQLite by default so the MVP runs with no infrastructure; the same
table shapes are mirrored in db/schema.sql for PostgreSQL deployments.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

log = logging.getLogger("gex.history")

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "gex_history.db"

_lock = threading.Lock()
_initialised = False

SCHEMA = """
CREATE TABLE IF NOT EXISTS gex_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT NOT NULL,
    captured_at   TEXT NOT NULL,
    spot          REAL NOT NULL,
    net_gex       REAL NOT NULL,
    call_gex      REAL NOT NULL,
    put_gex       REAL NOT NULL,
    dte0_net_gex  REAL NOT NULL DEFAULT 0,
    net_dex       REAL NOT NULL DEFAULT 0,
    gamma_flip    REAL,
    call_wall     REAL,
    put_wall      REAL,
    regime        TEXT,
    atm_iv        REAL,
    provider      TEXT,
    payload       TEXT
);
CREATE INDEX IF NOT EXISTS idx_gex_symbol_time ON gex_snapshots(symbol, captured_at);

CREATE TABLE IF NOT EXISTS historical_oi (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT NOT NULL,
    session_date  TEXT NOT NULL,
    expiration    TEXT NOT NULL,
    strike        REAL NOT NULL,
    option_type   TEXT NOT NULL,
    open_interest INTEGER NOT NULL,
    volume        INTEGER NOT NULL DEFAULT 0,
    captured_at   TEXT NOT NULL,
    UNIQUE(symbol, session_date, expiration, strike, option_type)
);
CREATE INDEX IF NOT EXISTS idx_oi_symbol_date ON historical_oi(symbol, session_date);

CREATE TABLE IF NOT EXISTS provider_status_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    provider    TEXT NOT NULL,
    available   INTEGER NOT NULL,
    latency_ms  REAL,
    message     TEXT,
    checked_at  TEXT NOT NULL
);
"""


@contextmanager
def connection():
    global _initialised
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        with _lock:
            if not _initialised:
                conn.executescript(SCHEMA)
                conn.commit()
                _initialised = True
        yield conn
    finally:
        conn.close()


def _f(v) -> float | None:
    return float(v) if v is not None else None


def record_snapshot(snapshot) -> None:
    """Persist one intraday GEX observation. Failures are logged, never raised -
    losing a history row must not fail the dashboard request that produced it."""
    try:
        levels = snapshot.levels or {}
        with connection() as conn:
            conn.execute(
                """INSERT INTO gex_snapshots
                   (symbol, captured_at, spot, net_gex, call_gex, put_gex, dte0_net_gex,
                    net_dex, gamma_flip, call_wall, put_wall, regime, atm_iv, provider, payload)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    snapshot.symbol,
                    snapshot.computed_at.isoformat(),
                    snapshot.spot,
                    snapshot.totals.net_gex,
                    snapshot.totals.call_gex,
                    snapshot.totals.put_gex,
                    snapshot.dte0.net_gex,
                    snapshot.totals.net_dex,
                    _f(getattr(levels.get("gamma_flip"), "price", None)),
                    _f(getattr(levels.get("call_wall"), "price", None)),
                    _f(getattr(levels.get("put_wall"), "price", None)),
                    snapshot.regime.regime,
                    snapshot.atm_iv,
                    snapshot.provider,
                    json.dumps({"ratios": snapshot.ratios.model_dump()}),
                ),
            )
            conn.commit()
    except Exception as exc:
        log.warning("failed to record gex snapshot for %s: %s", snapshot.symbol, exc)


def get_history(symbol: str, hours: float = 8.0, limit: int = 500) -> list[dict]:
    since = (datetime.now(UTC) - timedelta(hours=hours)).isoformat()
    try:
        with connection() as conn:
            rows = conn.execute(
                """SELECT captured_at, spot, net_gex, call_gex, put_gex, dte0_net_gex,
                          net_dex, gamma_flip, call_wall, put_wall, regime, atm_iv
                   FROM gex_snapshots
                   WHERE symbol = ? AND captured_at >= ?
                   ORDER BY captured_at ASC LIMIT ?""",
                (symbol.upper(), since, limit),
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:
        log.warning("failed to read gex history for %s: %s", symbol, exc)
        return []


def record_oi(symbol: str, contracts: list, session: date | None = None) -> int:
    """Store today's OI per contract so tomorrow can compute the change."""
    session = session or date.today()
    now = datetime.now(UTC).isoformat()
    try:
        with connection() as conn:
            conn.executemany(
                """INSERT OR REPLACE INTO historical_oi
                   (symbol, session_date, expiration, strike, option_type,
                    open_interest, volume, captured_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                [
                    (
                        symbol.upper(), session.isoformat(), c.expiration.isoformat(),
                        c.strike, c.type.value, c.open_interest, c.volume, now,
                    )
                    for c in contracts
                ],
            )
            conn.commit()
        return len(contracts)
    except Exception as exc:
        log.warning("failed to record OI for %s: %s", symbol, exc)
        return 0


def oi_change(symbol: str, contracts: list) -> dict:
    """Compare current OI against the most recent stored earlier session.

    Reports magnitude only. An OI delta cannot tell you whether the change came
    from opening or closing trades, so no direction is inferred.
    """
    try:
        with connection() as conn:
            prev_row = conn.execute(
                """SELECT session_date FROM historical_oi
                   WHERE symbol = ? AND session_date < ?
                   ORDER BY session_date DESC LIMIT 1""",
                (symbol.upper(), date.today().isoformat()),
            ).fetchone()
            if prev_row is None:
                return {
                    "available": False,
                    "reason": "No prior session stored yet. Run the app across two sessions.",
                }
            prev_session = prev_row["session_date"]
            rows = conn.execute(
                """SELECT expiration, strike, option_type, open_interest
                   FROM historical_oi WHERE symbol = ? AND session_date = ?""",
                (symbol.upper(), prev_session),
            ).fetchall()
    except Exception as exc:
        log.warning("failed to compute OI change for %s: %s", symbol, exc)
        return {"available": False, "reason": str(exc)}

    prev = {(r["expiration"], r["strike"], r["option_type"]): r["open_interest"] for r in rows}
    by_strike: dict[float, dict] = {}
    call_delta = put_delta = additions = reductions = 0

    for c in contracts:
        key = (c.expiration.isoformat(), c.strike, c.type.value)
        before = prev.get(key)
        if before is None:
            continue
        delta = c.open_interest - before
        if delta > 0:
            additions += delta
        else:
            reductions += -delta
        if c.is_call:
            call_delta += delta
        else:
            put_delta += delta
        row = by_strike.setdefault(
            c.strike, {"strike": c.strike, "call_oi_change": 0, "put_oi_change": 0}
        )
        row["call_oi_change" if c.is_call else "put_oi_change"] += delta

    return {
        "available": True,
        "previous_session": prev_session,
        "call_oi_change": call_delta,
        "put_oi_change": put_delta,
        "net_oi_change": call_delta + put_delta,
        "additions": additions,
        "reductions": reductions,
        "by_strike": sorted(by_strike.values(), key=lambda r: r["strike"]),
        "note": (
            "Open interest deltas show net contract creation or destruction only. "
            "They do not identify opening versus closing trades or trade direction."
        ),
    }
