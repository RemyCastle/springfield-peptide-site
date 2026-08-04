/**
 * Copy shared/tailwind.build.css → shared/tailwind.<sha8>.css
 * Prints the hashed filename for deploy scripts.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const src = path.join(__dirname, '..', 'shared', 'tailwind.build.css');
if (!fs.existsSync(src)) {
  console.error('Missing shared/tailwind.build.css — run npm run build:css first');
  process.exit(1);
}
const buf = fs.readFileSync(src);
const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
const destName = `tailwind.${hash}.css`;
const dest = path.join(__dirname, '..', 'shared', destName);
fs.writeFileSync(dest, buf);
// Remove prior hashed copies (keep build + input)
const sharedDir = path.join(__dirname, '..', 'shared');
for (const f of fs.readdirSync(sharedDir)) {
  if (/^tailwind\.[a-f0-9]{8}\.css$/.test(f) && f !== destName) {
    fs.unlinkSync(path.join(sharedDir, f));
  }
}
console.log(destName);
