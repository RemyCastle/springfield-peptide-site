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
