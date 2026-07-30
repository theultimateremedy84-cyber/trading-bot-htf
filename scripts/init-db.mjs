import pg from "pg";
const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

// Cloud Postgres (Railway, Heroku, Supabase, etc.) requires SSL on public URLs.
const ssl =
  url.includes("localhost") || url.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false };

const pool = new Pool({ connectionString: url, ...(ssl ? { ssl } : {}) });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      id                   SERIAL  PRIMARY KEY,
      risk_per_trade       REAL    NOT NULL DEFAULT 1.0,
      max_open_trades      INTEGER NOT NULL DEFAULT 3,
      daily_loss_limit     REAL    NOT NULL DEFAULT 3.0,
      enabled_markets      TEXT    NOT NULL DEFAULT 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT',
      enabled_kill_zones   TEXT    NOT NULL DEFAULT 'LONDON,NEW_YORK,ASIAN',
      min_confidence       REAL    NOT NULL DEFAULT 55.0,
      use_order_blocks     BOOLEAN NOT NULL DEFAULT TRUE,
      use_fair_value_gaps  BOOLEAN NOT NULL DEFAULT TRUE,
      use_liquidity_sweeps BOOLEAN NOT NULL DEFAULT TRUE,
      use_bos              BOOLEAN NOT NULL DEFAULT TRUE,
      use_cho_ch           BOOLEAN NOT NULL DEFAULT TRUE,
      trailing_stop        BOOLEAN NOT NULL DEFAULT FALSE,
      min_rr               REAL    NOT NULL DEFAULT 2.0,
      bybit_api_key        TEXT    NOT NULL DEFAULT '',
      bybit_api_secret     TEXT    NOT NULL DEFAULT '',
      bybit_testnet        BOOLEAN NOT NULL DEFAULT TRUE,
      bybit_demo           BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Upgrade older deployments missing the bybit_demo column
  await pool.query(`
    ALTER TABLE bot_settings
      ADD COLUMN IF NOT EXISTS bybit_demo BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  console.log("  ✓ bot_settings");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS signals (
      id                SERIAL    PRIMARY KEY,
      epic              TEXT      NOT NULL,
      market            TEXT      NOT NULL,
      direction         TEXT      NOT NULL,
      signal_type       TEXT      NOT NULL,
      timeframe         TEXT      NOT NULL,
      entry_price       REAL      NOT NULL,
      stop_loss         REAL      NOT NULL,
      take_profit       REAL      NOT NULL,
      confidence        REAL      NOT NULL,
      detected_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      executed          BOOLEAN   NOT NULL DEFAULT FALSE,
      kill_zone         TEXT,
      notes             TEXT,
      htf_bias          TEXT,
      structure_context TEXT
    );
  `);
  console.log("  ✓ signals");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id                SERIAL    PRIMARY KEY,
      deal_id           TEXT,
      epic              TEXT      NOT NULL,
      market            TEXT      NOT NULL,
      direction         TEXT      NOT NULL,
      size              REAL      NOT NULL,
      entry_price       REAL      NOT NULL,
      exit_price        REAL,
      profit            REAL,
      entry_date        TIMESTAMP NOT NULL DEFAULT NOW(),
      exit_date         TIMESTAMP,
      stop_loss         REAL      NOT NULL,
      take_profit       REAL      NOT NULL,
      strategy          TEXT      NOT NULL DEFAULT 'ICT',
      result            TEXT,
      risk_reward_ratio REAL,
      signal_id         INTEGER,
      notes             TEXT
    );
  `);
  console.log("  ✓ trades");

  console.log("Database schema initialised successfully.");
} catch (err) {
  console.error("ERROR initialising schema:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
