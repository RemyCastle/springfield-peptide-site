/**
 * Pay show-me-source in stablecoins on Solana (USDC / USDT / PYUSD), from Remy's own wallet.
 *
 * RECEIVE-SIDE ONLY here: this code never holds a key and cannot move money. It builds a
 * Solana Pay link (recipient, exact amount, token, a random "reference") that Remy opens in
 * Phantom and approves himself, then reads the blockchain to find that transfer and keep its
 * transaction ID (TXID) for show-me-source's "Paste transaction hash" box.
 *
 * show-me-source says to pay "the wallet shown on your order", so the wallet is entered per
 * payment (pre-filled with DEFAULT_SMS_WALLET) and Remy checks it against their payment screen.
 * Same mints as spbc-orders src/services/solanaPay.ts (checked on-chain 2026-11-25, 6 decimals).
 */
export const TOKENS = {
  usdc: { label: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  usdt: { label: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
  pyusd: { label: 'PYUSD', mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo' },
};
/** The show-me-source Solana wallet Remy gave on 2026-11-25 (their site: "the address shown on your order"). */
export const DEFAULT_SMS_WALLET = 'BN8MBPbnnhLPX4843q4qVcm7JqiKXVyfzjHnS7RUDL5s';
export const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

/** 32-byte base58 public key (rejects typos that change the length/alphabet). */
export function isSolanaAddress(v) {
  const s = String(v || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  let len = 0;
  while (n > 0n) {
    n >>= 8n;
    len += 1;
  }
  for (const c of s) {
    if (c !== '1') break;
    len += 1;
  }
  return len === 32;
}

export const isSignature = (v) => /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(String(v || ''));
export const centsToUnits = (cents) => BigInt(Math.round(cents)) * 10000n; // 6 decimals

export function solanaPayUrl({ recipient, amountCents, token, reference, orderNumber }) {
  const q = new URLSearchParams({
    amount: (amountCents / 100).toFixed(2),
    'spl-token': TOKENS[token].mint,
    reference,
    label: 'Show Me Source',
    message: `SPBC order ${orderNumber}`,
  });
  return `solana:${recipient}?${q.toString()}`;
}

export function newReference() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return base58(b);
}

export function rpcClient(url) {
  return async (method, params) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`solana rpc ${method}: ${(data.error && data.error.message) || res.status}`);
    return data.result;
  };
}

/** Units of `mint` that `owner` gained in this (successful) transaction. */
export function receivedUnits(tx, owner, mint) {
  const meta = tx && tx.meta;
  if (!meta || meta.err) return 0n;
  const sum = (list) => {
    const m = new Map();
    for (const b of list || []) if (b.owner === owner && b.mint === mint) m.set(b.accountIndex, BigInt((b.uiTokenAmount && b.uiTokenAmount.amount) || '0'));
    return m;
  };
  const pre = sum(meta.preTokenBalances);
  let gained = 0n;
  for (const [i, after] of sum(meta.postTokenBalances)) gained += after - (pre.get(i) || 0n);
  return gained > 0n ? gained : 0n;
}

const getTx = (rpc, sig) => rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);

/** Find the payment that carries this reference (newest first). */
export async function findByReference(rpc, row) {
  const sigs = (await rpc('getSignaturesForAddress', [row.reference, { limit: 20, commitment: 'confirmed' }])) || [];
  const need = centsToUnits(row.amount_cents);
  let best = null;
  for (const s of sigs) {
    if (s.err) continue;
    const units = receivedUnits(await getTx(rpc, s.signature), row.recipient, TOKENS[row.token].mint);
    if (units >= need) return { paid: true, signature: s.signature, units };
    if (units > 0n && (!best || units > best.units)) best = { signature: s.signature, units };
  }
  return best ? { paid: false, short: true, ...best } : { paid: false };
}

/** Check a TXID Remy pasted: it must pay the recipient at least the amount, in that token. */
export async function verifySignature(rpc, row, signature) {
  const units = receivedUnits(await getTx(rpc, signature), row.recipient, TOKENS[row.token].mint);
  return { paid: units >= centsToUnits(row.amount_cents), units };
}
