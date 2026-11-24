// Local stand-in for show-me-source, for testing the sync Worker end to end.
// Usage: node test/stub-sms.mjs [port] [fixture.json]
// Accepts any site key / pricing code; set STUB_TIER=normal to test the guard.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8795);
const fxPath = process.argv[3] || path.join(here, 'sms-fixture-2026-11-23.json');

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8')); // re-read so tests can edit it between runs
      const authed = /sms_session=ok/.test(req.headers.cookie || '');
      const send = (code, obj, extra = {}) => {
        res.writeHead(code, { 'Content-Type': 'application/json', ...extra });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'POST' && req.url === '/') {
        return send(302, {}, { 'Set-Cookie': 'sms_session=ok; Path=/; HttpOnly', Location: '/' });
      }
      // Stand-in for the Resend email API (RESEND_API_URL in tests).
      if (req.method === 'POST' && req.url === '/emails') {
        fs.appendFileSync(process.env.STUB_EMAIL_LOG || path.join(os.tmpdir(), 'spbc-stub-emails.log'), body + '\n');
        return send(200, { id: 'stub-email' });
      }
      // Like the real site's images: public, no site key needed.
      if (req.url.startsWith('/coas/')) {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        return res.end('%PDF-1.4 stub lab report');
      }
      if (!authed) return send(403, { success: false, error: 'Site access required' });
      if (req.url.startsWith('/inventory.php?stock=1')) return send(200, { success: true, products: fx.stock });
      if (req.method === 'GET' && /^\/inventory\.php\?_=/.test(req.url)) {
        return send(200, { success: true, products: fx.details || {} });
      }
      if (req.method === 'POST' && req.url.startsWith('/inventory.php')) {
        const unlocked = {};
        const products = {};
        for (const [id, p] of Object.entries(fx.feed)) (p.kits_only ? unlocked : products)[id] = p;
        return send(200, { success: true, pricing_tier: process.env.STUB_TIER || fx.tier, products, unlocked_products: unlocked });
      }
      send(404, { success: false, error: 'not found' });
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`stub show-me-source on :${port}`));
