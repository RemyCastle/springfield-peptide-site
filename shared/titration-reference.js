/**
 * Published reference schedules, keyed by compound family.
 *
 * ── RULES FOR EDITING THIS FILE ────────────────────────────────────────────────
 * 1. EVERY schedule must carry a real `source` + `sourceUrl`. If you cannot cite it,
 *    it does not go in. No community folklore, no "typical" ladders, no guesses.
 * 2. Numbers are transcribed from the cited source. Do not round, average, or
 *    "improve" them, and do not fill a gap by analogy with another compound.
 * 3. `status` is not decoration — it tells the reader how much weight the numbers
 *    carry:
 *      'label'          approved product labelling (strongest)
 *      'trial'          registered clinical-trial protocol (investigational drug)
 *      'fixed'          approved for human use but dosed flat — there is no titration
 *      'none'           no published human schedule exists. Show the gap, never invent.
 * 4. Compounds with status 'none' are the majority of this catalog. That is the honest
 *    answer and it is useful information — it tells a buyer the internet numbers they
 *    have seen are not from a label or a trial.
 *
 * Verified 2026-08-04.
 */
(function () {
  'use strict';

  /** Matched against the product name, first hit wins. Order matters. */
  const FAMILIES = [
    {
      key: 'tirzepatide',
      match: /^TIRZ\b/i,
      label: 'Tirzepatide',
      status: 'label',
      note: 'Approved product labelling. Escalate in 2.5 mg steps no sooner than every 4 weeks; the 2.5 mg start is an initiation dose only.',
      source: 'Eli Lilly Medical — Mounjaro dose escalation',
      sourceUrl: 'https://medical.lilly.com/us/products/answers/how-should-mounjaro-tirzepatide-doses-be-increased-in-adults-110552',
      schedules: [
        {
          name: 'Label ladder to 15 mg',
          perWeek: 1,
          steps: [
            { mg: 2.5, weeks: 4 }, { mg: 5, weeks: 4 }, { mg: 7.5, weeks: 4 },
            { mg: 10, weeks: 4 }, { mg: 12.5, weeks: 4 }, { mg: 15, weeks: 4 },
          ],
        },
        {
          name: 'Stop at 5 mg',
          perWeek: 1,
          steps: [{ mg: 2.5, weeks: 4 }, { mg: 5, weeks: 4 }],
        },
        {
          name: 'Stop at 10 mg',
          perWeek: 1,
          steps: [
            { mg: 2.5, weeks: 4 }, { mg: 5, weeks: 4 },
            { mg: 7.5, weeks: 4 }, { mg: 10, weeks: 4 },
          ],
        },
      ],
    },
    {
      key: 'semaglutide',
      match: /^SEMA\b/i,
      label: 'Semaglutide',
      status: 'label',
      note: 'Approved product labelling. If a step is not tolerated the label says consider delaying escalation by 4 weeks rather than pushing on.',
      source: 'Novo Nordisk (NovoMedLink) — Wegovy dosing; Ozempic labelling',
      sourceUrl: 'https://www.novomedlink.com/obesity/products/treatments/wegovy/dosing-administration/dosing.html',
      schedules: [
        {
          name: 'Weight-management ladder to 2.4 mg (Wegovy)',
          perWeek: 1,
          steps: [
            { mg: 0.25, weeks: 4 }, { mg: 0.5, weeks: 4 }, { mg: 1, weeks: 4 },
            { mg: 1.7, weeks: 4 }, { mg: 2.4, weeks: 4 },
          ],
        },
        {
          name: 'Type-2-diabetes ladder to 2 mg (Ozempic)',
          perWeek: 1,
          steps: [
            { mg: 0.25, weeks: 4 }, { mg: 0.5, weeks: 4 },
            { mg: 1, weeks: 4 }, { mg: 2, weeks: 4 },
          ],
        },
      ],
    },
    {
      key: 'retatrutide',
      match: /^RETA\b/i,
      label: 'Retatrutide',
      status: 'trial',
      note: 'INVESTIGATIONAL — not an approved medicine anywhere. These are the escalation steps used in the Phase 3 TRIUMPH programme, not a label.',
      source: 'Eli Lilly — Phase 3 TRIUMPH results announcement',
      sourceUrl: 'https://investor.lilly.com/news-releases/news-release-details/lillys-triple-agonist-retatrutide-delivered-powerful-weight-loss',
      schedules: [
        {
          name: 'TRIUMPH escalation to 12 mg',
          perWeek: 1,
          steps: [
            { mg: 2, weeks: 4 }, { mg: 4, weeks: 4 },
            { mg: 6, weeks: 4 }, { mg: 9, weeks: 4 }, { mg: 12, weeks: 4 },
          ],
        },
        { name: 'TRIUMPH target 4 mg', perWeek: 1, steps: [{ mg: 2, weeks: 4 }, { mg: 4, weeks: 4 }] },
        {
          name: 'TRIUMPH target 9 mg',
          perWeek: 1,
          steps: [{ mg: 2, weeks: 4 }, { mg: 4, weeks: 4 }, { mg: 6, weeks: 4 }, { mg: 9, weeks: 4 }],
        },
      ],
    },
    {
      key: 'cagrilintide',
      match: /^CAGRI\b/i,
      label: 'Cagrilintide',
      status: 'trial',
      note: 'INVESTIGATIONAL — not approved. Steps below follow the registered Phase 3 protocol (escalation every 4 weeks, maintenance from week 17). Sourcing is a trial protocol rather than a label, so treat it as weaker than the tirzepatide or semaglutide entries.',
      source: 'ClinicalTrials.gov NCT04982575 — cagrilintide + semaglutide protocol',
      sourceUrl: 'https://clinicaltrials.gov/study/NCT04982575',
      schedules: [
        {
          name: 'Trial escalation to 2.4 mg',
          perWeek: 1,
          steps: [
            { mg: 0.25, weeks: 4 }, { mg: 0.5, weeks: 4 },
            { mg: 1, weeks: 4 }, { mg: 1.7, weeks: 4 }, { mg: 2.4, weeks: 4 },
          ],
        },
      ],
    },

    /* ── Approved for human use, but dosed FLAT — a titration ladder does not exist ── */
    {
      key: 'tesamorelin',
      match: /^Tesamorelin\b/i,
      label: 'Tesamorelin',
      status: 'fixed',
      note: 'Approved as a prescription medicine, but given at a fixed daily dose — there is no escalation ladder to reproduce. Check the current product labelling for the figure; this planner will not assert one.',
      source: 'FDA Drugs@FDA — product labelling',
      sourceUrl: 'https://www.accessdata.fda.gov/scripts/cder/daf/',
      schedules: [],
    },
    {
      key: 'pt141',
      match: /^PT-?141\b/i,
      label: 'PT-141 (bremelanotide)',
      status: 'fixed',
      note: 'Approved as a prescription medicine, used as-needed at a single fixed dose with a per-day and per-month cap — not a titration. Check the current labelling; this planner will not assert a figure.',
      source: 'FDA Drugs@FDA — product labelling',
      sourceUrl: 'https://www.accessdata.fda.gov/scripts/cder/daf/',
      schedules: [],
    },

    /* ── No published human schedule. This is the honest answer for most of the list ── */
    {
      key: 'melanotan',
      match: /^MT\s?[12]\b/i,
      label: 'Melanotan I / II',
      status: 'none',
      note: 'Not an approved medicine in any major market and no published human dose schedule exists. Regulators have issued warnings about unlicensed products of this type. Any ladder circulating online is not from a label or a registered trial.',
      schedules: [],
    },
    {
      key: 'unstudied',
      match: /^(BPC-?157|TB-?500|KPV|KLOW|GHK|MOTS-?C|SS-?31|NAD|5-?AMINO|DSIP|IPA|CJC|GLUTATHIONE|SELANK|SEMAX)/i,
      label: 'No published human schedule',
      status: 'none',
      note: 'There is no approved labelling and no registered human titration protocol for this compound. Dosing figures circulating online are community convention, not published data — so this planner will not print a number it cannot cite. Enter your own values if you want the arithmetic.',
      schedules: [],
    },
  ];

  function forProduct(name) {
    if (!name) return null;
    return FAMILIES.find((f) => f.match.test(String(name).trim())) || null;
  }

  window.SPBC_TITRATION_REFERENCE = { FAMILIES, forProduct };
})();
