/**
 * SPBC common research stacks — data only.
 * Dosage / duration values are commonly-cited research reference ranges only.
 * Not medical advice. Not for human consumption. Edit this file to update ranges.
 *
 * Product names MUST match the live catalog exactly (join key for cart + prices).
 */
window.SPBC_STACKS = [
  {
    id: 'metabolic-single',
    name: 'Metabolic — single agent',
    category: 'GLP-1 / metabolic research',
    duration: '8–12 weeks (commonly cited research span)',
    items: [
      {
        product: 'TIRZ 30MG',
        vials: 1,
        refRange: '2.5–15 mg weekly titration range (research literature; not a protocol)',
      },
    ],
  },
  {
    id: 'metabolic-dual',
    name: 'Metabolic — dual',
    category: 'GLP-1 / metabolic research',
    duration: '8–12 weeks (commonly cited research span)',
    items: [
      {
        product: 'RETA 30MG',
        vials: 1,
        refRange: '2–12 mg weekly titration range (research literature; not a protocol)',
      },
      {
        product: 'CAGRI 10MG',
        vials: 1,
        refRange: '0.6–2.4 mg weekly range (research literature; not a protocol)',
      },
    ],
  },
  {
    id: 'recovery-repair',
    name: 'Recovery / repair',
    category: 'Repair research',
    duration: '4–6 weeks (commonly cited research span)',
    items: [
      {
        product: 'BPC-157 10MG',
        vials: 1,
        refRange: '250–500 mcg daily range (research literature; not a protocol)',
      },
      {
        product: 'TB-500 10MG',
        vials: 1,
        refRange: '2–5 mg twice weekly loading, then lower maintenance (research literature; not a protocol)',
      },
    ],
  },
  {
    id: 'skin-cosmetic',
    name: 'Skin / cosmetic',
    category: 'Cosmetic / skin research',
    duration: '4–8 weeks (commonly cited research span)',
    items: [
      {
        product: 'GHK-CU 50MG',
        vials: 1,
        refRange: '1–2 mg daily topical/injectable research ranges vary widely',
      },
      {
        product: 'KLOW 80MG',
        vials: 1,
        refRange: 'Blend vial — follow labeled research reconstitution notes',
      },
    ],
  },
  {
    id: 'mitochondrial',
    name: 'Mitochondrial',
    category: 'Mitochondrial research',
    duration: '4–8 weeks (commonly cited research span)',
    items: [
      {
        product: 'MOTS-C 40MG',
        vials: 1,
        refRange: '5–15 mg 2–3× weekly range (research literature; not a protocol)',
      },
      {
        product: 'SS-31 10MG',
        vials: 1,
        refRange: '5–10 mg daily short runs (research literature; not a protocol)',
      },
      {
        product: 'NAD+ 1000MG',
        vials: 1,
        refRange: '50–500 mg per session ranges reported (research literature; not a protocol)',
      },
    ],
  },
  {
    id: 'gh-secretagogue',
    name: 'GH secretagogue',
    category: 'GH-axis research',
    duration: '8–12 weeks (commonly cited research span)',
    items: [
      {
        product: 'CJC/IPA NO DAC 10MG',
        vials: 1,
        refRange: '100–300 mcg each, 1–2× daily research ranges (not a protocol)',
      },
      {
        product: 'Tesamorelin',
        vials: 1,
        refRange: '1–2 mg daily research range (not a protocol)',
      },
    ],
  },
  {
    id: 'gut-immune',
    name: 'Gut / immune',
    category: 'Gut / immune research',
    duration: '4–6 weeks (commonly cited research span)',
    items: [
      {
        product: 'KPV 10 MG',
        vials: 1,
        refRange: '200–500 mcg daily range (research literature; not a protocol)',
      },
      {
        product: 'BPC-157 10MG',
        vials: 1,
        refRange: '250–500 mcg daily range (research literature; not a protocol)',
      },
    ],
  },
  {
    id: 'sleep-recovery',
    name: 'Sleep / recovery',
    category: 'Sleep / recovery research',
    duration: '2–4 weeks (commonly cited research span)',
    items: [
      {
        product: 'DSIP 10MG',
        vials: 1,
        refRange: '100–300 mcg before sleep range (research literature; not a protocol)',
      },
      {
        product: 'GLUTATHIONE 1200MG',
        vials: 1,
        refRange: '200–600 mg per session ranges reported (research literature; not a protocol)',
      },
    ],
  },
];

/** Catalog product name for optional bacteriostatic water line.
 *  Must match the storefront auto-add SKU (kits-only checkout). */
window.SPBC_STACKS_BAC_PRODUCT = 'BAC WATER 2.5ML';
