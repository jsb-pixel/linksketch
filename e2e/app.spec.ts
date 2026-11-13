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

  /** What the autosave database holds right now (null if nothing). */
  const savedText = (page: import('@playwright/test').Page) =>
    page.evaluate(
      () =>
        new Promise<string | null>((resolve) => {
          const req = indexedDB.open('fairway-paint', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('kv');
          req.onsuccess = () => {
            const db = req.result;
            const get = db.transaction('kv', 'readonly').objectStore('kv').get('autosave');
            get.onsuccess = () => {
              db.close();
              resolve(typeof get.result === 'string' ? get.result : null);
            };
            get.onerror = () => resolve(null);
          };
          req.onerror = () => resolve(null);
        }),
    );
  const reloadApp = async (page: import('@playwright/test').Page) => {
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { fairway?: { ed?: { doc?: unknown } } }).fairway?.ed?.doc);
  };

  test('autosaves and restores the course on reload', async ({ page }) => {
    await openApp(page);
    await tool(page, 'brush');
    await drag(page, [[600, 600], [800, 650]]);
    const painted = await paintedPixels(page);
    // Autosave is debounced by 1.5 s; wait until the stroke has really been written.
    await expect
      .poll(async () => {
        const t = await savedText(page);
        if (!t) return false;
        // Empty paint layers all encode to the same length; the painted one is longer.
        const sizes = (JSON.parse(t).layers as { rle?: string }[]).filter((l) => typeof l.rle === 'string').map((l) => l.rle!.length);
        return Math.max(...sizes) > Math.min(...sizes);
      }, { timeout: 15_000 })
      .toBe(true);
    await reloadApp(page);
    await expect(page.locator('#statusbar')).toContainText('Restored your last session');
    expect(await paintedPixels(page)).toBe(painted);
  });

  test('work done in the last second before closing the tab is not lost', async ({ page }) => {
    // Regression (review R14): reload straight after a stroke, before the 1.5 s autosave fires.
    await openApp(page);
    await tool(page, 'brush');
    await drag(page, [[600, 600], [800, 650]]);
    const painted = await paintedPixels(page);
    await reloadApp(page);
    await expect(page.locator('#statusbar')).toContainText('Restored your last session');
    expect(await paintedPixels(page)).toBe(painted);
    // The emergency copy is handed over to the database and cleared.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fairway-pending'))).toBeNull();
    await reloadApp(page);
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

test.describe('Tee sets', () => {
  test('adds tee sets, places a forward tee and shows a scorecard column per set', async ({ page }) => {
    await openApp(page);
    await drawHole(page, [500, 900], [500, 500]);
    await menu(page, 'Holes', 'Tee sets…');
    const dialog = page.getByRole('dialog', { name: 'Tee sets' });
    await dialog.getByRole('button', { name: '+ Add tee set' }).click();
    await dialog.getByRole('button', { name: '+ Add tee set' }).click();
    await expect(dialog.locator('tr')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'OK' }).click();
    expect(await ed<string[]>(page, 'ed.doc.teeSets.map((t) => t.name)')).toEqual(['Back', 'Middle']);

    // Scorecard: Hole, Par, Back, Middle.
    const head = page.locator('#scorecard-panel tr').first().locator('th');
    await expect(head).toHaveText(['Hole', 'Par', 'Back', 'Middle']);

    // Place the Middle tee 60 yd up the hole.
    await page.locator('#scorecard-panel tr').nth(1).click();
    await page.locator('#info-panel .tee-row', { hasText: 'Middle' }).getByRole('button', { name: 'Place' }).click();
    const p = await at(page, 500, 840);
    await page.mouse.click(p.x, p.y);
    const row = page.locator('#scorecard-panel tr').nth(1).locator('td');
    const backYd = Number(await row.nth(2).innerText());
    const midYd = Number(await row.nth(3).innerText());
    expect(Math.abs(backYd - 400)).toBeLessThanOrEqual(2);
    expect(Math.abs(midYd - 340)).toBeLessThanOrEqual(3);

    // One undo step each: the tee, then the sets.
    await page.keyboard.press('Control+z');
    expect(await ed<unknown>(page, 'ed.doc.holes[0].tees ?? null')).toBeNull();
    await page.keyboard.press('Control+z');
    expect(await ed<unknown>(page, 'ed.doc.teeSets ?? null')).toBeNull();
    await expect(page.locator('#scorecard-panel tr').first().locator('th')).toHaveText(['Hole', 'Par', 'Yards']);
  });
});

test.describe('Exports, stats and labels', () => {
  /** A short hole with a fairway, a green and a bunker to measure. */
  async function paintHole(page: import('@playwright/test').Page): Promise<void> {
    await ed(page, `(() => {
      const W = ed.doc.width;
      const base = ed.doc.layers[0];
      const code = (id) => ['fairway','green','tee','bunker','waste','water'].indexOf(id) + 1;
      const rect = (x, y, w, h, id) => { for (let j = y; j < y + h; j++) base.pixels.fill(code(id), j * W + x, j * W + x + w); };
      rect(480, 520, 40, 380, 'fairway');
      rect(485, 485, 30, 35, 'green');
      rect(525, 640, 14, 20, 'bunker');
      ed.invalidate();
      return true;
    })()`);
    await drawHole(page, [500, 900], [500, 500]);
  }

  test('adds, edits, moves and deletes a text label', async ({ page }) => {
    await openApp(page);
    await tool(page, 'text');
    const p = await at(page, 900, 600);
    await page.mouse.click(p.x, p.y);
    const dialog = page.getByRole('dialog', { name: 'Add label' });
    await dialog.getByLabel('Text').fill('Clubhouse');
    await dialog.getByLabel('Size').selectOption('24');
    await dialog.getByRole('button', { name: 'OK' }).click();
    expect(await ed<unknown>(page, 'ed.doc.labels.map((l) => [l.text, l.size])')).toEqual([['Clubhouse', 24]]);
    await expect(page.locator('#info-panel')).toContainText('Text label');

    // Drag it 100 yd east.
    await page.waitForTimeout(450); // so the press isn't read as a double‑click
    await drag(page, [[900, 600], [1000, 600]]);
    const x = await ed<number>(page, 'ed.doc.labels[0].x');
    expect(Math.abs(x - 1000)).toBeLessThan(6);
    await page.keyboard.press('Control+z');
    expect(Math.abs((await ed<number>(page, 'ed.doc.labels[0].x')) - 900)).toBeLessThan(6);

    await page.keyboard.press('Backspace');
    expect(await ed<unknown>(page, 'ed.doc.labels ?? null')).toBeNull();
    await page.keyboard.press('Control+z');
    expect(await ed<number>(page, 'ed.doc.labels.length')).toBe(1);
  });

  test('shows course stats in the Info panel and exports them', async ({ page }) => {
    await openApp(page);
    await paintHole(page);
    await page.locator('#info-panel details.stats summary').click();
    const stats = page.locator('#info-panel details.stats');
    await expect(stats).toContainText('Bunkers1');
    await expect(stats).toContainText(/Greens1 · 9,450 sq ft/);
    await expect(stats).toContainText(/Yardage40[0-2] yd/);
    await stats.getByRole('button', { name: 'All stats & export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Course stats' });
    await expect(dialog).toContainText('Fairway');
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export CSV' }).click()]);
    expect(download.suggestedFilename()).toBe('Untitled course - stats.csv');
    const csv = readFileSync(await download.path(), 'utf8');
    expect(csv).toContain('Bunkers,1');
    expect(csv).toMatch(/Fairway,3\.1\d\d,15200/);
  });

  test('exports a yardage‑book page for the selected hole', async ({ page }) => {
    await openApp(page);
    await paintHole(page);
    const [download] = await Promise.all([page.waitForEvent('download'), menu(page, 'Holes', 'Export hole page (PNG)')]);
    expect(download.suggestedFilename()).toBe('Untitled course - hole 1.png');
    const bytes = readFileSync(await download.path());
    expect(bytes.readUInt32BE(16)).toBe(1275);
    expect(bytes.readUInt32BE(20)).toBe(1650);
    expect(bytes.length).toBeGreaterThan(20_000);
  });

  test('exports every hole as a multi‑page PDF', async ({ page }) => {
    await openApp(page);
    await paintHole(page);
    await drawHole(page, [800, 900], [800, 740]);
    const [download] = await Promise.all([page.waitForEvent('download'), menu(page, 'Holes', 'Export all hole pages (PDF)')]);
    expect(download.suggestedFilename()).toBe('Untitled course - yardage book.pdf');
    const pdf = readFileSync(await download.path()).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  test('exports a presentation sheet with a title block and legend', async ({ page }) => {
    await openApp(page);
    await paintHole(page);
    const [download] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', 'Export presentation sheet (PNG)')]);
    expect(download.suggestedFilename()).toBe('Untitled course - presentation.png');
    const bytes = readFileSync(await download.path());
    // Bigger than the bare 2× course picture: margins, title, legend and footer were added.
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(4000);
    expect(bytes.readUInt32BE(20)).toBeGreaterThan(2800);
  });

  test('crisp shapes draws smooth curves when zoomed in, without errors', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await tool(page, 'freehand');
    await drag(page, loop(700, 600, 60));
    // Nothing but the drawing on screen: no selection outline, pixel grid or brush cursor.
    await tool(page, 'hand');
    await page.mouse.move(5, 5);
    await ed(page, `(ed.select(null), ed.setPixelGridZoom(0), ed.zoomAt({ x: 400, y: 300 }, 8), ed.centerOn({ x: 760, y: 600 }), true)`);
    /** Count distinct colors along a short vertical line across the shape's right edge. */
    const edgeColors = () =>
      page.evaluate(() => {
        const c = document.querySelector('#view') as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        const d = ctx.getImageData(Math.round(c.width / 2) - 40, Math.round(c.height / 2) - 60, 80, 120).data;
        const seen = new Set<number>();
        for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        return seen.size;
      });
    await page.waitForTimeout(150);
    const pixelated = await edgeColors();
    await menu(page, 'View', 'Crisp shapes when zoomed in');
    await page.waitForTimeout(150);
    const crisp = await edgeColors();
    // Hard pixels use only the palette (fill, outline, paper); smooth curves blend at the edge.
    expect(pixelated).toBeLessThanOrEqual(4);
    expect(crisp).toBeGreaterThan(pixelated);
    expect(await ed<boolean>(page, 'ed.crispShapes')).toBe(true);
    expect(errors).toEqual([]);
  });

  test('reminds you where work is saved, and links to feedback', async ({ page }) => {
    await openApp(page);
    const note = page.locator('#save-note');
    await expect(note).toContainText('Kept in this browser only');
    await note.click();
    await expect(page.getByRole('dialog', { name: 'Where is my work saved?' })).toContainText('File → Save');
    await page.keyboard.press('Escape');
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    await download.path();
    await expect(note).toContainText('Saved to a file');

    const [popup] = await Promise.all([page.waitForEvent('popup'), menu(page, 'Help', 'Send feedback…')]);
    expect(popup.url()).toContain('github.com/jsb-pixel/linksketch/issues/new');
    await popup.close();
  });
});

test.describe('Sample course', () => {
  test('opens from the File menu with holes, tee sets and labels', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await menu(page, 'File', 'Open sample course');
    await expect(page.locator('#statusbar')).toContainText('Opened the sample course');
    await expect(page).toHaveTitle(/Kestrel Dunes/);
    expect(await ed<number>(page, 'ed.doc.holes.length')).toBe(9);
    expect(await ed<string[]>(page, 'ed.doc.teeSets.map((t) => t.name)')).toEqual(['Back', 'Middle', 'Forward']);
    expect(await ed<number>(page, 'ed.doc.labels.length')).toBeGreaterThan(0);
    expect(await shapeCount(page)).toBeGreaterThan(50);
    await expect(page.locator('#scorecard-panel tr.total').last()).toContainText('36');
    // It is a real course: strategy works on it.
    await page.locator('#scorecard-panel tr').nth(4).click();
    await page.keyboard.press('s');
    await expect(page.locator('#info-panel .strat-shot').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Installable app (PWA)', () => {
  test('has a manifest and icons', async ({ page, request }) => {
    await page.goto(APP);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await request.get(href!)).json();
    expect(manifest.start_url).toBe('/linksketch/app/');
    expect(manifest.display).toBe('standalone');
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  });

  test('opens offline once visited, and caches nothing from other sites', async ({ page, context }) => {
    await openApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(req.url);
      return out;
    });
    expect(cached.length).toBeGreaterThan(3);
    for (const url of cached) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
    expect(cached.some((u) => u.endsWith('/linksketch/app/'))).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { fairway?: { ed?: { doc?: unknown } } }).fairway?.ed?.doc);
    await expect(page.locator('#toolbox button.tool').first()).toBeVisible();
    await tool(page, 'brush');
    await drag(page, [[600, 600], [700, 620]]);
    expect(await paintedPixels(page)).toBeGreaterThan(50);
    await context.setOffline(false);
  });
});
