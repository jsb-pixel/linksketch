// Captures the website's pictures from the real app, using the bundled sample course:
//   public/shots/*.webp + shots.json, public/courses/kestrel-dunes.webp, public/og.png
//
//   npm run shots      (builds first; the pictures are committed)
//
// Nothing here uses satellite imagery — only the painted course.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withServer } from './with-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/shots');
mkdirSync(out, { recursive: true });
mkdirSync(join(root, 'public/courses'), { recursive: true });
const manifest = {};

await withServer(4319, async (base) => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e));
  await page.goto(`${base}/linksketch/app/`);
  await page.waitForFunction(() => !!window.fairway?.ed?.doc);
  await page.evaluate(() => window.fairway.openSample());
  await page.waitForFunction(() => window.fairway.ed.doc.holes.length === 9);
  await page.evaluate(() => window.fairway.ed.setPixelGridZoom(0));
  await page.mouse.move(700, 5);
  await page.waitForTimeout(300);

  /** Re-encode PNG bytes as WebP (optionally scaled or cropped) inside the browser. */
  const toWebp = async (png, { width, crop, quality = 0.86, type = 'image/webp' } = {}) => {
    const b64 = Buffer.from(png).toString('base64');
    const res = await page.evaluate(
      async ({ b64, width, crop, quality, type }) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const sx = crop?.x ?? 0;
        const sy = crop?.y ?? 0;
        const sw = crop?.w ?? bmp.width;
        const sh = crop?.h ?? bmp.height;
        const w = width ? Math.min(width, sw) : sw;
        const h = Math.round((sh * w) / sw);
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
        const outBlob = await c.convertToBlob({ type, quality });
        const bytes = new Uint8Array(await outBlob.arrayBuffer());
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { data: btoa(s), w, h };
      },
      { b64, width, crop, quality, type },
    );
    return { bytes: Buffer.from(res.data, 'base64'), w: res.w, h: res.h };
  };
  const save = async (name, png, alt, opts) => {
    const r = await toWebp(png, opts);
    writeFileSync(join(out, `${name}.webp`), r.bytes);
    manifest[name] = { w: r.w, h: r.h, alt };
    console.log(`${name}.webp  ${r.w}×${r.h}  ${(r.bytes.length / 1024).toFixed(0)} KB`);
  };
  const download = async (action) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.evaluate(action)]);
    return readFileSync(await d.path());
  };
  const canvasShot = () => page.locator('#view').screenshot();

  // The editor, as it opens.
  await save('editor', await page.screenshot(), 'The Linksketch editor showing the nine-hole sample course, with the toolbox, palette, layers and scorecard', { width: 1360, quality: 0.84 });
  await save('scorecard', await page.locator('#scorecard-panel').screenshot(), 'The scorecard panel with a yardage column for the Back, Middle and Forward tees');

  // The course on its own (also the gallery cover and the social card).
  const course = await download(() => window.fairway.exportPng(1));
  await save('course', course, 'Plan of Kestrel Dunes, a fictional nine-hole course painted in Linksketch', { width: 1200 });
  const cover = await toWebp(course, { width: 1200 });
  writeFileSync(join(root, 'public/courses/kestrel-dunes.webp'), cover.bytes);
  const og = await toWebp(course, { crop: { x: 0, y: 106, w: 1500, h: 788 }, width: 1200, type: 'image/png' });
  writeFileSync(join(root, 'public/og.png'), og.bytes);

  // Strategy on the fourth hole.
  await page.evaluate(() => {
    const ed = window.fairway.ed;
    ed.selectHole(ed.doc.holes[3].id);
    ed.setStrategy({ show: true, player: 'mid' });
    ed.pointHoleUp();
    ed.zoomAt({ x: 500, y: 400 }, 1.9);
    ed.centerOn({ x: 1275, y: 385 });
  });
  await page.waitForTimeout(700);
  await save('strategy', await canvasShot(), 'The fourth hole turned to play up the screen, with a 10 handicap’s landing ovals and the odds of finding trouble', { width: 1000 });
  const holepage = await download(() => window.fairway.exportHolePage());
  await save('holepage', holepage, 'A yardage-book page for hole 4: distances to hazards, yards to the green and the fairway width', { width: 820, quality: 0.88 });

  // Terrain.
  await page.evaluate(() => {
    const ed = window.fairway.ed;
    ed.setStrategy({ show: false });
    ed.selectHole(null);
    ed.rotateView(0);
    ed.terrainLayer().visible = true;
    ed.zoomAt({ x: 500, y: 400 }, 1.5);
    ed.centerOn({ x: 760, y: 560 });
    ed.invalidate();
  });
  await page.waitForTimeout(600);
  await save('terrain', await canvasShot(), 'Part of the sample course with hillshade and five-foot contour lines drawn over it', { width: 1000 });
  await page.evaluate(() => {
    const ed = window.fairway.ed;
    ed.terrainLayer().visible = false;
    ed.fit();
    ed.invalidate();
  });

  // The presentation sheet.
  const sheet = await download(() => window.fairway.exportPresentation());
  await save('sheet', sheet, 'The presentation sheet: the course with a title block, legend, scale bar and north arrow', { width: 1200, quality: 0.84 });

  // Crisp shapes: the same green as pixels and as smooth curves, side by side.
  const closeUp = async (crisp) => {
    await page.evaluate((on) => {
      const ed = window.fairway.ed;
      ed.setTool('hand');
      ed.setCrispShapes(on);
      ed.setHoleView({ showHoles: false });
      ed.zoomAt({ x: 500, y: 400 }, 8);
      ed.centerOn({ x: 512, y: 372 });
    }, crisp);
    await page.waitForTimeout(400);
    return page.locator('#view').screenshot({ clip: undefined });
  };
  const a = await toWebp(await closeUp(false), { crop: { x: 280, y: 180, w: 480, h: 400 }, type: 'image/png' });
  const b = await toWebp(await closeUp(true), { crop: { x: 280, y: 180, w: 480, h: 400 }, type: 'image/png' });
  const pair = await page.evaluate(
    async ([left, right]) => {
      const load = async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const [l, r] = [await load(left), await load(right)];
      const c = new OffscreenCanvas(l.width + r.width + 12, l.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(l, 0, 0);
      ctx.drawImage(r, l.width + 12, 0);
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [a.bytes.toString('base64'), b.bytes.toString('base64')],
  );
  await save('crisp', Buffer.from(pair, 'base64'), 'A green and bunker at 800% zoom: on the left as pixels, on the right with crisp shapes switched on', { quality: 0.9 });

  await browser.close();
});
writeFileSync(join(out, 'shots.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('wrote public/shots/shots.json');
