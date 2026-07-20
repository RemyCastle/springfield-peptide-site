/**
 * Proxy helpers for SPBC Orders Worker admin API.
 *
 * Env (Pages secrets / vars):
 *   ORDERS_ADMIN_TOKEN  — same value as ADMIN_TOKEN on spbc-orders
 *   ORDERS_PUBLIC_URL   — optional, default https://spbc-orders.spbc.workers.dev
 */

function ordersBaseUrl(env) {
  return (env.ORDERS_PUBLIC_URL || 'https://spbc-orders.spbc.workers.dev').replace(
    /\/$/,
    ''
  );
}

/**
 * @param {object} env
 * @param {string} path  e.g. "/admin/orders?page=1"
 * @param {{ method?: string, body?: string, contentType?: string }} [opts]
 */
export async function proxyOrdersAdmin(env, path, opts = {}) {
  if (!env.ORDERS_ADMIN_TOKEN) {
    return {
      ok: false,
      status: 500,
      data: {
        error: 'server_misconfigured',
        message:
          'ORDERS_ADMIN_TOKEN not set on Pages (must match ADMIN_TOKEN on spbc-orders)',
      },
    };
  }

  const url = `${ordersBaseUrl(env)}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${env.ORDERS_ADMIN_TOKEN}`,
  };
  if (opts.body != null) {
    headers['Content-Type'] = opts.contentType || 'application/json';
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
    });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      data: {
        error: 'upstream_unreachable',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  let data;
  const text = await upstream.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      error: 'upstream_bad_response',
      status: upstream.status,
      body: text.slice(0, 500),
    };
  }

  return {
    ok: upstream.ok,
    status: upstream.status,
    data,
  };
}
