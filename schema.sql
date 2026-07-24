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
  -- mg of peptide per vial + mapping to a Peptide Stack Lab compound slug
  -- (for cycle-supply / cart-quantity math). Optional; null for kits/blends.
  vial_mg     REAL,
  lab_slug    TEXT,
  updated_at  TEXT NOT NULL
);

DELETE FROM products;

INSERT INTO products (name, vial_price, pack_price, kit_only, sort_order, active, updated_at) VALUES
  ('RETA 35 MG', 42.50, 325, 0, 10, 1, datetime('now')),
  ('RETA 66 MG', 76.00, 470, 0, 20, 1, datetime('now')),
  ('GHK-CU 34MG', 27.00, 170, 0, 30, 1, datetime('now')),
  ('KPV 10 MG', 30.00, 200, 0, 40, 1, datetime('now')),
  ('5-AMINO-1MQ 44MG', 32.50, 225, 0, 50, 1, datetime('now')),
  ('NAD 1000MG', 33.00, 230, 0, 60, 1, datetime('now')),
  ('TIRZ 30MG', 33.50, 235, 0, 70, 1, datetime('now')),
  ('MOTS-C 40MG', 43.00, 330, 0, 80, 1, datetime('now')),
  ('KLOW 80MG', 43.00, 330, 0, 90, 1, datetime('now')),
  ('CJC/IPA NO DAC 10MG', 34.00, 240, 0, 100, 1, datetime('now')),
  ('BAC WATER 3ML KIT', NULL, 40, 1, 110, 1, datetime('now'));

-- mg-per-vial + lab compound mapping (safe to re-run; UPDATE-only, no data loss).
UPDATE products SET vial_mg = 35,   lab_slug = 'retatrutide' WHERE name = 'RETA 35 MG';
UPDATE products SET vial_mg = 66,   lab_slug = 'retatrutide' WHERE name = 'RETA 66 MG';
UPDATE products SET vial_mg = 34,   lab_slug = 'ghk-cu'      WHERE name = 'GHK-CU 34MG';
UPDATE products SET vial_mg = 10,   lab_slug = 'kpv'         WHERE name = 'KPV 10 MG';
UPDATE products SET vial_mg = 44,   lab_slug = '5-amino-1mq' WHERE name = '5-AMINO-1MQ 44MG';
UPDATE products SET vial_mg = 1000                           WHERE name = 'NAD 1000MG';
UPDATE products SET vial_mg = 30,   lab_slug = 'tirzepatide' WHERE name = 'TIRZ 30MG';
UPDATE products SET vial_mg = 40,   lab_slug = 'mots-c'      WHERE name = 'MOTS-C 40MG';
UPDATE products SET vial_mg = 80                             WHERE name = 'KLOW 80MG';
UPDATE products SET vial_mg = 10                             WHERE name = 'CJC/IPA NO DAC 10MG';
