/** Decode the QR out of each rendered flyer PNG using Chromium + jsQR.
 *  Proves the printed code is actually scannable, not just present. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const dir = path.join(os.homedir(), 'Desktop', 'SPBC-Gym-Flyers');
const jsqrSrc = fs.readFileSync('C:/Users/Remy/spbc-orders/node_modules/jsqr/dist/jsQR.js', 'utf8');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addScriptTag({ content: jsqrSrc });
let pass = 0;
for (const f of files) {
  const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
  const res = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const fn = window.jsQR || window.jsqr;
    const r = fn(d.data, c.width, c.height);
    return r ? r.data : null;
  }, b64);
  if (res) pass++;
  console.log(f.padEnd(34), res ? 'QR OK -> ' + res : 'QR NOT DECODED');
}
await browser.close();
console.log(`\n${pass}/${files.length} flyers have a decodable QR`);
if (pass !== files.length) process.exit(1);
