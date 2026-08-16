"""Paste real scannable QR into SPBC Imagine flyer blank card."""
from pathlib import Path

import numpy as np
from PIL import Image

flyer_path = Path(
    r"C:\Users\Remy\.grok\sessions\C%3A%5CUsers%5CRemy%5Cspringfield-peptide-site"
    r"\019fb631-fa12-7870-9b47-f9cbc54011e7\images\3.jpg"
)
qr_path = Path(r"C:\Users\Remy\springfield-peptide-site\assets\spbc-qr-website.png")
out_jpg = Path(r"C:\Users\Remy\springfield-peptide-site\assets\spbc-flyer-print.jpg")
out_png = Path(r"C:\Users\Remy\springfield-peptide-site\assets\spbc-flyer-print.png")
raw_copy = Path(r"C:\Users\Remy\springfield-peptide-site\assets\spbc-flyer-imagine-raw.jpg")

flyer = Image.open(flyer_path).convert("RGB")
flyer.save(raw_copy, quality=95)
w, h = flyer.size
print("flyer size", w, h)

arr = np.array(flyer)
# Pure white card pixels (blank QR slot)
bright = (arr[:, :, 0] > 245) & (arr[:, :, 1] > 245) & (arr[:, :, 2] > 245)
# Lower half only
bright[: int(h * 0.50), :] = False

ys, xs = np.where(bright)
if len(xs) == 0:
    raise SystemExit("no white QR card found")

x_min, x_max = int(xs.min()), int(xs.max())
y_min, y_max = int(ys.min()), int(ys.max())
print("white card", x_min, y_min, x_max, y_max, "size", x_max - x_min, y_max - y_min)

card_w = x_max - x_min
card_h = y_max - y_min
# Square QR centered in card with ~10% margin
margin = int(min(card_w, card_h) * 0.10)
side = min(card_w, card_h) - 2 * margin
cx = (x_min + x_max) // 2
cy = (y_min + y_max) // 2
x0 = cx - side // 2
y0 = cy - side // 2

qr = Image.open(qr_path).convert("RGB").resize((side, side), Image.Resampling.NEAREST)

out = flyer.copy()
# Keep pure white underlay so quiet zone stays clean
out.paste(Image.new("RGB", (side, side), (255, 255, 255)), (x0, y0))
out.paste(qr, (x0, y0))

out.save(out_jpg, quality=95, optimize=True)
out.save(out_png)
print("saved", out_jpg)
print("saved", out_png)
print("qr at", x0, y0, "side", side)

# Verify with jsQR if available
try:
    import subprocess
    import sys

    code = r"""
const fs=require('fs');
const jsQR=require('jsqr');
const {PNG}=require('pngjs');
const png=PNG.sync.read(fs.readFileSync('assets/spbc-flyer-print.png'));
const c=jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
console.log(c?c.data:'NO CODE');
"""
    r = subprocess.run([sys.executable.replace("python", "node") if False else "node", "-e", code],
                       capture_output=True, text=True, cwd=r"C:\Users\Remy\springfield-peptide-site")
    print("jsQR:", r.stdout.strip() or r.stderr.strip())
except Exception as e:
    print("verify skipped:", e)
