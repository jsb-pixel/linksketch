import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { APP, at, drag, drawHole, ed, loop, menu, openApp, paintedPixels, shapeCount, tool, watchErrors } from './helpers';

test.describe('Linksketch editor', () => {
  test('loads with no console errors', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await expect(page).toHaveTitle(/Linksketch/);
    await expect(page.locator('#toolbox button.tool')).toHaveCount(await ed<number>(page, 'ed.tools.size'));
    await expect(page.locator('#palette .swatch').first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('paints with the brush, and undo takes it back', async ({ page }) => {
    await openApp(page);
    await tool(page, 'brush');
    expect(await paintedPixels(page)).toBe(0);
    await drag(page, [[600, 600], [800, 650], [900, 700]]);
    const n = await paintedPixels(page);
    expect(n).toBeGreaterThan(300);
    // The stroke used the left surface (fairway by default).
    expect(await ed<string>(page, 'ed.surfaceAt({ x: 800, y: 650 })')).toBe('fairway');
    await page.keyboard.press('Control+z');
    expect(await paintedPixels(page)).toBe(0);
    await page.keyboard.press('Control+Shift+z');
    expect(await paintedPixels(page)).toBe(n);
  });

  test('draws two shapes and combines them into one', async ({ page }) => {
    await openApp(page);
    await tool(page, 'freehand');
    await drag(page, loop(700, 600, 120));
    await drag(page, loop(880, 600, 120));
    expect(await shapeCount(page)).toBe(2);
    await page.keyboard.press('Control+a');
    await expect(page.locator('#info-panel')).toContainText('2 shapes selected');
    await page.keyboard.press('Control+j');
    expect(await shapeCount(page)).toBe(1);
    await expect(page.locator('#statusbar')).toContainText('Combined 2 shapes');
    // The union is wider than either circle.
    await expect(page.locator('#info-panel')).toContainText(/Size\s*4[0-3]\d × 2[2-5]\d yd/);
    await page.keyboard.press('Control+z');
    expect(await shapeCount(page)).toBe(2);
  });

  test('adds a hole and shows its yardage on the scorecard', async ({ page }) => {
    await openApp(page);
    await drawHole(page, [500, 900], [500, 500]);
    expect(await ed<number>(page, 'ed.doc.holes.length')).toBe(1);
    const row = page.locator('#scorecard-panel tr').nth(1);
    await expect(row.locator('td').nth(0)).toHaveText('1');
    await expect(row.locator('td').nth(1)).toHaveText('4');
    // 400 yd straight line; allow a yard for pixel rounding of the clicks.
    const yards = Number((await row.locator('td').nth(2).innerText()).replace(/,/g, ''));
    expect(Math.abs(yards - 400)).toBeLessThanOrEqual(2);
    await expect(page.locator('#info-panel')).toContainText('Hole 1');
  });

  test('strategy shows landing odds, and a dragged target can be undone', async ({ page }) => {
    await openApp(page);
    // Paint a fairway strip so the odds have something to land on.
    await tool(page, 'brush');
    await page.keyboard.press(']');
    await drag(page, [[500, 900], [500, 500]]);
    await drawHole(page, [500, 900], [500, 500], [500, 660]);
    await page.keyboard.press('s');
    await expect(page.locator('#info-panel .strat-shot').first()).toBeVisible();
    await expect(page.locator('#info-panel .strat-shot')).toHaveCount(2);
    await expect(page.locator('#info-panel .strat-text').first()).toContainText(/\d+% (fairway|rough)/);

    // Drag the approach's oval (it sits on the green) with the Select tool.
    await tool(page, 'select');
    const from = await at(page, 500, 500);
    const to = await at(page, 540, 520);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    const target = await ed<{ x: number; y: number } | null>(page, 'ed.doc.holes[0].targets?.[1] ?? null');
    expect(target).not.toBeNull();
    expect(Math.abs(target!.x - 540)).toBeLessThan(4);
    expect(Math.abs(target!.y - 520)).toBeLessThan(4);
    await expect(page.locator('#info-panel')).toContainText('Aim at line of play');

    // Regression (review R1): the drag is one undo step.
    await page.keyboard.press('Control+z');
    expect(await ed<unknown>(page, 'ed.doc.holes[0].targets ?? null')).toBeNull();
    expect(await ed<number>(page, 'ed.doc.holes.length')).toBe(1);
  });

  test('with strategy on, the Hole tool still moves the green', async ({ page }) => {
    await openApp(page);
    await drawHole(page, [500, 900], [500, 500]);
    await page.keyboard.press('s');
    await tool(page, 'hole');
    await drag(page, [[500, 500], [560, 480]]);
    const green = await ed<{ x: number; y: number }>(page, 'ed.doc.holes[0].points[1]');
    expect(Math.abs(green.x - 560)).toBeLessThan(4);
    expect(await ed<unknown>(page, 'ed.doc.holes[0].targets ?? null')).toBeNull();
  });

  test('changes the detail level and undoes it', async ({ page }) => {
    await openApp(page);
    await tool(page, 'brush');
    await drag(page, [[600, 600], [700, 600]]);
    const before = await ed<[number, number, number]>(page, '[ed.doc.width, ed.doc.height, ed.doc.yardsPerPixel]');
    const painted = await paintedPixels(page);
    expect(before).toEqual([2000, 1400, 1]);
    await menu(page, 'File', /Detail: 2 yards per pixel/);
    expect(await ed<number[]>(page, '[ed.doc.width, ed.doc.height, ed.doc.yardsPerPixel]')).toEqual([1000, 700, 2]);
    await expect(page.locator('#statusbar')).toContainText('Detail level');
    await page.keyboard.press('Control+z');
    expect(await ed<number[]>(page, '[ed.doc.width, ed.doc.height, ed.doc.yardsPerPixel]')).toEqual(before);
    expect(await paintedPixels(page)).toBe(painted);
  });

  test('saves a course file and opens it again', async ({ page }) => {
    await openApp(page);
    await tool(page, 'brush');
    await drag(page, [[600, 600], [800, 650]]);
    await tool(page, 'freehand');
    await drag(page, loop(1200, 500, 100));
    await drawHole(page, [500, 900], [500, 500]);
    const painted = await paintedPixels(page);

    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    expect(download.suggestedFilename()).toBe('Untitled course.fairway');
    const path = await download.path();
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    expect(saved.format).toBe('fairway-paint');
    expect(saved.holes).toHaveLength(1);

    // Start over, then open the file.
    page.on('dialog', (d) => void d.accept());
    await menu(page, 'File', 'New course…');
    await page.locator('.dialog button', { hasText: 'Create' }).click();
    expect(await paintedPixels(page)).toBe(0);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
    await chooser.setFiles(path);
    await expect(page.locator('#statusbar')).toContainText('Opened');
    expect(await paintedPixels(page)).toBe(painted);
    expect(await shapeCount(page)).toBe(1);
    expect(await ed<number>(page, 'ed.doc.holes.length')).toBe(1);
  });

  test('exports a PNG of the course', async ({ page }) => {
    await openApp(page);
    await tool(page, 'brush');
    await drag(page, [[600, 600], [800, 650]]);
    const [download] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', 'Export PNG (1×)')]);
    expect(download.suggestedFilename()).toBe('Untitled course.png');
    const bytes = readFileSync(await download.path());
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: width and height are big‑endian at bytes 16–23.
    expect(bytes.readUInt32BE(16)).toBe(2000);
    expect(bytes.readUInt32BE(20)).toBe(1400);
  });

  test('autosaves and restores the course on reload', async ({ page }) => {
    await openApp(page);
    await tool(page, 'brush');
    await drag(page, [[600, 600], [800, 650]]);
    const painted = await paintedPixels(page);
    await page.waitForTimeout(2200); // autosave is debounced by 1.5 s
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { fairway?: { ed?: { doc?: unknown } } }).fairway?.ed?.doc);
    await expect(page.locator('#statusbar')).toContainText('Restored your last session');
    expect(await paintedPixels(page)).toBe(painted);
  });

  test('an autosave made when the editor lived at / is found at the new address', async ({ page }) => {
    // Same site, different path: the browser's storage is per site, so it carries over.
    await page.goto('/');
    await page.evaluate(async () => {
      const doc = {
        format: 'fairway-paint',
        version: 1,
        name: 'Course from the old address',
        width: 100,
        height: 80,
        yardsPerPixel: 1,
        background: 'white',
        colors: {},
        surfaceTable: ['fairway'],
        layers: [{ id: 'a', name: 'Base paint', visible: true, locked: false, kind: 'raster', outline: true, rle: '' }],
        holes: [],
      };
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('fairway-paint', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify(doc), 'autosave');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });
    await page.goto(APP);
    await expect(page).toHaveTitle(/Course from the old address/);
    expect(await ed<number[]>(page, '[ed.doc.width, ed.doc.height]')).toEqual([100, 80]);
  });
});

