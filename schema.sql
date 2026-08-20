-- SPBC catalog DDL only.
-- SAFE: CREATE TABLE IF NOT EXISTS. No DELETE, no INSERT, no price overwrite.
-- This file is NOT a Wrangler migration (wrangler.toml has no [[migrations]]).
-- NEVER apply a seed/reprice file to production D1. Live catalog is admin-maintained.
-- Optional empty-local seed (refuses if products already has rows): schema.local-seed.sql

CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  notes      TEXT,
  telegram_chat_id TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  vial_price  REAL,
  pack_price  REAL NOT NULL,
  kit_only    INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  -- Admin-only: FK to suppliers (Telegram groups by this)
  supplier_id INTEGER,
  -- Admin-only free-text notes (SKU etc.) — never on public /api/products
  source      TEXT,
  updated_at  TEXT NOT NULL
);
