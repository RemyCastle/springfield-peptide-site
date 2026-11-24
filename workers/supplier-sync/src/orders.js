/**
 * Read/act on SPBC orders through the spbc-orders admin API (same API the SPBC admin uses).
 * Needs ORDERS_ADMIN_TOKEN (secret, same value as the Pages secret) and ORDERS_PUBLIC_URL.
 */
export function ordersReady(env) {
  return !!(env.ORDERS_ADMIN_TOKEN && env.ORDERS_PUBLIC_URL);
}

function base(env) {
  return String(env.ORDERS_PUBLIC_URL).replace(/\/$/, '');
}

export async function ordersApi(env, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base(env)}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${env.ORDERS_ADMIN_TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`orders ${method} ${path}: HTTP ${res.status} ${data.error || ''}`.trim());
  return data;
}

/** All SPBC (non-partner) orders with one status, newest first, up to `max`. */
export async function listOrders(env, { status, q, max = 300 } = {}) {
  const out = [];
  for (let page = 1; out.length < max && page <= 10; page++) {
    const qs = new URLSearchParams({ exclude_partner_retail: '1', limit: '100', page: String(page) });
    if (status) qs.set('status', status);
    if (q) qs.set('q', q);
    const d = await ordersApi(env, `/admin/orders?${qs}`);
    const rows = (d.orders || []).filter((o) => !o.partner_slug && (!status || o.status === status));
    out.push(...rows);
    if (!d.total_pages || page >= d.total_pages) break;
  }
  return out.slice(0, max);
}

export function payUrl(env, orderNumber) {
  return `${base(env)}/pay/${encodeURIComponent(orderNumber)}`;
}
