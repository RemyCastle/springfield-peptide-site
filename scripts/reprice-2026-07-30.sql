-- Reprice 23 public catalog items (2026-07-30).
-- HELD: 5-AMINO-1MQ 50MG (46/342 franchisee guard), BAC WATER 3ML, BAC WATER 10 ML.
-- Do NOT run schema.sql against production.

UPDATE products SET vial_price = 52, pack_price = 416, updated_at = datetime('now') WHERE name = 'RETA 10MG';
UPDATE products SET vial_price = 168, pack_price = 1344, updated_at = datetime('now') WHERE name = 'RETA 35 MG';
UPDATE products SET vial_price = 290, pack_price = 2320, updated_at = datetime('now') WHERE name = 'RETA 66 MG';
UPDATE products SET vial_price = 60, pack_price = 480, updated_at = datetime('now') WHERE name = 'SEMA 10MG';
UPDATE products SET vial_price = 36, pack_price = 288, updated_at = datetime('now') WHERE name = 'CAGRI  5MG';
UPDATE products SET vial_price = 72, pack_price = 576, updated_at = datetime('now') WHERE name = 'TIRZ 30MG';
UPDATE products SET vial_price = 18, pack_price = 144, updated_at = datetime('now') WHERE name = 'GHK-CU 34MG';
UPDATE products SET vial_price = 31, pack_price = 248, updated_at = datetime('now') WHERE name = 'KPV 10 MG';
UPDATE products SET vial_price = 48, pack_price = 384, updated_at = datetime('now') WHERE name = 'NAD+ 500MG';
UPDATE products SET vial_price = 68, pack_price = 544, updated_at = datetime('now') WHERE name = 'NAD 1000MG';
UPDATE products SET vial_price = 44, pack_price = 352, updated_at = datetime('now') WHERE name = 'MOTS-C 10MG';
UPDATE products SET vial_price = 104, pack_price = 832, updated_at = datetime('now') WHERE name = 'MOTS-C 40MG';
UPDATE products SET vial_price = 52, pack_price = 416, updated_at = datetime('now') WHERE name = 'SS-31 10MG';
UPDATE products SET vial_price = 32, pack_price = 256, updated_at = datetime('now') WHERE name = 'BPC-157 10MG';
UPDATE products SET vial_price = 34, pack_price = 272, updated_at = datetime('now') WHERE name = 'TB-500 10MG';
UPDATE products SET vial_price = 72, pack_price = 576, updated_at = datetime('now') WHERE name = 'KLOW 80MG';
UPDATE products SET vial_price = 45, pack_price = 360, updated_at = datetime('now') WHERE name = 'CJC/IPA NO DAC 10MG';
UPDATE products SET vial_price = 28, pack_price = 224, updated_at = datetime('now') WHERE name = 'IPA 10MG';
UPDATE products SET vial_price = 35, pack_price = 280, updated_at = datetime('now') WHERE name = 'PT-141 10 MG';
UPDATE products SET vial_price = 44, pack_price = 352, updated_at = datetime('now') WHERE name = 'MT1';
UPDATE products SET vial_price = 44, pack_price = 352, updated_at = datetime('now') WHERE name = 'MT2';
UPDATE products SET vial_price = 41, pack_price = 328, updated_at = datetime('now') WHERE name = 'GLUTATHIONE 1200MG';
UPDATE products SET vial_price = 44, pack_price = 352, updated_at = datetime('now') WHERE name = 'DSIP 10MG';
