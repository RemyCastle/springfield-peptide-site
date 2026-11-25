/**
 * One link per product: /p/<slug> (e.g. /p/reta-10mg).
 *
 * Serves the normal storefront with this product's title, description and share
 * preview filled in, plus Google product data (no price: prices stay behind the
 * 21+ check). store.js reads <meta name="spbc-open-product"> and scrolls to the card.
 * Unknown slugs go to the home page.
 */
const SITE = 'https://springfieldpbc.com';
const OG_IMAGE = `${SITE}/assets/brand/og-logo.jpg`;

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

class SetContent {
  constructor(value) { this.value = value; }
  element(el) { el.setAttribute('content', this.value); }
}
class SetHref {
  constructor(value) { this.value = value; }
  element(el) { el.setAttribute('href', this.value); }
}
class SetText {
  constructor(value) { this.value = value; }
  element(el) { el.setInnerContent(this.value); }
}
class AppendHead {
  constructor(html) { this.html = html; }
  element(el) { el.append(this.html, { html: true }); }
}

export async function onRequestGet({ request, env, params }) {
  const slug = String(params.slug || '').toLowerCase();
  const home = new URL('/', request.url);
  let name = '';
  try {
    const { results } = await env.DB.prepare('SELECT name FROM products WHERE active = 1').all();
    const hit = (results || []).find((r) => slugify(r.name) === slug);
    if (hit) name = hit.name;
  } catch {
    /* fall through to home */
  }
  if (!name) return Response.redirect(home.toString(), 302);

  const page = await env.ASSETS.fetch(new Request(home.toString(), { headers: request.headers }));
  if (!page.ok) return page;

  const url = `${SITE}/p/${slug}`;
  const title = `${name} | Springfield Peptide Buyers Club`;
  const desc = `${name}: research peptide, single vials or 10-vial kits, shipped with tracking. Research use only.`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    url,
    image: OG_IMAGE,
    description: desc,
    brand: { '@type': 'Brand', name: 'Springfield Peptide Buyers Club' },
  };
  const head =
    `<meta name="spbc-open-product" content="${attr(name)}">` +
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;

  const out = new HTMLRewriter()
    .on('title', new SetText(title))
    .on('meta[name="description"]', new SetContent(desc))
    .on('link[rel="canonical"]', new SetHref(url))
    .on('meta[property="og:url"]', new SetContent(url))
    .on('meta[property="og:title"]', new SetContent(title))
    .on('meta[property="og:description"]', new SetContent(desc))
    .on('meta[name="twitter:title"]', new SetContent(title))
    .on('meta[name="twitter:description"]', new SetContent(desc))
    .on('head', new AppendHead(head))
    .transform(page);
  const headers = new Headers(out.headers);
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(out.body, { status: 200, headers });
}
