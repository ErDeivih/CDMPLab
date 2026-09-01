// Analyzes each tactical PNG: computes content (alpha>0) bounding box, aspect,
// and content span fractions, so we can derive coherent per-type base sizes.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('public/assets/tactical');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

const results = [];
for (const f of files) {
  const b64 = fs.readFileSync(path.join(DIR, f)).toString('base64');
  const info = await page.evaluate(({ b64 }) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;
        let minX = img.width, minY = img.height, maxX = -1, maxY = -1, count = 0;
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const a = data[(y * img.width + x) * 4 + 3];
            if (a > 8) {
              count++;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        resolve({
          w: img.width, h: img.height,
          minX, minY, maxX, maxY, count,
          cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        });
      };
      img.onerror = () => reject(new Error('load fail'));
      img.src = 'data:image/png;base64,' + b64;
    });
  }, { b64 });
  const { w, h, minX, minY, maxX, maxY, count, cx, cy } = info;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  results.push({
    file: f,
    img: `${w}x${h}`,
    bbox: `${bw}x${bh}`,
    cxFrac: +((cx / w).toFixed(3)),
    cyFrac: +((cy / h).toFixed(3)),
    fracW: +((bw / w).toFixed(3)),
    fracH: +((bh / h).toFixed(3)),
    aspect: +((bw / bh).toFixed(3)),
    fillPct: +((count / (w * h) * 100).toFixed(1)),
  });
}
await browser.close();

console.table(results);
console.log('\nSo the LONG side of the drawn object (in canvas units when size=1 box 5.2):');
for (const r of results) {
  // meet-fit into a 5.2 box: scale = 5.2 / max(imgW,imgH); drawn bbox pixels -> units
  const scale = 5.2 / Math.max(
      Number(r.img.split('x')[0]), Number(r.img.split('x')[1]));
  const longPx = Math.max(r.bbox.split('x').map(Number));
  const shortPx = Math.min(r.bbox.split('x').map(Number));
  // In units along the long dimension:
  const longUnits = longPx * scale;
  const shortUnits = shortPx * scale;
  console.log(`${r.file.padEnd(22)} drawn long=${longUnits.toFixed(2)}u short=${shortUnits.toFixed(2)}u  (box 5.2u, meet)`);
}
