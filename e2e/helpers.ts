import { expect, type Page } from '@playwright/test';

export const APP = '/linksketch/app/';

/** Console errors and uncaught exceptions seen on a page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/**
 * Open the editor with the download/upload fallbacks (no native file pickers, which a
 * test can't drive) and wait until it is ready.
 */
export async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Safari‑style file handling: Save downloads, Open uses a file input.
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto(APP);
  await page.waitForFunction(() => !!(window as unknown as { fairway?: { ed?: { doc?: unknown } } }).fairway?.ed?.doc);
  await expect(page.locator('#toolbox button.tool')).not.toHaveCount(0);
}

/** Run code against the editor (window.fairway.ed). */
export function ed<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const app = window.fairway; const ed = app.ed; return (${fn}); })()`) as Promise<T>;
}

/** Page coordinates of a course point given in yards. */
export async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([wx, wy]) => {
      const e = (window as unknown as { fairway: { ed: { worldToScreen(w: { x: number; y: number }): { x: number; y: number }; canvas: HTMLCanvasElement } } }).fairway.ed;
      const s = e.worldToScreen({ x: wx, y: wy });
      const r = e.canvas.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    },
    [x, y],
  );
}

export async function click(page: Page, x: number, y: number, opts: { clickCount?: number } = {}): Promise<void> {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y, opts);
}

/** Press, move through the points (yards), release. */
export async function drag(page: Page, pts: [number, number][], steps = 4): Promise<void> {
  const first = await at(page, ...pts[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const s = await at(page, ...p);
    await page.mouse.move(s.x, s.y, { steps });
  }
  await page.mouse.up();
}

/** Points around a circle, for drawing a freehand loop. */
export function loop(cx: number, cy: number, r: number, n = 28): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r] as [number, number]);
}

/** Pick a tool by its toolbox button. */
export async function tool(page: Page, id: string): Promise<void> {
  await page.locator(`#toolbox button[data-tool="${id}"]`).click();
}

/** Choose an item from the menu bar with the mouse. */
export async function menu(page: Page, title: string, item: string | RegExp): Promise<void> {
  await page.locator('#menubar .menu-title', { hasText: new RegExp(`^${title}$`) }).click();
  await page.locator('#menubar .menu.open .menu-item', { hasText: item }).first().click();
}

/** Number of painted pixels across all paint layers. */
export function paintedPixels(page: Page): Promise<number> {
  return ed<number>(page, `ed.doc.layers.filter((l) => l.kind === 'raster').reduce((n, l) => n + l.pixels.reduce((m, v) => m + (v ? 1 : 0), 0), 0)`);
}

export function shapeCount(page: Page): Promise<number> {
  return ed<number>(page, `ed.doc.layers.filter((l) => l.kind === 'vector').reduce((n, l) => n + l.features.length, 0)`);
}

/** Draw a straight hole from tee to green (yards). */
export async function drawHole(page: Page, tee: [number, number], green: [number, number], aim?: [number, number]): Promise<void> {
  await tool(page, 'hole');
  await click(page, ...tee);
  if (aim) await click(page, ...aim);
  await click(page, ...green);
  await page.keyboard.press('Enter');
}
