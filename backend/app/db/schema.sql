-- GEX Trading Dashboard - PostgreSQL schema
-- The MVP runs on the SQLite mirror in app/services/history.py. Apply this when
-- you point DATABASE_URL at Postgres (including Supabase).
--
--   psql "$DATABASE_URL" -f backend/app/db/schema.sql

CREATE TABLE IF NOT EXISTS symbols (
    symbol        TEXT PRIMARY KEY,
    name          TEXT,
    asset_type    TEXT,                       -- equity | index | etf
    multiplier    INTEGER NOT NULL DEFAULT 100,
    is_watchlist  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS underlying_snapshots (
    id             BIGSERIAL PRIMARY KEY,
    symbol         TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    price          NUMERIC(18,6) NOT NULL,
    previous_close NUMERIC(18,6),
    open           NUMERIC(18,6),
    high           NUMERIC(18,6),
    low            NUMERIC(18,6),
    volume         BIGINT,
    vwap           NUMERIC(18,6),
    provider       TEXT NOT NULL,
    delay_status   TEXT NOT NULL,
    quote_ts       TIMESTAMPTZ,
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_underlying_symbol_time
    ON underlying_snapshots(symbol, captured_at DESC);

-- One row per fetch of a whole chain; contract rows hang off it.
CREATE TABLE IF NOT EXISTS option_chain_snapshots (
    id             BIGSERIAL PRIMARY KEY,
    symbol         TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    spot           NUMERIC(18,6) NOT NULL,
    provider       TEXT NOT NULL,
    delay_status   TEXT NOT NULL,
    contract_count INTEGER NOT NULL,
    quality        JSONB,
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chain_symbol_time
    ON option_chain_snapshots(symbol, captured_at DESC);

CREATE TABLE IF NOT EXISTS option_contract_snapshots (
    id             BIGSERIAL PRIMARY KEY,
    chain_id       BIGINT NOT NULL REFERENCES option_chain_snapshots(id) ON DELETE CASCADE,
    contract_symbol TEXT NOT NULL,
    underlying     TEXT NOT NULL,
    expiration     DATE NOT NULL,
    dte            NUMERIC(10,4) NOT NULL,
    strike         NUMERIC(18,6) NOT NULL,
    option_type    TEXT NOT NULL CHECK (option_type IN ('call','put')),
    multiplier     INTEGER NOT NULL DEFAULT 100,
    bid            NUMERIC(18,6),
    ask            NUMERIC(18,6),
    mid            NUMERIC(18,6),
    last           NUMERIC(18,6),
    volume         BIGINT NOT NULL DEFAULT 0,
    open_interest  BIGINT NOT NULL DEFAULT 0,
    iv             NUMERIC(12,8),
    delta          NUMERIC(12,8),
    gamma          NUMERIC(18,12),
    theta          NUMERIC(12,8),
    vega           NUMERIC(12,8),
    quote_ts       TIMESTAMPTZ,
    oi_ts          TIMESTAMPTZ,
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_chain ON option_contract_snapshots(chain_id);
CREATE INDEX IF NOT EXISTS idx_contract_lookup
    ON option_contract_snapshots(underlying, expiration, strike, option_type);

-- Header-level GEX observation, one row per intraday capture.
CREATE TABLE IF NOT EXISTS gex_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    symbol        TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    spot          NUMERIC(18,6) NOT NULL,
    net_gex       DOUBLE PRECISION NOT NULL,
    call_gex      DOUBLE PRECISION NOT NULL,
    put_gex       DOUBLE PRECISION NOT NULL,
    dte0_net_gex  DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_dex       DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_vanna     DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_charm     DOUBLE PRECISION NOT NULL DEFAULT 0,
    gamma_flip    NUMERIC(18,6),
    call_wall     NUMERIC(18,6),
    put_wall      NUMERIC(18,6),
    regime        TEXT,
    atm_iv        NUMERIC(12,8),
    sign_convention TEXT NOT NULL,
    provider      TEXT NOT NULL,
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gex_symbol_time ON gex_snapshots(symbol, captured_at DESC);

-- Per-strike detail for a given gex_snapshot.
CREATE TABLE IF NOT EXISTS gex_levels (
    id            BIGSERIAL PRIMARY KEY,
    snapshot_id   BIGINT NOT NULL REFERENCES gex_snapshots(id) ON DELETE CASCADE,
    strike        NUMERIC(18,6) NOT NULL,
    call_gex      DOUBLE PRECISION NOT NULL DEFAULT 0,
    put_gex       DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_gex       DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_dex       DOUBLE PRECISION NOT NULL DEFAULT 0,
    call_oi       BIGINT NOT NULL DEFAULT 0,
    put_oi        BIGINT NOT NULL DEFAULT 0,
    call_volume   BIGINT NOT NULL DEFAULT 0,
    put_volume    BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gex_levels_snapshot ON gex_levels(snapshot_id);

CREATE TABLE IF NOT EXISTS historical_oi (
    id            BIGSERIAL PRIMARY KEY,
    symbol        TEXT NOT NULL,
    session_date  DATE NOT NULL,
    expiration    DATE NOT NULL,
    strike        NUMERIC(18,6) NOT NULL,
    option_type   TEXT NOT NULL CHECK (option_type IN ('call','put')),
    open_interest BIGINT NOT NULL,
    volume        BIGINT NOT NULL DEFAULT 0,
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (symbol, session_date, expiration, strike, option_type)
);
CREATE INDEX IF NOT EXISTS idx_oi_symbol_session ON historical_oi(symbol, session_date DESC);

CREATE TABLE IF NOT EXISTS flow_trades (
    id             BIGSERIAL PRIMARY KEY,
    symbol         TEXT NOT NULL,
    contract_symbol TEXT NOT NULL,
    option_type    TEXT NOT NULL CHECK (option_type IN ('call','put')),
    strike         NUMERIC(18,6) NOT NULL,
    expiration     DATE NOT NULL,
    dte            NUMERIC(10,4) NOT NULL,
    price          NUMERIC(18,6) NOT NULL,
    size           BIGINT NOT NULL,
    premium        NUMERIC(20,4) NOT NULL,
    bid            NUMERIC(18,6),
    ask            NUMERIC(18,6),
    -- print location versus quote; NOT a directional signal
    aggressor      TEXT NOT NULL DEFAULT 'unknown',
    underlying_price NUMERIC(18,6),
    traded_at      TIMESTAMPTZ NOT NULL,
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_symbol_time ON flow_trades(symbol, traded_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_premium ON flow_trades(premium DESC);

CREATE TABLE IF NOT EXISTS alerts (
    id            BIGSERIAL PRIMARY KEY,
    symbol        TEXT NOT NULL,
    -- approach_flip | cross_flip | approach_call_wall | approach_put_wall
    -- | gex_sign_change | dte0_gex_spike | large_trade | high_volume_oi
    rule_type     TEXT NOT NULL,
    threshold_pct NUMERIC(8,4),
    threshold_abs NUMERIC(20,4),
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    last_fired_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
    id          BIGSERIAL PRIMARY KEY,
    alert_id    BIGINT REFERENCES alerts(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL,
    rule_type   TEXT NOT NULL,
    message     TEXT NOT NULL,
    spot        NUMERIC(18,6),
    level_price NUMERIC(18,6),
    fired_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_alert_events_time ON alert_events(fired_at DESC);

CREATE TABLE IF NOT EXISTS provider_status (
    id           BIGSERIAL PRIMARY KEY,
    provider     TEXT NOT NULL,
    available    BOOLEAN NOT NULL,
    authenticated BOOLEAN NOT NULL,
    realtime_entitled BOOLEAN NOT NULL DEFAULT FALSE,
    latency_ms   NUMERIC(12,3),
    message      TEXT,
    checked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_status_time ON provider_status(provider, checked_at DESC);
