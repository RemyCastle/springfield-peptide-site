/**
 * Partner wholesale price list (e.g. Patriotic). Built from the live supplier feed,
 * but the output never contains supplier prices, supplier ids or SPBC prices:
 * only the SPBC product name and the partner's price.
 *
 *   partner vial = supplier single + PARTNER_VIAL_MARKUP (default $15)
 *   partner kit  = supplier bulk x 10 + PARTNER_KIT_MARKUP (default $100)
 */
import { KIT_SIZE, round2 } from './plan.js';

export const DEFAULT_PARTNER_VIAL_MARKUP = 15;
export const DEFAULT_PARTNER_KIT_MARKUP = 100;

const cents = (dollars) => (dollars == null ? null : Math.round(round2(dollars) * 100));

/**
 * @param {{ feed: Record<string, object>, stock: Record<string, object>, map: object[] }} input
 * @param {{ vialMarkup?: number, kitMarkup?: number }} [opts]
 * @returns {{ name: string, vial_cents: number|null, kit_cents: number|null, kit_only: boolean, in_stock: boolean, low_stock: boolean }[]}
 */
export function partnerPriceList({ feed, stock, map }, opts = {}) {
  const vialMarkup = Number.isFinite(opts.vialMarkup) ? opts.vialMarkup : DEFAULT_PARTNER_VIAL_MARKUP;
  const kitMarkup = Number.isFinite(opts.kitMarkup) ? opts.kitMarkup : DEFAULT_PARTNER_KIT_MARKUP;
  const out = [];
  const seen = new Set();
  for (const m of map || []) {
    if (!m || m.skip === 1 || m.skip === true || !m.spbc_name) continue;
    const sp = (feed || {})[String(m.supplier_id)];
    if (!sp) continue;
    const name = String(m.spbc_name).trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const single = Number(sp.single_price);
    const bulk = Number(sp.bulk_price);
    const kitOnly = sp.kits_only === true || sp.kits_only === 1;
    const vial = !kitOnly && Number.isFinite(single) && single > 0 ? single + vialMarkup : null;
    const kit = Number.isFinite(bulk) && bulk > 0 ? bulk * KIT_SIZE + kitMarkup : null;
    if (vial == null && kit == null) continue;
    const st = (stock || {})[String(m.supplier_id)];
    const inStock = st ? st.in_stock !== false : sp.in_stock !== false;
    seen.add(key);
    out.push({
      name,
      vial_cents: cents(vial),
      kit_cents: cents(kit),
      kit_only: kitOnly,
      in_stock: inStock,
      low_stock: m.low_inventory === 1 || m.low_inventory === true,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
