# SPBC Design System — locked

Single source of truth for every public page. **If a page needs a style, it goes here — never in a page-local `<style>` block.**

Why this file exists: the site drifted because the header/hero/footer markup was hand-duplicated in four HTML files and ~23.5k characters of per-page inline CSS could contradict the shared stylesheet. Consistency is now structural: shell markup comes from partials, all styling comes from here.

## Non-negotiables (each one is a past outage or a shipped bug)

1. Content visibility must NEVER depend on an animation. `.reveal` hides only under `html.spbc-anim`, which JS adds only when it can guarantee a reveal. Never animate product/stack card opacity.
2. The 21+ gate sets the `spbc_member` cookie unconditionally on load. The price fetch is NOT gated behind gate acceptance.
3. `/api/products` is fetched exactly once per page load.
4. Product names are the join key to franchisee `product_links`. **Renaming a product orphans its link.** Never rename.
5. No page-local `<style>` blocks. No inline `style=` for anything themeable.
6. Vial quantity 0–10; kit quantity {0,1,2,3,5}. Anything written to the cart draft must clamp to these.
7. Cart is `localStorage['spbc_cart_draft']` = `{"<NAME>":{"vial":N,"pack":N}}`. Writers MERGE, never overwrite.
8. Research-use-only framing everywhere. No medical/therapeutic/disease claims. No invented metrics, ratings, testimonials or counts.
9. No production secrets are ever read, written, or modified by tooling.

## Tokens

Defined once in `shared/site-atmosphere.css` `:root`. Every colour, font, space, radius, duration in any stylesheet MUST reference a token — no raw hex, no one-off rgb().

| Role | Token | Value |
|---|---|---|
| Page background | `--bg` | `#0B120E` |
| Surface | `--surface` | `#131C16` |
| Brand green | `--brand` | `#16A34A` |
| Deep green | `--brand-deep` | `#006600` |
| Accent gold | `--accent-gold` | `#EAB308` |
| Legacy gold (brand mark only) | `--spbc-gold-legacy` | `#FDD700` |
| Text | `--text` | `#F2F7F3` |
| Muted text | `--text-muted` | `#A8B8AC` |
| Border | `--border` | `#263A2C` |
| Danger | `--destructive` | `#DC2626` |
| Glass fill | `--spbc-glass` | `rgba(19,28,22,0.78)` |
| Glass border | `--spbc-glass-border` | `rgba(234,179,8,0.22)` |

Radii: `--spbc-radius` 1rem · `-lg` 1.25rem · `-xl` 1.5rem. Shadows: `--spbc-shadow-layer` (resting), `--spbc-shadow-lift` (hover).

Motion: `--spbc-t-micro` 200ms ease-out · `--spbc-t-macro` 320ms cubic-bezier(0.22,1,0.36,1).

Z-scale: atmosphere 0 · content 1 · header 50 · sticky 60 · gate 100 · modal 110. Never invent a z-index.

**Gold discipline:** gold marks interaction and emphasis only — active nav, primary CTA, focus rings, key numbers, card borders. Never body copy.

## Typography

- Display: `Bebas Neue` via `.ducks-font` (uppercase, letter-spacing .02em). Roman only — **never italic headings.**
- Body: `Inter` 400/600/700.
- One `<h1>` per page. Hero title: `clamp(2rem, 5.5vw, 3.5rem)`.
- Body floor is 16px (`body.atmosphere p` etc.). **Any smaller-than-body element must out-specify that rule** — e.g. `body.atmosphere p.page-hero-eyebrow`. A bare class will silently lose and render at 16px.

## The shell (identical on every page, from partials)

Order is fixed: skip-link → header → hero → `main` → footer.

**Header** — sticky, `z-index: 50`, gold bottom rule. Brand mark left, nav right. Nav tabs, in order: Home · Calculator · Stacks · Coaching · Contact.
Active tab styling lives **on the link itself** (`.nav-link.active`): gold gradient background, black text, 999px radius. There is no separate absolutely-positioned pill — it desynced from the page and contributed to horizontal overflow.
Nav must never cause horizontal scroll: `scrollWidth === innerWidth` at 320/375/414.

**Hero** — every page carries the SAME blocks in this order, no exceptions:
`.page-hero-eyebrow` → `h1.page-hero-title.ducks-font` → `.page-hero-sub` → `.page-hero-cta` (exactly 2 buttons: one `.btn-primary`, one `.btn-secondary`) → `.trust-badges` (the same 3 badges, identical copy) → ambient video layer (poster-first).
Uniform height via `min-height: var(--spbc-hero-min)` + `box-sizing: border-box`, content vertically centred. Never a fixed `height`; never a per-page height.

**Footer** — glass surface, gold hairline top, research-only disclaimer. Identical everywhere.

## Components

One spec each; used everywhere including admin.

- **`.depth-card`** — glass fill, `--spbc-glass-border`, `--spbc-radius-lg`, `--spbc-shadow-layer`; hover (fine pointer only) lifts 4px to `--spbc-shadow-lift`. Prices, stacks, calculator panels, coaching pillars all use it.
- **Buttons** — `.btn-primary` (gold, black text) · `.btn-secondary` (outline) · `.btn-ghost`. Min height 44px. Every button ships all **8 states**: default, hover, `:focus-visible`, `:active`, disabled, loading, error, success.
- **Flat panels** — order form, booking form, age gate: solid surface, NO blur, NO tilt, full contrast. Conversion surfaces stay calm.
- **Async surfaces** — every one has loading (skeleton), empty, and error states with a retry affordance. Never a dead end.

## Motion budget — exactly 3 primitives

`reveal-rise` (24px rise + fade, once, IntersectionObserver) · `hover-lift` (cards/buttons, fine pointer) · `pulse` (cart quantity change). Nothing else. Animate `transform`/`opacity` only. All motion off under `prefers-reduced-motion`.

Ambient video: poster-first, sources attached after `window.load`, opacity ≤0.32. **No video bytes** under reduced-motion, `saveData`, 2g/slow-2g, or viewport <768px.

## Accessibility floor

Visible `:focus-visible` ring ≥3:1 on every interactive element · body text ≥4.5:1 (raise glass opacity where it fails) · ≥44px touch targets · one `<h1>` per page · icon-only buttons labelled · skip-link first in DOM · form errors via `aria-describedby`, never `alert()` · cart total in a live region.

## Verification rules

- Prove visibility with **computed `opacity`**, never DOM text presence. A DOM-text check once passed while the entire price list was invisible.
- Verify at 320 / 375 / 414 / 768 / 1280, plus reduced-motion and save-data paths.
- Report measured numbers. A missed target is stated, not rounded up.
