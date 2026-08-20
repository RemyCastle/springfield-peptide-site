-- LOCAL EMPTY-DB SEED ONLY.
-- Not a Wrangler migration. wrangler.toml has no [[migrations]].
-- Refuses to run if `products` already has rows (production D1 always does).
-- Do NOT pass this file to: wrangler d1 execute --remote
-- Do NOT concatenate this file with schema.sql for a "prod migrate".

SELECT CASE
  WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'products') = 0
    THEN RAISE(ABORT, 'products table missing — apply schema.sql DDL on an empty LOCAL db only')
  WHEN (SELECT COUNT(*) FROM products) > 0
    THEN RAISE(ABORT, 'Refusing to seed: products already has rows. Never apply this file to production D1.')
END;

-- Snapshot of an old public catalog (2026-07-30). Names/prices will drift from live.
-- Local preview only. Do not treat as production truth.
INSERT INTO products (name, vial_price, pack_price, kit_only, sort_order, active, updated_at) VALUES
  ('SEMA 10MG', 60, 480, 0, 1, 1, datetime('now')),
  ('CAGRI  5MG', 49, 366, 0, 2, 1, datetime('now')),
  ('RETA 10MG', 52, 416, 0, 9, 1, datetime('now')),
  ('RETA 35 MG', 168, 1344, 0, 10, 1, datetime('now')),
  ('RETA 66 MG', 290, 2320, 0, 20, 1, datetime('now')),
  ('GHK-CU 34MG', 32, 204, 0, 30, 1, datetime('now')),
  ('KPV 10 MG', 36, 240, 0, 40, 1, datetime('now')),
  ('NAD+ 500MG', 48, 384, 0, 59, 1, datetime('now')),
  ('NAD 1000MG', 68, 544, 0, 60, 1, datetime('now')),
  ('5-AMINO-1MQ 50MG', 46, 342, 0, 61, 1, datetime('now')),
  ('TIRZ 30MG', 72, 576, 0, 70, 1, datetime('now')),
  ('MOTS-C 10MG', 44, 352, 0, 78, 1, datetime('now')),
  ('MOTS-C 40MG', 104, 832, 0, 79, 1, datetime('now')),
  ('SS-31 10MG', 52, 416, 0, 80, 1, datetime('now')),
  ('BPC-157 10MG', 41, 294, 0, 88, 1, datetime('now')),
  ('TB-500 10MG', 47, 354, 0, 89, 1, datetime('now')),
  ('KLOW 80MG', 72, 576, 0, 90, 1, datetime('now')),
  ('CJC/IPA NO DAC 10MG', 45, 360, 0, 100, 1, datetime('now')),
  ('IPA 10MG', 39, 270, 0, 107, 1, datetime('now')),
  ('PT-141 10 MG', 41, 294, 0, 107, 1, datetime('now')),
  ('MT1', 44, 352, 0, 108, 1, datetime('now')),
  ('MT2', 44, 352, 0, 109, 1, datetime('now')),
  ('BAC WATER 3ML', 5, 50, 0, 110, 1, datetime('now')),
  ('BAC WATER 10 ML', 30, 96, 0, 111, 1, datetime('now')),
  ('GLUTATHIONE 1200MG', 43, 306, 0, 112, 1, datetime('now')),
  ('DSIP 10MG', 44, 352, 0, 999, 1, datetime('now'));
