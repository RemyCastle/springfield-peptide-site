const express = require('express');
const path = require('path');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 8080;
const app = express();

app.use(express.static(__dirname));

app.get('/api/qr', async (_req, res) => {
  const url = `${_req.protocol}://${_req.get('host')}/`;
  try {
    const png = await QRCode.toBuffer(url, { width: 512, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch {
    res.status(500).send('QR generation failed');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Springfield Peptide site running');
  console.log(`  Store:  http://localhost:${PORT}/`);
  console.log(`  QR:     http://localhost:${PORT}/qr.html`);
  console.log('');
});