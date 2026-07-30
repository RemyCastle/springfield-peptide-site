# Decisions - springfield-peptide-site

Append-only log. Newest at bottom.

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
