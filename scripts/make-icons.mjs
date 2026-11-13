// Renders public/icons/linksketch.svg to the PNG sizes the installable app needs.
// Run with: node scripts/make-icons.mjs   (uses the Playwright browser; outputs are committed)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
const svg = readFileSync(join(dir, 'linksketch.svg'), 'utf8');
const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage();
// [file, size, share of the square the icon fills] — maskable icons need a safe margin.
for (const [name, size, fill] of [
  ['linksketch-192.png', 192, 1],
  ['linksketch-512.png', 512, 1],
  ['linksketch-180.png', 180, 1],
  ['linksketch-maskable-512.png', 512, 0.72],
]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round((size * fill) / 32) * 32; // whole multiples of the 32 px grid stay crisp
  await page.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px;background:#167018;display:grid;place-items:center"><img src="${data}" style="width:${inner}px;height:${inner}px;image-rendering:pixelated"></body>`,
  );
  await page.screenshot({ path: join(dir, name), clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
