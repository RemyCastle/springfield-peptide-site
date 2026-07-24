-- Seed mg-per-vial + lab compound mapping for the EXISTING live catalog.
-- Safe for production: UPDATE-only, no DELETE/INSERT, idempotent (re-runnable).
-- Run AFTER deploying (the vial_mg / lab_slug columns are auto-added by
-- ensureCatalogSchema on the first request post-deploy).
--
--   npx wrangler d1 execute springfieldpeps-db --remote --file=./seed-vial-mg.sql
--
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
-- BAC WATER 3ML KIT intentionally left null (no peptide mg).
