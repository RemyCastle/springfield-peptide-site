# Decisions - springfield-peptide-site

Append-only log. Newest at bottom.

### 2026-08-03 — Denser price list: responsive grid + category groups
- Decision: `#priceTable` is a category-grouped layout; each group has a sticky subheader and an inner responsive grid (1 col below 640px, 2 at 640+, 3 at 1024+) with `minmax(0,1fr)` tracks. Prices shell uses shared `72rem` `.spbc-main` (removed `max-w-screen-md` constraint).
- Category map is a single `PRODUCT_CATEGORY_BY_NAME` object in `shared/store.js` keyed by exact product name; unmapped names fall through to **Other research** so new products never disappear.
- Price cards drop `.reveal` (design.md: never animate product card opacity). Sticky group headings use `z-index: var(--spbc-z-content)` below header 50; `--spbc-header-sticky-offset` is measured from the real header in `site-header.js`.
- Search/filter hides empty groups + shows `#filterResultCount`. In-cart keeps gold accent (`.in-cart` / qty-flash language).
- No worker, secret, price, or product-name changes.

### 2026-07-11
- Decision: Initialized project memory for local AI system
- Why: Enable persistent context across Grok + Ollama tandem sessions

### 2026-07-16
- Decision: Site `/admin` proxies orders from spbc-orders (Bearer ORDERS_ADMIN_TOKEN) instead of embedding a second auth UI
- Why: One admin login for price list + order log; orders stay in D1 on the orders worker
- Env: set Pages secret `ORDERS_ADMIN_TOKEN` = spbc-orders `ADMIN_TOKEN`; optional `ORDERS_PUBLIC_URL`

### 2026-07-19
- Decision: Claude dual-check upgrade set shipped on public storefront only (index + calculator)
- Shipped: CSS hero (no picsum), sticky cart bar + discount progress, localStorage cart/contact draft, product search/filter, order review modal, copy order #, shareable calculator URL + copy results, a11y skip-link/aria-live/focus-on-error, skeleton loading
- Why: Conversion + mobile UX without new services or backend refactors
- Deploy: root HTML is source of truth; copy to `.cf-pages/` for Pages build output

### 2026-07-20
- Decision: Unified public header via `/shared/site-header.css` + `/shared/site-header.js` (not inlined)
- Why: index vs calculator headers drifted (active pill, logo link, type size); shared files prevent re-drift
- Features: sliding gold nav pill, scroll shrink + frosted glass, one-shot shimmer, hover preview, reduced-motion, `spbcHeaderRefresh()` after password unlock
- Admin header left separate (auth surface)
- No Motion/GSAP on SPBC (static, no bundler) per Claude

