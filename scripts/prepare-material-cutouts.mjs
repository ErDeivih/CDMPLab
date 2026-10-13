// Delivery normalization only: the substantive background extraction is done with image_gen.
// Usage: node scripts/prepare-material-cutouts.mjs name=absolute-generated-PNG ...
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const arg of process.argv.slice(2)) {
    const split = arg.indexOf('=');
    const name = arg.slice(0, split),
      source = arg.slice(split + 1);
    if (split < 1 || !/^[a-z-]+$/.test(name) || !path.isAbsolute(source))
      throw new Error('Invalid cutout argument');
    const b64 = fs.readFileSync(source).toString('base64');
    const result = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const original = document.createElement('canvas');
      original.width = img.width;
      original.height = img.height;
      const ctx = original.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      let x0 = img.width,
        y0 = img.height,
        x1 = -1,
        y1 = -1,
        transparent = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const a = data[(y * img.width + x) * 4 + 3];
          if (a === 0) transparent++;
          if (a > 8) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
        }
      if (transparent < img.width * img.height * 0.05 || x1 < x0)
        throw new Error('Cutout lacks real alpha');
      const w = x1 - x0 + 1,
        h = y1 - y0 + 1,
        scale = 360 / Math.max(w, h);
      const out = document.createElement('canvas');
      out.width = out.height = 384;
      out
        .getContext('2d')
        .drawImage(
          img,
          x0,
          y0,
          w,
          h,
          (384 - w * scale) / 2,
          (384 - h * scale) / 2,
          w * scale,
          h * scale,
        );
      return {
        png: out.toDataURL('image/png').split(',')[1],
        bbox: { w: (w * scale) / 384, h: (h * scale) / 384 },
        transparentFraction: transparent / (img.width * img.height),
      };
    }, b64);
    const destination = path.resolve('public/assets/tactical', `${name}.png`);
    fs.writeFileSync(destination, Buffer.from(result.png, 'base64'));
    console.log(
      JSON.stringify({
        name,
        bbox: result.bbox,
        transparentFraction: result.transparentFraction,
        bytes: fs.statSync(destination).size,
      }),
    );
  }
} finally {
  await browser.close();
}
