/**
 * Re-price storefront order lines from the D1 catalog.
 * Client qty/name/sku choose the line; client unit_price_cents is ignored.
 * No vial minimum. True kit_only products (HGH, no vial_price) cannot be
 * ordered as vials. Vial-only rows (RETA 66MG: kit_only + vial===pack, or
 * pack_price 0) are sold as singles and priced from vial_price.
 */

export function dollarsToCents(d) {
  return Math.round(Number(d) * 100);
}

export function isBacName(name) {
  return /bac\s*water/i.test(String(name || ''));
}

export function skuFrom(name, kind) {
  const base = String(name)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
  return `${base}-${kind === 'vial' ? 'VIAL' : 'KIT'}`.slice(0, 64);
}

export function stripLineSuffix(itemName) {
  return String(itemName || '')
    .replace(/\s+\((?:10-Pack \/ Kit|Kit|Vial)\)\s*$/i, '')
    .trim();
}

export function lineKind(item) {
  const name = String((item && item.name) || '');
  const sku = String((item && item.sku) || '').toUpperCase();
  if (/\(\s*Vial\s*\)\s*$/i.test(name) || /(?:^|-)VIAL$/.test(sku)) return 'vial';
  return 'kit';
}

export function isKitOnly(row) {
  return !!(row && (row.kit_only === true || row.kit_only === 1 || row.kit_only === '1'));
}

/** Sold as singles: no pack, or kit_only dummy pack equal to vial (RETA 66MG). */
export function isVialOnlyListing(row) {
  const vial = Number(row && row.vial_price);
  const pack = Number(row && row.pack_price);
  if (!Number.isFinite(vial) || vial <= 0) return false;
  if (!Number.isFinite(pack) || pack <= 0) return true;
  return isKitOnly(row) && vial === pack;
}

export function vialCents(row) {
  const n = Number(row && row.vial_price);
  if (!Number.isFinite(n) || n <= 0) return null;
  return dollarsToCents(n);
}

export function packCents(row) {
  const n = Number(row && row.pack_price);
  if (!Number.isFinite(n) || n <= 0) return null;
  return dollarsToCents(n);
}

export function resolveBacRow(rows) {
  const bac = (rows || []).filter((r) => isBacName(r.name) && r.active !== 0);
  const prefer = ['BAC WATER 2.5ML', 'BAC WATER 3ML', 'BAC WATER 10 ML'];
  for (const name of prefer) {
    const hit = bac.find((r) => r.name === name);
    if (hit) return hit;
  }
  return bac[0] || null;
}

/**
 * @param {object[]} items
 * @param {object[]} catalog
 * @returns {{ ok: true, items: object[], peptideKits: number, bacKits: number } | { ok: false, status: number, error: string, message: string, item?: object }}
 */
export function normalizeOrderItems(items, catalog) {
  const byName = new Map((catalog || []).map((r) => [r.name, r]));
  const normalizedItems = [];
  let peptideKits = 0;
  let bacKits = 0;

  for (const it of items || []) {
    const itemName = String(it.name || '').trim().slice(0, 200);
    const qty = parseInt(it.qty, 10);
    const productName = stripLineSuffix(itemName);
    if (!productName || !Number.isFinite(qty) || qty < 1) {
      return {
        ok: false,
        status: 400,
        error: 'validation_failed',
        message: 'invalid item line',
        item: it,
      };
    }
    const row = byName.get(productName);
    if (!row) {
      return {
        ok: false,
        status: 400,
        error: 'validation_failed',
        message: `Unknown product: ${productName}`,
      };
    }

    const kind = lineKind(it);
    if (kind === 'vial') {
      const unit = vialCents(row);
      if (unit == null) {
        return {
          ok: false,
          status: 400,
          error: 'validation_failed',
          message: isKitOnly(row)
            ? `${productName} is kit-only and cannot be ordered as a vial`
            : `No catalog vial price for ${productName}`,
        };
      }
      normalizedItems.push({
        sku: skuFrom(row.name, 'vial'),
        name: `${row.name} (Vial)`,
        qty,
        unit_price_cents: unit,
      });
      continue;
    }

    if (isVialOnlyListing(row) || packCents(row) == null) {
      return {
        ok: false,
        status: 400,
        error: 'validation_failed',
        message: isVialOnlyListing(row)
          ? `${productName} is sold as a single vial, not a 10-pack`
          : `No catalog kit price for ${productName}`,
      };
    }
    const unit = packCents(row);
    const kitLabel = isKitOnly(row) && !isVialOnlyListing(row) ? 'Kit' : '10-Pack / Kit';
    normalizedItems.push({
      sku: skuFrom(row.name, 'kit'),
      name: `${row.name} (${kitLabel})`,
      qty,
      unit_price_cents: unit,
    });
    if (isBacName(row.name)) bacKits += qty;
    else peptideKits += qty;
  }

  return { ok: true, items: normalizedItems, peptideKits, bacKits };
}

export function applyAutoBac(normalizedItems, catalog, peptideKits, bacKits) {
  const bacRow = resolveBacRow(catalog);
  const bacNeed = Math.max(0, peptideKits - bacKits);
  if (bacNeed > 0 && bacRow) {
    const unit = packCents(bacRow);
    if (unit != null) {
      normalizedItems.push({
        sku: skuFrom(bacRow.name, 'kit'),
        name: `${bacRow.name} (Kit)`,
        qty: bacNeed,
        unit_price_cents: unit,
      });
    }
  }
  return normalizedItems;
}