test.describe('Editor accessibility', () => {
  test('dialogs are labelled, trap focus, close on Escape and give focus back', async ({ page }) => {
    await openApp(page);
    const title = page.locator('#menubar .menu-title', { hasText: 'File' });
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#menubar .menu.open [role="menu"]')).toBeVisible();
    await page.keyboard.press('Enter'); // first item: New course…
    const dialog = page.getByRole('dialog', { name: 'New course' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Tab many times: focus never leaves the dialog.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    // Escape works even when nothing in the dialog has the focus.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(title).toBeFocused();
  });

  test('menus work from the keyboard', async ({ page }) => {
    await openApp(page);
    await page.locator('#menubar .menu-title', { hasText: 'File' }).focus();
    await page.keyboard.press('ArrowRight'); // Edit
    await page.keyboard.press('ArrowRight'); // Colors
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#menubar .menu.open .menu-title')).toHaveText('Colors');
    await expect(page.locator('#menubar .menu.open .menu-item').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#menubar .menu.open')).toHaveCount(0);
    // View → toggle the yard grid with the keyboard only.
    await page.locator('#menubar .menu-title', { hasText: 'View' }).focus();
    await page.keyboard.press('Enter');
    const grid = page.locator('#menubar .menu.open .menu-item', { hasText: 'Show yard grid' });
    await grid.focus();
    const was = await ed<boolean>(page, 'ed.showYardGrid');
    await page.keyboard.press('Enter');
    expect(await ed<boolean>(page, 'ed.showYardGrid')).toBe(!was);
  });

  test('the Strategy menu lists the course’s current players', async ({ page }) => {
    await openApp(page);
    await ed(page, `ed.setPlayers([{ ...ed.players[0], id: 'me', name: 'Weekend me' }])`);
    await page.locator('#menubar .menu-title', { hasText: 'Strategy' }).click();
    await expect(page.locator('#menubar .menu.open .menu-item', { hasText: 'Weekend me' })).toBeVisible();
    await expect(page.locator('#menubar .menu.open .menu-item', { hasText: '10 handicap' })).toHaveCount(0);
  });
});
