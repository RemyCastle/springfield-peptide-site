/**
 * First contents of supplier_map: show-me-source product id -> SPBC product name.
 * Only used when the table is empty. After that, the SPBC admin (Supplier sync tab)
 * is where new supplier products get mapped or skipped.
 * Supplier ids read from show-me-source inventory.php on 2026-11-23.
 */
export const SEED_MAP = [
  { supplier_id: 34, supplier_name: 'R 10MG', spbc_name: 'RETA 10MG' },
  { supplier_id: 1, supplier_name: 'R 30 MG', spbc_name: 'RETA 30MG' },
  { supplier_id: 11, supplier_name: 'R 60 MG', spbc_name: 'RETA 60 MG' },
  { supplier_id: 6, supplier_name: 'T 30 MG', spbc_name: 'TIRZ 30MG' },
  { supplier_id: 13, supplier_name: 'T60', spbc_name: 'TIRZ 60MG' },
  { supplier_id: 38, supplier_name: 'T 100 MG', spbc_name: 'TIRZ 100MG' },
  { supplier_id: 28, supplier_name: 'CAGRI 10 MG', spbc_name: 'CAGRI 10MG' },
  { supplier_id: 35, supplier_name: 'CARGI 5MG', spbc_name: 'CAGRI  5MG' },
  { supplier_id: 2, supplier_name: 'GHK-CU 50 MG', spbc_name: 'GHK-CU 50MG' },
  { supplier_id: 15, supplier_name: 'GHK-CU 75MG', spbc_name: 'GHK-CU 75MG' },
  { supplier_id: 3, supplier_name: 'KPV 10 MG', spbc_name: 'KPV 10 MG' },
  { supplier_id: 7, supplier_name: 'BPC-157 10 MG', spbc_name: 'BPC-157 10MG' },
  { supplier_id: 24, supplier_name: 'WOLVERINE 20 MG', spbc_name: 'WOLVERINE 20MG' },
  { supplier_id: 4, supplier_name: '5-AMINO-1MQ 50 MG', spbc_name: '5-AMINO-1MQ 50MG' },
  { supplier_id: 5, supplier_name: 'NAD 1000 MG', spbc_name: 'NAD+ 1000MG' },
  { supplier_id: 8, supplier_name: 'MOTS-C 40 MG', spbc_name: 'MOTS-C 40MG' },
  { supplier_id: 36, supplier_name: 'Mots-C 10 mg', spbc_name: 'MOTS-C 10MG' },
  { supplier_id: 33, supplier_name: 'SS31 30MG', spbc_name: 'SS-31 30MG' },
  { supplier_id: 16, supplier_name: 'SS31 50 MG', spbc_name: 'SS-31 50MG' },
  { supplier_id: 9, supplier_name: 'KLOW 80 MG', spbc_name: 'KLOW 80MG' },
  // Out of stock on 2026-11-23; Remy: hide until it is back. hidden_by_sync lets the sync bring it back.
  { supplier_id: 10, supplier_name: 'CJC/IPA 10 MG No DAC', spbc_name: 'CJC/IPA NO DAC 10MG', hidden_by_sync: true },
  { supplier_id: 22, supplier_name: 'Tesa 20 mg', spbc_name: 'Tesamorelin 20MG' },
  { supplier_id: 21, supplier_name: 'Ipamorelin 10 MG', spbc_name: 'IPA 10MG' },
  { supplier_id: 14, supplier_name: 'Semax 10 mg', spbc_name: 'SEMAX 10MG' },
  { supplier_id: 23, supplier_name: 'Selank 10 MG', spbc_name: 'SELANK 10MG' },
  { supplier_id: 17, supplier_name: 'PT-141 10 MG', spbc_name: 'PT-141 10 MG' },
  { supplier_id: 18, supplier_name: 'PE-22-28 10 MG', spbc_name: 'PE-22-28 10MG' },
  { supplier_id: 25, supplier_name: 'Thymosin Alpha-1 10 MG', spbc_name: 'THYMOSIN A1 10MG' },
  { supplier_id: 26, supplier_name: 'Thymalin 10 MG', spbc_name: 'THYMALIN 10MG' },
  { supplier_id: 27, supplier_name: 'VIP 10 MG', spbc_name: 'VIP 10MG' },
  { supplier_id: 40, supplier_name: 'EPITHALON', spbc_name: 'EPITHALON' },
  // Lab supplies: Remy said skip (2026-11-23).
  { supplier_id: 19, supplier_name: 'Sterile Vial Spike', skip: true },
  { supplier_id: 20, supplier_name: 'Sterile 10ml vial', skip: true },
  { supplier_id: 30, supplier_name: '30mL Bac Water', skip: true },
  { supplier_id: 32, supplier_name: '5mL 0.9% Saline Solution', skip: true },
  { supplier_id: 39, supplier_name: '10mL ampoule', skip: true },
];
