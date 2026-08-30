# Pre-redesign functional baseline

Captured from LIVE production (deploy `8cafce85`, 32 active products) by driving the real UI — not by reading the code. The structural redesign must reproduce every number below EXACTLY. Any difference is a regression, not an improvement.

## Cart / pricing (sticky bar, real UI)

**Volume discounts do not exist on SPBC.** `tallyOrder()` states it outright: *"No volume discounts on SPBC — every item bills at full price."* `vialDiscountEligible = false`, `kitRate = 0`. There is **no vial minimum** — one single vial is checkout-legal. **Do not "restore" discounts or a 3-vial minimum** — full price, any qty ≥ 1, is correct.

| Scenario | Expected total | Notes |
|---|---|---|
| 1 × RETA 30MG vial | **$52.50** | 1 × 52.50 · "Ready to order" |
| 2 × RETA 30MG vial | **$105.00** | 2 × 52.50 · NO discount · still checkout-legal |
| 5 × TIRZ 30MG vial | **$217.50** | 5 × 43.50 · NO discount |
| 1 × TIRZ 30MG kit | **$335.00** | "Ready to order" |
| 2 × TIRZ 30MG kit | **$670.00** | 2 × 335 · NO kit discount |
| 3 × RETA 30MG vial + 1 × KLOW 80MG kit | **$562.50** | lines $157.50 + $405.00 |

BAC water is a consumable: never discounted. Kit-only listings cannot be ordered as singles.

## Calculator (real UI, U-100 syringe)

Formula shown on page: `concentration (mcg/mL) = (vial mg × 1000) ÷ BAC mL`; `units = (dose mcg ÷ concentration) × 100`.

| Inputs | Concentration | Units to draw | Volume/dose | Doses/vial |
|---|---|---|---|---|
| 30 mg vial · 2.0 mL BAC · 2.5 mg dose | **15000 mcg/mL · 15 mg/mL** | **16.7** | **0.167 mL** | **12** |
| 10 mg vial · 2.0 mL BAC · 250 mcg dose | **5000 mcg/mL · 5 mg/mL** | **5** | **0.05 mL** | **40** |
| 80 mg vial · 3.0 mL BAC · 5 mg dose | **26666.7 mcg/mL · 26.667 mg/mL** | **18.8** | **0.188 mL** | **16** |

BAC max is 3.0 mL; at the cap the page shows "BAC water is at the 3 mL maximum."
`?p=TIRZ%2030MG` correctly preselects the peptide. The dropdown is catalog-driven: **30 options** (32 products less the 2 BAC WATER rows).

## Known issue found while capturing (verify after redesign)

The order-review modal opened with **no line items and no total rendered** — only the "Email / Name / Total" labels. Either it populates on a path this scripted click did not trigger, or it is a real bug. **Confirm the modal shows correct lines + total before and after the redesign; if it is broken today, report it rather than silently "fixing" it as part of the redesign.**

## Perf baseline to not regress

App JS ~8.8 KB · DOMContentLoaded ~434 ms · load ~704 ms · one `/api/products` fetch · Lighthouse mobile Perf 81 / A11y 100 / BP 100 / SEO 100.
