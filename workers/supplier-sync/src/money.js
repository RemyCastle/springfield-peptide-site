/**
 * Money ledger from the emails in supplier_mail:
 *   money in   = Venmo "X paid you $Y" (and Chime/PayPal later)
 *   money out  = show-me-source orders (their emails), other payments Remy sent
 * Pairs each show-me-source order with the customer payments that paid for it, by name
 * (nicknames and small typos allowed) and date, so profit per sale and per month can be shown.
 * Pure functions: no I/O, tested on samples shaped like Remy's real emails.
 */

/* ---------------- text helpers ---------------- */

export function htmlToText(h) {
  return String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#36;/g, '$')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&#\d+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function mailText(row) {
  const t = String(row.text_body || '');
  return t.replace(/\s/g, '').length > 200 ? t : htmlToText(row.html_body);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseMoney(s) {
  const clean = String(s == null ? '' : s).replace(/[$,\s]/g, '');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** "Nov 23, 2026" -> ISO date, else fallback. */
function venmoDate(text, fallback) {
  const m = text.match(/Date\s+([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()] != null) {
    return new Date(Date.UTC(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), 12)).toISOString();
  }
  return fallback || null;
}

/* ---------------- names ---------------- */

const NICK = {
  nate: 'nathan', nat: 'nathan', nathaniel: 'nathan', andy: 'andrew', drew: 'andrew', mike: 'michael', mikey: 'michael',
  matt: 'matthew', chris: 'christopher', tony: 'anthony', joe: 'joseph', joey: 'joseph', jon: 'jonathan',
  jonathon: 'jonathan', johnny: 'john', jim: 'james', jimmy: 'james', bill: 'william', will: 'william',
  billy: 'william', bob: 'robert', rob: 'robert', bobby: 'robert', dan: 'daniel', danny: 'daniel', dave: 'david',
  steve: 'steven', stephen: 'steven', tom: 'thomas', tommy: 'thomas', ben: 'benjamin', sam: 'samuel',
  alex: 'alexander', nick: 'nicholas', kate: 'katherine', katie: 'katherine', katelyn: 'katelyn', liz: 'elizabeth',
  beth: 'elizabeth', jen: 'jennifer', jenny: 'jennifer', jess: 'jessica', ashleigh: 'ashley', brad: 'bradley',
  zach: 'zachary', zack: 'zachary', josh: 'joshua', tim: 'timothy', ty: 'tyler', greg: 'gregory', ken: 'kenneth',
};

export function nameParts(name) {
  const words = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;
  const first = NICK[words[0]] || words[0];
  const last = words.length > 1 ? words[words.length - 1] : '';
  return { first, last };
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/**
 * How well two people's names match: 2 = same person, 1 = probably (initial-only last name,
 * or a one-letter typo), 0 = no.
 */
export function nameScore(a, b) {
  const x = nameParts(a);
  const y = nameParts(b);
  if (!x || !y) return 0;
  // Same family name, different first name (e.g. one pays, another receives): "likely".
  if (x.first !== y.first) return x.last && x.last === y.last && x.last.length >= 4 ? 1 : 0;
  if (!x.last || !y.last) return 1;
  if (x.last === y.last) return 2;
  if (x.last.length === 1 || y.last.length === 1) return x.last[0] === y.last[0] ? 1 : 0;
  if (x.last.length >= 5 && y.last.length >= 5 && editDistance(x.last, y.last) <= 1) return 2;
  return 0;
}

/* ---------------- email parsers ---------------- */

/**
 * One email -> one money event, or null.
 *   { type: 'in',  source: 'venmo', name, amount, fee, note, date, txn }
 *   { type: 'out', source: 'venmo', name, amount, note, date, txn }
 *   { type: 'sms', sms, stage: 'invoice'|'paid'|'tracking'|'received'|'update', name, amount, items, ship_to, carrier, tracking, date }
 */
export function parseMoneyMail(row) {
  const subject = String(row.subject || '').replace(/^(fw|fwd|re):\s*/i, '');
  const text = mailText(row);
  const sent = row.sent_at || row.received_at || null;

  const sms = subject.match(/SMS-\d+/i);
  if (sms && /show-me-source|show me source/i.test(`${row.from_addr} ${subject} ${text}`)) {
    const stage = /payment required/i.test(subject)
      ? 'invoice'
      : /payment confirmed/i.test(subject)
        ? 'paid'
        : /tracking created/i.test(subject)
          ? 'tracking'
          : /order received/i.test(subject)
            ? 'received'
            : 'update';
    const amount =
      parseMoney((text.match(/Total paid:\s*\$?\s*([\d,.]+)/i) || [])[1]) ??
      parseMoney((text.match(/Amount received:\s*\$?\s*([\d,.]+)/i) || [])[1]) ??
      parseMoney((text.match(/Exact amount:\s*\$?\s*([\d,.]+)/i) || [])[1]) ??
      parseMoney((text.match(/Total:\s*\$\s*([\d,.]+)/i) || [])[1]);
    return {
      type: 'sms',
      sms: sms[0].toUpperCase(),
      stage,
      name: ((text.match(/Hi\s+([^,\n]+?)\s*,/) || [])[1] || '').trim(),
      amount,
      items: ((text.match(/Items:\s*([^\n]+)/i) || [])[1] || '').trim(),
      ship_to: ((text.match(/Shipping to:\s*([^\n]+)/i) || [])[1] || '').trim(),
      carrier: ((text.match(/Carrier:\s*([^\n]+)/i) || [])[1] || '').trim(),
      tracking: ((text.match(/Tracking number:\s*([A-Z0-9]+)/i) || [])[1] || '').trim(),
      date: sent,
    };
  }

  // Venmo (also matches the forwarded "Fw:" copies)
  if (/venmo/i.test(`${row.from_addr} ${text}`)) {
    const txn = ((text.match(/Transaction ID\s+([A-Z0-9]+)/i) || [])[1] || '').trim();
    const date = venmoDate(text, sent);
    let m = subject.match(/^(.+?) paid (?:you )?\$([\d,]+\.\d\d)/i);
    if (m && !/^you$/i.test(m[1].trim())) {
      const fee = parseMoney((text.match(/charged a \$([\d,.]+) fee/i) || [])[1]) || 0;
      return { type: 'in', source: 'venmo', name: m[1].trim(), amount: parseMoney(m[2]), fee, note: venmoNote(text), date, txn };
    }
    m = subject.match(/^You paid (.+?) \$([\d,]+\.\d\d)/i);
    if (m) return { type: 'out', source: 'venmo', name: m[1].trim(), amount: parseMoney(m[2]), note: venmoNote(text), date, txn };
    m = subject.match(/^Receipt from (.+?) - \$([\d,]+\.\d\d)/i);
    if (m) return { type: 'out', source: 'venmo', name: m[1].trim(), amount: parseMoney(m[2]), note: 'purchase', date, txn };
  }
  return null;
}

/** The payment note sits right after the big "$ / 255 / . 00" amount block (split over lines). */
function venmoNote(text) {
  const m = text.match(/\$\s*\n\s*[\d,]+\s*\n\s*\.\s*\n?\s*\d\d\s*\n+\s*([^\n]{1,80}?)\s*\n/);
  if (!m) return '';
  const note = m[1].trim();
  return /^(see transaction|money credited|\[)/i.test(note) ? '' : note;
}

/* ---------------- ledger ---------------- */

/** Merge the 2-4 emails of one show-me-source order into one order. Invoices never paid are dropped. */
export function smsOrders(events) {
  const by = new Map();
  for (const e of events.filter((x) => x && x.type === 'sms')) {
    const o = by.get(e.sms) || { sms: e.sms, stages: [], name: '', cost: null, invoice: null, items: '', ship_to: '', carrier: '', tracking: '', date: null };
    o.stages.push(e.stage);
    if (e.name && !o.name) o.name = e.name;
    if ((e.stage === 'paid' || e.stage === 'tracking') && e.amount != null) o.cost = e.amount;
    if (e.stage === 'invoice' && e.amount != null) o.invoice = e.amount;
    if (e.items) o.items = e.items;
    if (e.ship_to) o.ship_to = e.ship_to;
    if (e.carrier) o.carrier = e.carrier;
    if (e.tracking) o.tracking = e.tracking;
    if (e.date && (!o.date || e.date < o.date)) o.date = e.date;
    by.set(e.sms, o);
  }
  const out = [];
  for (const o of by.values()) {
    const confirmed = o.stages.some((s) => s === 'paid' || s === 'tracking');
    if (!confirmed) continue; // only a bill, or older-format notices without a confirmed total
    out.push(o);
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

const DAY = 86400000;

/**
 * Pair payments with show-me-source orders.
 * For each supplier order (oldest first), take unused payments from the same customer made
 * from 21 days before to 5 days after it. A "You paid <someone> $X" that equals an order's
 * cost within 3 days is that order's payment to the supplier (not an extra cost).
 * `links` (manual decisions) can force a payment onto an order or mark it 'not_sale'.
 */
export function buildLedger(events, { links = [] } = {}) {
  const ins = events.filter((e) => e && e.type === 'in').map((e, i) => ({ ...e, key: e.txn || `in${i}` }));
  const outs = events.filter((e) => e && e.type === 'out').map((e, i) => ({ ...e, key: e.txn || `out${i}` }));
  const orders = smsOrders(events);
  const forced = new Map(links.filter((l) => l.sms).map((l) => [l.payment_key, l.sms]));
  const notSale = new Set(links.filter((l) => l.tag === 'not_sale').map((l) => l.payment_key));
  const used = new Set();
  const t = (d) => Date.parse(d || '') || 0;

  // Each payment goes to the nearest supplier order of the same customer (within 21 days),
  // so a customer who pays in lumps is spread over their orders instead of the first one.
  const assigned = new Map(); // sms -> payments
  for (const p of ins) {
    if (notSale.has(p.key)) continue;
    let target = forced.get(p.key) || null;
    if (!target) {
      let best = null;
      for (const o of orders) {
        const score = nameScore(p.name, o.name);
        const gap = Math.abs(t(p.date) - t(o.date));
        if (score < 1 || gap > 21 * DAY) continue;
        if (!best || score > best.score || (score === best.score && gap < best.gap)) best = { sms: o.sms, score, gap };
      }
      target = best && best.sms;
    }
    if (!target) continue;
    if (!assigned.has(target)) assigned.set(target, []);
    assigned.get(target).push(p);
  }

  const sales = orders.map((o) => {
    const when = t(o.date);
    const pays = assigned.get(o.sms) || [];
    pays.forEach((p) => used.add(p.key));
    const supplierPay = outs.find(
      (x) => !x.matched && Math.abs((x.amount || 0) - (o.cost || -1)) < 0.01 && Math.abs(t(x.date) - when) <= 3 * DAY
    );
    if (supplierPay) supplierPay.matched = o.sms;
    const moneyIn = pays.reduce((s, p) => s + (p.amount || 0), 0);
    const fees = pays.reduce((s, p) => s + (p.fee || 0), 0);
    const strong = pays.some((p) => nameScore(p.name, o.name) === 2);
    return {
      sms: o.sms,
      date: o.date,
      customer: o.name,
      items: o.items,
      ship_to: o.ship_to,
      carrier: o.carrier,
      tracking: o.tracking,
      cost: o.cost,
      paid_supplier_via: supplierPay ? `Venmo to ${supplierPay.name}` : 'crypto',
      payments: pays.map((p) => ({ key: p.key, name: p.name, amount: p.amount, fee: p.fee || 0, date: p.date, note: p.note })),
      money_in: round(moneyIn),
      fees: round(fees),
      profit: pays.length ? round(moneyIn - fees - (o.cost || 0)) : null,
      match: pays.length ? (strong ? 'name' : 'likely') : 'no_payment',
    };
  });

  const unmatchedIn = ins
    .filter((p) => !used.has(p.key) && !notSale.has(p.key))
    .map((p) => ({ key: p.key, name: p.name, amount: p.amount, fee: p.fee || 0, date: p.date, note: p.note }));
  const otherOut = outs.filter((x) => !x.matched).map((x) => ({ key: x.key, name: x.name, amount: x.amount, date: x.date, note: x.note }));

  const paired = sales.filter((s) => s.payments.length);
  const totals = {
    sales: paired.length,
    money_in: round(paired.reduce((s, x) => s + x.money_in, 0)),
    fees: round(paired.reduce((s, x) => s + x.fees, 0)),
    supplier_cost: round(paired.reduce((s, x) => s + (x.cost || 0), 0)),
    profit: round(paired.reduce((s, x) => s + (x.profit || 0), 0)),
    unpaired_orders: sales.length - paired.length,
    unpaired_payments: unmatchedIn.length,
    unpaired_payments_total: round(unmatchedIn.reduce((s, p) => s + (p.amount || 0), 0)),
  };
  const months = new Map();
  for (const s of paired) {
    const k = String(s.date || '').slice(0, 7) || 'unknown';
    const m = months.get(k) || { month: k, sales: 0, money_in: 0, supplier_cost: 0, profit: 0 };
    m.sales += 1;
    m.money_in = round(m.money_in + s.money_in - s.fees);
    m.supplier_cost = round(m.supplier_cost + (s.cost || 0));
    m.profit = round(m.profit + (s.profit || 0));
    months.set(k, m);
  }
  return {
    totals,
    customers: customerSummary(ins.filter((p) => !notSale.has(p.key)), orders, forced),
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    sales: sales.reverse(),
    unmatched_in: unmatchedIn.reverse(),
    other_out: otherOut.reverse(),
  };
}

/**
 * Per customer: everything they paid vs every show-me-source order shipped to them.
 * Handles customers who pay in lumps or later (resellers). Names are grouped when they
 * match (nicknames/typos/same family name count).
 */
export function customerSummary(ins, orders, forced = new Map()) {
  const groups = [];
  const place = (name, fn) => {
    let g = groups.find((x) => x.names.some((n) => nameScore(n, name) >= 1));
    if (!g) {
      g = { names: [], money_in: 0, fees: 0, payments: 0, supplier_cost: 0, orders: 0, last: '' };
      groups.push(g);
    }
    if (!g.names.includes(name)) g.names.push(name);
    fn(g);
  };
  const orderName = new Map(orders.map((o) => [o.sms, o.name]));
  for (const p of ins) {
    // A payment Remy linked to an order counts for that order's customer.
    place(orderName.get(forced.get(p.key)) || p.name, (g) => {
      g.money_in += p.amount || 0;
      g.fees += p.fee || 0;
      g.payments += 1;
      if (String(p.date) > g.last) g.last = String(p.date);
    });
  }
  for (const o of orders) {
    place(o.name, (g) => {
      g.supplier_cost += o.cost || 0;
      g.orders += 1;
      if (String(o.date) > g.last) g.last = String(o.date);
    });
  }
  return groups
    .map((g) => ({
      customer: g.names.join(' / '),
      payments: g.payments,
      money_in: round(g.money_in - g.fees),
      orders: g.orders,
      supplier_cost: round(g.supplier_cost),
      profit: round(g.money_in - g.fees - g.supplier_cost),
      complete: g.payments > 0 && g.orders > 0,
      last: g.last,
    }))
    .sort((a, b) => b.last.localeCompare(a.last));
}

function round(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
