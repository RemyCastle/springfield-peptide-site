/**
 * Content-hash shared site-header/atmosphere/age-gate/stacks and rewrite HTML refs.
 * Source of truth: unhashed files (site-header.css, site-header.js, …).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const shared = path.join(root, 'shared');

const pairs = [
  ['site-header.css', 'site-header'],
  ['site-header.js', 'site-header'],
  ['site-atmosphere.css', 'site-atmosphere'],
  ['site-atmosphere.js', 'site-atmosphere'],
  ['age-gate.js', 'age-gate'],
  ['stacks.js', 'stacks'],
];

const mapping = {};

for (const [srcName, base] of pairs) {
  const src = path.join(shared, srcName);
  if (!fs.existsSync(src)) {
    console.error('Missing', src);
    process.exit(1);
  }
  const buf = fs.readFileSync(src);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  const ext = path.extname(srcName);
  const destName = `${base}.${hash}${ext}`;
  fs.writeFileSync(path.join(shared, destName), buf);

  const reOld = new RegExp(`^${base}\\.[a-f0-9]{8}\\${ext}$`);
  for (const f of fs.readdirSync(shared)) {
    if (reOld.test(f) && f !== destName) {
      fs.unlinkSync(path.join(shared, f));
      console.log('removed', f);
    }
  }
  mapping[`${base}${ext}`] = destName;
  console.log(`${srcName} -> ${destName}`);
}

const htmlFiles = [
  'index.html',
  'calculator.html',
  'stacks.html',
  'coaching.html',
  'admin.html',
  'qr.html',
];

const rewrites = [
  [/\/shared\/site-header\.[a-f0-9]{8}\.css/g, `/shared/${mapping['site-header.css']}`],
  [/\/shared\/site-header\.[a-f0-9]{8}\.js/g, `/shared/${mapping['site-header.js']}`],
  [/\/shared\/site-atmosphere\.[a-f0-9]{8}\.css/g, `/shared/${mapping['site-atmosphere.css']}`],
  [/\/shared\/site-atmosphere\.[a-f0-9]{8}\.js/g, `/shared/${mapping['site-atmosphere.js']}`],
  [/\/shared\/age-gate\.[a-f0-9]{8}\.js/g, `/shared/${mapping['age-gate.js']}`],
  [/\/shared\/stacks\.[a-f0-9]{8}\.js/g, `/shared/${mapping['stacks.js']}`],
];

for (const hf of htmlFiles) {
  const p = path.join(root, hf);
  if (!fs.existsSync(p)) continue;
  let t = fs.readFileSync(p, 'utf8');
  const orig = t;
  for (const [re, rep] of rewrites) t = t.replace(re, rep);
  if (t !== orig) {
    fs.writeFileSync(p, t);
    console.log('updated', hf);
  } else {
    console.log('no change', hf);
  }
}

console.log(JSON.stringify(mapping, null, 2));
