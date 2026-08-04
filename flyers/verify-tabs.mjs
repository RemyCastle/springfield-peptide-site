import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { chromium } from 'playwright';
const dir = path.join(os.homedir(),'Desktop','SPBC-Gym-Flyers');
const jsqrSrc = fs.readFileSync('C:/Users/Remy/spbc-orders/node_modules/jsqr/dist/jsQR.js','utf8');
const b64 = fs.readFileSync(path.join(dir,'05-tear-tabs-light.png')).toString('base64');
const browser = await chromium.launch(); const page = await browser.newPage();
await page.addScriptTag({ content: jsqrSrc });
const r = await page.evaluate(async (b64) => {
  const img = new Image(); img.src='data:image/png;base64,'+b64; await img.decode();
  const fn = window.jsQR||window.jsqr;
  const H = img.naturalHeight, W = img.naturalWidth;
  const stripTop = Math.round(H - 1.5*300); // bottom tab strip
  const tabW = Math.round(W/8); const out=[];
  for (let i=0;i<8;i++){
    const c=document.createElement('canvas'); c.width=tabW; c.height=H-stripTop;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
    ctx.drawImage(img, i*tabW, stripTop, tabW, H-stripTop, 0,0, tabW, H-stripTop);
    const d=ctx.getImageData(0,0,c.width,c.height);
    const res=fn(d.data,c.width,c.height);
    out.push(res? 'tab'+(i+1)+' OK' : 'tab'+(i+1)+' FAIL');
  }
  return out;
}, b64);
console.log(r.join('  '));
await browser.close();