### 2026-07-20 (later)
- Decision: Layered-depth redesign — `shared/site-atmosphere.css|js` as single visual system for index/calc/coaching
- Cache-busters: site-header ?v=6, site-atmosphere ?v=4
- Deleted site-fx.* duplicates
- Deploy: copy root HTML + shared/* → `.cf-pages/` then `wrangler pages deploy .cf-pages --branch=main`
- Three.js CDN kept for particles only; no GSAP; reduced-motion gates all effects

### 2026-07-20 (QA/SEO pack)
- robots.txt + sitemap.xml (home only) + favicon.svg
- noindex on calculator, coaching, admin
- calc/coach: spbc-locked FOUC hide + mainContent hidden until session; cookie `spbc_member=1` on unlock
- /api/products requires member cookie (soft gate); override MEMBERS_API_OPEN=1 if needed
- Home: canonical + OG/Twitter + Organization JSON-LD
- Soft gate is intentional UI privacy, not hard security (document)

### 2026-07-30 — Public catalog reprice (23 items)
- Decision: Repriced 23 active products ~20% under min(Royal Peptides, DryvLife). **Held** `5-AMINO-1MQ 50MG` at 46 / 342 (public) pending a patriotic franchisee override — do not change that row without setting an explicit franchisee cost override first.
- Franchisee neutrality this run: zero edits to spbc-orders worker, zero franchisee overrides written, zero changes under `functions/api/admin/franchisees/**`. Patriotic null-override fallback still resolves to the same cost for 5-AMINO because public price was unchanged.
- Override formula once Remy sets patriotic cost for 5-AMINO (customer dollars → cents / 1.2 margin / 50¢ snap): `floor(customer_cents / 1.2 / 50) * 50` → today **3800** vial cents / **28500** pack cents for public 46 / 342.
- Also held unchanged: `BAC WATER 3ML` (5/50), `BAC WATER 10 ML` (30/96).
- Seed: `schema.sql` INSERT block rewritten to match all 26 production active products (names, kit_only, sort_order, new prices). Never run schema.sql against production (DELETE + reseed).

### 2026-07-30 — Invisible product cards hotfix
- Bug: `.reveal { opacity: 0 }` gated visibility on IntersectionObserver; observer miss left all 26 cards permanently invisible (data-reveal-bound=1, no is-visible). DOM text still returned content so text assertions missed it.
- Fix: content visible by default; hide only under `html.spbc-anim` (set by site-atmosphere.js when IO + motion OK); 1.5s revealAll safety net; GSAP from→fromTo with explicit opacity:1 + clearProps so inline styles cannot stick at 0.
- Cache-busters: site-atmosphere.css ?v=12, site-atmosphere.js ?v=10 on all public pages.

### 2026-07-30 — Admin: new products top + franchisee link create
- New products: POST `/api/admin/products` no longer defaults `sort_order` to 999; when omitted, uses `MIN(sort_order)-10` (or 10 if empty) so each add lands at position 1. Explicit sort still honoured from product edit cards.
- Franchisee pricing always works: new Pages proxy `PUT /api/admin/franchisees/:slug/links` → worker product-links upsert. Admin UI does PUT-then-PATCH so saving a cost creates the link when missing (fixes `link_not_found` / silent public-price tracking).
- Add-product modal replaces `prompt()` chain; franchisee cost inputs prefilled with `floor(cents/1.2/50)*50` fallback and recompute live.
- Worker (spbc-orders) not modified.

### 2026-07-30 — Stacks nav + live calculator + franchisee sync
- Unit A: calculator `#peptideName` loads from `/api/products` (skip BAC WATER); fallback embeds current non-BAC catalog so dropdown never empty; `data-mg` parsed from name; math/syringe/`?p=` unchanged.
- Unit B: `stacks.html` + `shared/stacks.js` (8 stacks, research reference ranges only, no therapeutic claims). Cart merge into `spbc_cart_draft` with vial≤10 / kit clamp; optional BAC WATER 3ML = vial count. Dynamic stack cards intentionally omit `.reveal` (would stick at opacity 0 after async inject under `html.spbc-anim`). `_headers` pins `shared/stacks.js` Content-Type.
- Unit C: DELETE proxy on `functions/api/admin/franchisees/[slug]/links.js`; admin "Sync all products" panel (Link all + remove stale) — explicit click only; costs use fallback formula never NULL. Worker not edited/redeployed. Admin credentials not available in ship agent env — Remy must click Link all / Remove all stale on patriotic to finish 32/32.

### 2026-07-30 - Uniform hero height
- Claude fix: .page-hero min-height 32rem mobile / 31rem desktop + flex center; no fixed height, no per-page overrides.
- Grok defect fix on review: added `box-sizing: border-box` on .page-hero so the rem floors are TOTAL height (without it, content-box stacked padding and heroes would be ~640–664px).
- Cache-buster site-atmosphere.css ?v=13 on all 6 HTML pages. Deploy 1a899832 Source 5077965.
- Mobile h-scroll (~401 vs 375) is pre-existing `.site-header__nav` overflow, not hero flex.
- Unit C (patriotic sync) still needs Remy admin session — no secrets touched.

### 2026-07-30 - Hero eyebrow specificity + phone trim
- Root cause: `body.atmosphere p` out-specced bare `.page-hero-eyebrow` (16px not 12px).
- Fix: `body.atmosphere p.page-hero-eyebrow` + phone spacing trim under 767px (no hide/remove).
- Grok review: moved phone-trim media block AFTER base `.trust-badge` so min-height/padding/font-size overrides actually cascade.
- Cache-buster site-atmosphere.css ?v=14. Deploy 4fc2b84e Source 98df411.
- 360px: index stays at floor 512 with working badge trim (inner ~369); not the ~573 pre-cascade-fix estimate.
- Pre-existing 375 h-scroll (~401 vs 375) still present; not fixed this ship.

- Follow-up: custom domain Cache-Control max-age=14400 (zone, not _headers 300) polluted ?v=14 briefly; bumped to ?v=15. Deploy 0a75612c Source 1823426.

### 2026-08-03 - Nav active on link + unified heroes
- Bug: Unit D hid `.nav-pill` to kill 375px h-scroll but left no visible active-tab indicator (pill dead, link styles not reliable/desyncable).
- Fix: remove `.nav-pill` DOM + CSS + movePill JS entirely; style `.nav-link.active` / `[aria-current=page]` with gold gradient + black text on the link itself. Keep `resolveActive` + `spbcHeaderRefresh`.
- Heroes: calculator gets ambient video (reuses home loop/poster); calculator/stacks/coaching get the same 3 trust badges as index. Coaching price folded into subtitle so structure is eyebrow -> h1 -> sub -> 2 CTAs -> 3 badges -> video.
- Raised shared `--spbc-hero-min` to 34rem mobile+desktop so uniform height holds with badges on all tabs (min-height only, border-box).
- Asset hash: site-header + site-atmosphere re-hashed via scripts/hash-shared.js.
- Untouched: secrets, spbc-orders worker, prices/product names, age-gate member cookie + price fetch, admin save-in-place, stacks cart merge.


### 2026-08-03 - Structural redesign (one shell, one stylesheet, zero drift)
- Rollback tag: `pre-redesign-2026-08-03` (502f8b1)
- Unit A: `src/partials` + `src/pages` + `scripts/build-pages.js`; root HTML GENERATED
- Unit B: all page CSS → `shared/site-atmosphere.css` (tokens); zero `<style>` / themeable `style=` in public pages
- Unit C: relocate-only JS → `shared/store.js`, `calculator.js`, `coaching.js`, `stacks-page.js` (hashed)
- Active nav: `.site-header .nav-link.active` color `#0B120E` on gold; measured contrast **13.46:1**
- Edge note: custom-domain once served HTML for a hashed CSS URL (immutable cache pollution); rehash + Content-Type pins on `/shared/*`
- Order modal: works on real form submit path (lines+total); empty when opened without form context (pre-existing; not a redesign regression)
- No secrets, prices, product names, or spbc-orders worker touched

### 2026-08-20 — Stacks kit prices, shared cart, wrapping nav
- Live `/api/products` (member): TIRZ 30MG / RETA 30MG have `vial_price` null and `pack_price` 415 / 515. CAGRI 10MG still has vial 41 / pack 545. BAC WATER 3ML vial is 5. That is why stacks showed "$0" on the main peptide, "$41" on CAGRI, and totals of $5 / $51 (BAC vial ± CAGRI vial only).
- Public storefront is kits-only (`PUBLIC_KITS_ONLY`). Stacks now price and add **pack/kit** qty using `pack_price` (fall back to a positive vial price only if pack is missing). BAC line uses `BAC WATER 2.5ML` (same SKU Home auto-adds), falling back to 3ML if needed.
- Add-stack wrote `{vial:N, pack:0}`. Home has no vial steppers, so `saveCartDraft()` rebuilt an empty draft and wiped `spbc_cart_draft`. Writers now merge kit qty; Home restores vial-only drafts onto the kit stepper; save is a merge and no-ops while `#priceTable` has no cards.
- Header cart chip + stacks cart strip read the same `spbc_cart_draft` key (`spbc-cart-changed` + `storage`).
- 375px nav: wrap the pill row (no hamburger overlay). Desktop ≥640px stays a single nowrap row.
- Sticky cart: the whole head (including "Tap to expand") toggles lines. When the order-summary textarea is in view the bar docks compact so it does not cover `#message`.
- No D1 / admin / secret / worker changes.

### 2026-08-20 — Review follow-up (schema guard, BAC match, kits copy, titration, D1 reprice)
- `schema.sql` is DDL only (CREATE IF NOT EXISTS). DELETE/reseed moved to `schema.local-seed.sql`, which RAISE(ABORT)s if `products` already has rows. Historical `reprice-2026-07-30.sql` now aborts on execute. No file was run against D1.
- BAC auto-add matches live names in order: `BAC WATER 2.5ML`, then `3ML`, then `10 ML`, then any BAC WATER card. No product renames. If none exist, `#bacIncludeStatus` warns instead of a silent skip.
- Terms + `#vialRuleStatus` match kits-only (no 3-vial minimum). Kit-only filter chip is hidden on the public kits-only storefront so it cannot empty the catalog.
- `/titration.html` is a built retired-notice page (no planner JS). Live had been 200-serving the homepage because the file was not in `PAGE_NAMES`.
- `POST /api/place-order` re-prices every line from D1 `pack_price` and ignores client `unit_price_cents` / `total_cents`. Coaching helper text says we email them.

### 2026-08-20 — Add-stack click was a silent no-op
- Live smoke after f454bad: kit prices and Home→Stacks cart persist worked; **Add stack to cart** on enabled cards did nothing (no toast, `spbc_cart_draft` stayed the home-only TIRZ 10MG line).
- Cause: `onAddStack` gated the merge behind `window.confirm`. Blocked or dismissed dialogs return `false` with no UI, so the handler exited before `mergeIntoCart` / toast / header update. Per-button listeners were also rebound by `innerHTML` replace.
- Fix: one-click merge of kit/`pack` qty (accepts `kits` or legacy `vials`); delegated click on `#stacksGrid`; toast + `spbc-cart-changed` + header refresh; no confirm and no auto-redirect. Home re-applies the draft after price cards render so sticky cart picks up stack lines.

### 2026-08-30 — No single-vial minimum on the public storefront
- Remy: "No vials minimums on spbc." Customers may buy 1 vial. 10-packs stay available. kit_only products (e.g. HGH) stay kit-only.
- `PUBLIC_KITS_ONLY = false` so vial_price products show a vial stepper. `MIN_SINGLE_VIALS` and the checkout gate (`singleVials > 0 && singleVials < N`) are gone. One vial is checkout-legal.
- No volume discounts (unchanged). No new prices.
- `POST /api/place-order` prices vial lines from D1 `vial_price` (was kit-only reprice). Rejects kit_only as vials. No server vial-count minimum. BAC auto-add still applies per peptide kit, not per single vial.
- Terms + ordering-rules + flyer point no longer say kits-only or a 3-vial minimum.
- Patriotic Peptides, live D1, and `schema.sql` were not touched.

### 2026-08-30 — Catalog display: singles, vial-only RETA 66, new category keys
- CoS writes live prices to production D1. Storefront only maps names and steppers. No schema.sql, no DELETE, no franchisee/Patriotic edits.
- `PUBLIC_KITS_ONLY = false` and no `MIN_SINGLE_VIALS` (same as the no-minimum pass).
- Hide the 10-pack stepper when `pack_price` is 0. RETA 66MG (`kit_only=1`, vial=pack=70) is labeled **Vial**, not 10-pack. HGH kit_only rows (no vial_price) stay **Kit**.
- Category keys added (exact names): RETA 66MG, SEMAX 10MG, SS-31 50MG, PE-22-28 10MG, Tesamorelin 10MG, Tesamorelin 20MG. Left `RETA 60 MG` and unlabeled `Tesamorelin`.
- Did not add sterile spike or 10ml vial products. BAC rows unchanged.

### 2026-08-30 — Stop auto-including BAC water on the public storefront
- Remy: take off "BAC water included". Customers must not get a BAC kit auto-added per peptide kit. BAC can stay as a normal optional catalog product.
- Removed client auto-add (`AUTO_BAC_PREFERRED`, `findBacCard`, `setBacIncludeWarning`, tally top-up) and server `applyAutoBac` / `resolveBacRow`. `POST /api/place-order` now uses only the lines the customer submitted.
- Left BAC names in `PRODUCT_CATEGORY_BY_NAME` and did not touch D1 / `schema.sql`.
- Stacks BAC checkbox defaults off (was checked). Copy no longer says the price list adds BAC at checkout.
- `PUBLIC_KITS_ONLY` stays false; single vials, RETA 66 vial-only, and no 3-vial minimum unchanged.

### 2026-08-30 — Remove public Stacks and Coaching
- Remy: kill Common Stacks and Research Coaching ($100/hr). Keep calculator, contact, titration, shop. BAC stays optional, not auto-included.
- Deleted `stacks.html` / `coaching.html` sources, hashed page JS, and `POST /api/coaching-request`. Nav is Home / Calculator / Contact.
- Homepage secondary CTA is the dosage calculator. Contact no longer points at coaching.
- `_redirects` + local `server.js` send `/stacks`, `/stacks.html`, `/coaching`, `/coaching.html` (and trailing-slash variants) to `/`.
- Did not delete BAC SKUs, run `schema.sql`, or deploy master. Video files for old heroes left on disk (not linked from nav).

### 2026-11-23 — Local seed guard actually runs
- `schema.local-seed.sql` guard used `RAISE()` outside a trigger, so SQLite rejected the file on every DB (it never seeded anything). D1 also refuses TEMP tables/triggers.
- Guard now forces `json_extract('{}', <message>)` when `products` has rows: fails with "bad JSON path: REFUSING TO SEED ...", creates nothing. Missing table fails with "no such table". The INSERT also has `WHERE NOT EXISTS (SELECT 1 FROM products)` as a second net.
- Tested on local D1 only: empty -> 26 rows; filled -> refused, count unchanged; no table -> refused.

### 2026-11-23 — show-me-source dropship: new prices, 2-vial / 1-kit minimum, $15 shipping, no franchisees
- Remy: no more franchisees. Stock is dropshipped from show-me-source.com. SPBC price = supplier preferred vial + $25, supplier kit + $200. $15 shipping per order. Minimum: 2 vials (any mix of products) or 1 kit.
- Server (`functions/lib/orderItems.js`): `MIN_ORDER_VIALS = 2`, `SHIPPING_CENTS = 1500`; `normalizeOrderItems` returns `order_minimum` when kits = 0 and vials < 2. `place-order.js` always sets shipping to 1500 and ignores client `shipping_cents`. spbc-orders already validates total = subtotal + shipping, so no worker change.
- Storefront (`shared/store.js`): same constants, progress hint + status + submit gate for the minimum, shipping line in the order summary, review modal and totals. Terms copy updated.
- Admin: Franchisees tab, Price list franchisee pricing, add-product franchisee costs and the Sales report franchisee picker removed. `functions/api/admin/franchisees*` moved to `_trash/`. Old franchisee orders still show their banner in order detail. spbc-orders worker and Patriotic site untouched.
- Catalog: 31 show-me-source peptides (supplies skipped by Remy; CJC/IPA hidden while supplier is out of stock). Everything else set inactive (kept, not deleted). Backup: `C:\Users\Remy\backups\springfield\products-before-sms-20261123.sql`. Supplier bulk tiers ignored.

### 2026-11-23 — Five show-me-source features
- **Place at show-me-source helper** (admin order detail + "To place" / "SMS ✓" chips): supplier names from `supplier_map`, supplier cost = SPBC price - $25 per vial / - $200 per kit, copy-address/items buttons, "Mark placed" stored in D1 `supplier_orders` (no spbc-orders change).
- **Lab reports**: the sync stores the supplier COA link in `supplier_map.coa_url`; `/api/lab-report?p=` streams it through springfieldpbc.com (only from show-me-source, PDF/image only). Off until Remy turns on "Lab reports on the shop" (`site_settings.show_lab_reports`), because the document may name the supplier.
- **Order lookup** `/track.html` + `/api/order-status`: order number + matching email; returns status, tracking, items, total only. Partner orders are hidden. Linked from the nav and the order confirmation.
- **Low stock / back in stock**: the sync copies `low_inventory` into `supplier_map`; `/api/products` adds `low_stock`, `lab_report` and a separate `out_of_stock` list (kept out of `products`, which spbc-orders also reads). Shop shows a "Low stock" badge and a "Sold out, back soon" section with "Email me when it's back" (`restock_requests`). The sync emails waiting people via Resend once the product is for sale; needs RESEND_API_KEY + RESTOCK_FROM on the sync Worker, otherwise sign-ups wait (admin shows counts).
- **Order again**: on the lookup page; refills `spbc_cart_draft`. Not in the shipped email yet (that email is sent by spbc-orders).
- Tables are created on first use (`workers/supplier-sync/src/schema.js`).

### 2026-11-23 — Five automations (all off until Remy switches them on)
- Admin → Supplier sync → **Automations** card writes `site_settings` (whitelisted keys, checked ranges). Defaults in `workers/supplier-sync/src/schema.js` DEFAULT_SETTINGS.
- **Payment reminders / auto-cancel** (sync Worker, every 2h): one email per unpaid order after `reminder_hours`; optional cancel after `auto_cancel_days` (only after a reminder when reminders are on) via spbc-orders PATCH. Bookkeeping in `order_reminders`. Needs ORDERS_ADMIN_TOKEN secret + ORDERS_PUBLIC_URL var on the Worker, plus email.
- **Morning digest** (cron `0 13 * * *`): paid orders not marked placed at show-me-source, held prices, new products, failed sync → `digest_to`.
- **Profit view** (Sales & Profit → "Work it out", `/api/admin/profit`): supplier cost = price − $25 vial / − $200 kit; shipping kept = collected − `sms_ship_cost` per order. Dedupes orders by number.
- **Repeat-buyer free shipping**: `place-order` sets shipping 0 when the email has ≥ `free_ship_after` paid/shipped/complete SPBC orders (lookup errors = normal shipping). Response `perk: 'free_shipping'`; confirmation shows a thank-you.
- **Price-drop alerts**: "Tell me if the price drops" on cards when `price_alerts_on`; `/api/price-watch` → `price_watch`; the sync emails followers when it applies a lower price. (A held price applied by hand in the admin does not trigger it.)
- All email goes through `workers/supplier-sync/src/email.js` (Resend; RESEND_API_KEY + RESTOCK_FROM).
- A Worker main module may export only handlers/functions: exporting a string constant broke startup (caught in local test).

### 2026-11-23 — Profit from real money
- Money in per order = `paid_amount_cents` that spbc-orders recorded from the payment receipt (Venmo/Chime/PayPal mail forwarded to receipts@springfieldpbc.com), else the order total.
- Money out = `supplier_orders.sms_cost`, typed by Remy in "Place at show-me-source" (what show-me-source charged, incl. their shipping), else the estimate (price - $25/vial, - $200/kit, + `sms_ship_cost`).
- Profit view says how many orders used real numbers on each side.

### 2026-11-23 — supplier@springfieldpbc.com mailbox
- Email handler on spbc-supplier-sync saves mail to `supplier_mail`. Remy can use supplier@springfieldpbc.com as the email on his show-me-source orders so receipts/shipping notices arrive directly.
- Trust: envelope sender in ALLOWED_FORWARDERS (secret), or From domain in TRUSTED_SENDER_DOMAINS (show-me-source.com) with DKIM/SPF pass in Authentication-Results. Untrusted mail is kept (capped 100/day) but ignored by matching. Optional COPY_TO forwards trusted direct mail to a verified Outlook address.
- Payment notices keep going Outlook -> receipts@springfieldpbc.com (spbc-receipts, built by another session).
