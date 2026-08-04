/** Crop-based QR check: a phone scans ONE code up close, so decode regions, not the whole sheet. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
const dir = path.join(os.homedir(), 'Desktop', 'SPBC-Gym-Flyers');
const jsqrSrc = fs.readFileSync('C:/Users/Remy/spbc-orders/node_modules/jsqr/dist/jsQR.js', 'utf8');
const targets = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.addScriptTag({ content: jsqrSrc });
for (const f of targets) {
  const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
  const found = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const fn = window.jsQR || window.jsqr;
    const out = [];
    // sweep a grid of overlapping crops; report every distinct decode + its size
    const step = 300, win = 700;
    for (let y = 0; y + 200 < img.naturalHeight; y += step) {
      for (let x = 0; x + 200 < img.naturalWidth; x += step) {
        const w = Math.min(win, img.naturalWidth - x), h = Math.min(win, img.naturalHeight - y);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h);
        const r = fn(d.data, w, h);
        if (r && !out.some(o => o.data === r.data && Math.abs(o.x - x) < 400 && Math.abs(o.y - y) < 400)) {
          out.push({ data: r.data, x, y });
        }
      }
    }
    return out;
  }, b64);
  console.log(f.padEnd(34), found.length ? `${found.length} code(s) decoded -> ${found[0].data}` : 'NONE decoded even cropped');
}
await browser.close();
