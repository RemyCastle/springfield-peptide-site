/**
 * show-me-source (SMS) -> SPBC catalog sync: the pure decision step.
 *
 * Given the supplier feed, the supplier->SPBC map and the current SPBC products,
 * decide what to change. No I/O here, so it can be tested on saved samples.
 *
 * Rules (Remy, 2026-11-23):
 *   SPBC vial = supplier vial + $25, SPBC kit = supplier 10-vial kit + $200,
 *   rounded to the nearest whole dollar (Remy, 2026-11-24; 50 cents rounds up).
 *   Supplier kit = bulk_price x 10 (pricing_mode "block10").
 *   kits_only supplier items are sold as kits only on SPBC.
 * Safety:
 *   - A price that would move more than HOLD_PCT is held for Remy, not applied.
 *   - New supplier products are never listed automatically.
 *   - Out of stock (or missing from the feed) hides the product; it comes back only
 *     if the sync hid it (products Remy hid by hand stay hidden).
 */

export const VIAL_MARKUP = 25;
export const KIT_MARKUP = 200;
export const KIT_SIZE = 10;
export const HOLD_PCT = 0.2;

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Nearest whole dollar, halves up ($37.50 -> $38). round2 first so 37.4999 float noise can't flip it. */
export function wholeDollar(n) {
  return Math.round(round2(n));
}

/** SPBC target prices for one supplier product. */
export function targetPrices(sp) {
  const single = Number(sp && sp.single_price);
  const bulk = Number(sp && sp.bulk_price);
  const kitsOnly = !!(sp && (sp.kits_only === true || sp.kits_only === 1));
  const vial = !kitsOnly && Number.isFinite(single) && single > 0 ? wholeDollar(single + VIAL_MARKUP) : null;
  const kit = Number.isFinite(bulk) && bulk > 0 ? wholeDollar(bulk * KIT_SIZE + KIT_MARKUP) : null;
  return { vial, kit, kitOnly: kitsOnly };
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bigMove(oldV, newV) {
  if (oldV == null || newV == null || oldV <= 0) return false;
  return Math.abs(newV - oldV) / oldV > HOLD_PCT;
}

/**
 * @param {object} input
 * @param {Record<string, object>} input.feed      supplier products by id (prices; may include in_stock)
 * @param {Record<string, object>} input.stock     supplier stock rows by id ({ in_stock })
 * @param {object[]} input.map                     rows of supplier_map
 * @param {object[]} input.products                SPBC products rows
 * @param {object[]} [input.decided]               earlier held/ignored price events ({ spbc_name, vial, kit, status })
 * @returns {{ actions: object[] }}
 */
export function planSync({ feed, stock, map, products, decided = [] }) {
  const actions = [];
  const byName = new Map((products || []).map((p) => [p.name, p]));
  const mapById = new Map((map || []).map((m) => [String(m.supplier_id), m]));
  const decidedKey = new Set(
    (decided || [])
      .filter((d) => d.status === 'ignored' || d.status === 'pending')
      .map((d) => `${d.spbc_name}|${d.vial ?? ''}|${d.kit ?? ''}`)
  );

  // Supplier products we have not decided about yet.
  for (const [id, sp] of Object.entries(feed || {})) {
    if (!mapById.has(String(id))) {
      actions.push({ kind: 'new_product', supplier_id: Number(id), supplier_name: sp.name, target: targetPrices(sp) });
    }
  }

  for (const m of map || []) {
    if (m.skip) continue;
    const row = byName.get(m.spbc_name);
    if (!row) {
      actions.push({ kind: 'missing_spbc_product', supplier_id: m.supplier_id, spbc_name: m.spbc_name });
      continue;
    }
    const sp = (feed || {})[String(m.supplier_id)];
    const st = (stock || {})[String(m.supplier_id)];
    const isActive = row.active === 1 || row.active === true;

    if (!sp) {
      if (isActive) actions.push({ kind: 'hide', reason: 'gone_from_supplier', supplier_id: m.supplier_id, spbc_name: m.spbc_name, product_id: row.id });
      continue;
    }

    const inStock = st ? st.in_stock !== false : sp.in_stock !== false;
    if (!inStock && isActive) {
      actions.push({ kind: 'hide', reason: 'out_of_stock', supplier_id: m.supplier_id, spbc_name: m.spbc_name, product_id: row.id });
    } else if (inStock && !isActive && m.hidden_by_sync) {
      actions.push({ kind: 'show', reason: 'back_in_stock', supplier_id: m.supplier_id, spbc_name: m.spbc_name, product_id: row.id });
    }

    const t = targetPrices(sp);
    const oldVial = num(row.vial_price);
    const oldKit = num(row.pack_price);
    const oldKitOnly = row.kit_only === 1 || row.kit_only === true;
    const same = oldVial === t.vial && oldKit === t.kit && oldKitOnly === t.kitOnly;
    if (same || t.kit == null) continue;

    const change = {
      supplier_id: m.supplier_id,
      spbc_name: m.spbc_name,
      product_id: row.id,
      from: { vial: oldVial, kit: oldKit, kitOnly: oldKitOnly },
      to: t,
      supplier: { single_price: sp.single_price, bulk_price: sp.bulk_price },
    };
    if (bigMove(oldVial, t.vial) || bigMove(oldKit, t.kit) || oldKitOnly !== t.kitOnly) {
      if (!decidedKey.has(`${m.spbc_name}|${t.vial ?? ''}|${t.kit ?? ''}`)) actions.push({ kind: 'hold_price', ...change });
    } else {
      actions.push({ kind: 'price', ...change });
    }
  }
  return { actions };
}

/** Refuse to act on a feed that does not look like Remy's preferred-pricing catalog. */
export function feedProblem({ tier, feed, map }) {
  if (tier !== 'preferred') return `pricing tier is "${tier || 'none'}", expected "preferred" (pricing code not applied)`;
  const mapped = (map || []).filter((m) => !m.skip);
  const present = mapped.filter((m) => (feed || {})[String(m.supplier_id)]).length;
  if (mapped.length && present < mapped.length / 2) {
    return `only ${present} of ${mapped.length} mapped products in the feed`;
  }
  return null;
}
