-- Seed mg-per-vial + lab compound mapping (UPDATE by exact name only).
-- NOT a default migrate. Do not run against production D1 from this repo.
-- Local/empty preview only if those columns already exist.
UPDATE products SET vial_mg = 10,   lab_slug = 'semaglutide' WHERE name = 'SEMA 10MG';
UPDATE products SET vial_mg = 5,    lab_slug = 'cagrilintide' WHERE name = 'CAGRI  5MG';
UPDATE products SET vial_mg = 10,   lab_slug = 'retatrutide' WHERE name = 'RETA 10MG';
UPDATE products SET vial_mg = 35,   lab_slug = 'retatrutide' WHERE name = 'RETA 35 MG';
UPDATE products SET vial_mg = 66,   lab_slug = 'retatrutide' WHERE name = 'RETA 66 MG';
UPDATE products SET vial_mg = 34,   lab_slug = 'ghk-cu'      WHERE name = 'GHK-CU 34MG';
UPDATE products SET vial_mg = 10,   lab_slug = 'kpv'         WHERE name = 'KPV 10 MG';
UPDATE products SET vial_mg = 500,  lab_slug = 'nad-plus'    WHERE name = 'NAD+ 500MG';
UPDATE products SET vial_mg = 1000, lab_slug = 'nad-plus'    WHERE name = 'NAD 1000MG';
UPDATE products SET vial_mg = 50,   lab_slug = '5-amino-1mq' WHERE name = '5-AMINO-1MQ 50MG';
UPDATE products SET vial_mg = 30,   lab_slug = 'tirzepatide' WHERE name = 'TIRZ 30MG';
UPDATE products SET vial_mg = 10,   lab_slug = 'mots-c'      WHERE name = 'MOTS-C 10MG';
UPDATE products SET vial_mg = 40,   lab_slug = 'mots-c'      WHERE name = 'MOTS-C 40MG';
UPDATE products SET vial_mg = 10,   lab_slug = 'ss-31'       WHERE name = 'SS-31 10MG';
UPDATE products SET vial_mg = 10,   lab_slug = 'bpc-157'     WHERE name = 'BPC-157 10MG';
UPDATE products SET vial_mg = 10,   lab_slug = 'tb-500'      WHERE name = 'TB-500 10MG';
UPDATE products SET vial_mg = 80,   lab_slug = NULL          WHERE name = 'KLOW 80MG';          -- blend
UPDATE products SET vial_mg = 10,   lab_slug = 'cjc-1295'    WHERE name = 'CJC/IPA NO DAC 10MG'; -- combo
UPDATE products SET vial_mg = 10,   lab_slug = 'ipamorelin'  WHERE name = 'IPA 10MG';
UPDATE products SET vial_mg = 10,   lab_slug = 'melanotan-ii' WHERE name = 'MT2';
UPDATE products SET vial_mg = 10,   lab_slug = NULL          WHERE name = 'PT-141 10 MG';       -- not on tool yet
UPDATE products SET vial_mg = 1200, lab_slug = NULL          WHERE name = 'GLUTATHIONE 1200MG'; -- not on tool yet
UPDATE products SET vial_mg = 10,   lab_slug = 'dsip'        WHERE name = 'DSIP 10MG';
-- MT1 (Melanotan I): no mg in name, no tool match yet — set in admin if desired.
-- BAC WATER products: no peptide mg (they ARE the reconstitution water).
