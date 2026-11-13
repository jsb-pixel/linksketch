import { expect, test, type Page } from '@playwright/test';
import { APP, ed, watchErrors } from './helpers';

/** Every page of the site, read from its own sitemap. */
async function sitePaths(page: Page): Promise<string[]> {
  const xml = await (await page.request.get('/sitemap.xml')).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}

const KEY_PAGES = ['/', '/about/', '/projects/', '/courses/', '/writing/', '/linksketch/', '/linksketch/manual/', '/linksketch/manual/how-scale-works/'];

test.describe('Website pages', () => {
  test('every page renders with no console errors, a title, a description and one h1', async ({ page }) => {
    test.setTimeout(120_000);
    const paths = await sitePaths(page);
    expect(paths.length).toBeGreaterThan(30);
    for (const p of KEY_PAGES) expect(paths).toContain(p);
    for (const path of paths) {
      const errors = watchErrors(page);
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      if (path === APP) {
        await page.waitForFunction(() => !!(window as unknown as { fairway?: unknown }).fairway);
      } else {
        await expect(page.locator('h1'), path).toHaveCount(1);
        await expect(page.locator('main#main'), path).toBeVisible();
        // Nothing sticks out sideways.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} overflows`).toBeLessThanOrEqual(0);
      }
      expect((await page.title()).length, path).toBeGreaterThan(8);
      expect(((await page.locator('meta[name="description"]').getAttribute('content')) ?? '').length, path).toBeGreaterThan(20);
      await page.waitForTimeout(50);
      expect(errors, path).toEqual([]);
      page.removeAllListeners('console');
      page.removeAllListeners('pageerror');
    }
  });

  test('every internal link and picture resolves', async ({ page }) => {
    test.setTimeout(120_000);
    const paths = (await sitePaths(page)).filter((p) => p !== APP);
    const seen = new Set<string>();
    for (const path of paths) {
      await page.goto(path);
      const urls = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => a.href).concat([...document.querySelectorAll<HTMLImageElement>('img[src]')].map((i) => i.src), [...document.querySelectorAll<HTMLLinkElement>('link[href]')].map((l) => l.href)),
      );
      for (const u of urls) {
        const url = new URL(u);
        if (url.origin === new URL(page.url()).origin) seen.add(url.pathname);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    for (const p of seen) {
      const res = await page.request.get(p);
      expect(res.status(), `broken link: ${p}`).toBe(200);
    }
  });

  test('pictures have alt text and fixed sizes; pages are labelled for sharing', async ({ page }) => {
    for (const path of KEY_PAGES) {
      await page.goto(path);
      const bad = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt') || !i.getAttribute('width') || !i.getAttribute('height')).map((i) => i.src));
      expect(bad, path).toEqual([]);
      for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) expect(await page.locator(`meta[property="${prop}"]`).getAttribute('content'), `${path} ${prop}`).toBeTruthy();
      expect(await page.locator('html').getAttribute('lang')).toBe('en');
    }
  });

  test('unknown addresses get the 404 page, which points to the editor', async ({ page }) => {
    const res = await page.goto('/no-such-page/');
    expect(res?.status()).toBe(404);
    await expect(page.locator('h1')).toHaveText(/lost ball/i);
    await expect(page.getByRole('link', { name: /Open Linksketch/ })).toHaveAttribute('href', APP);
  });

  test('the RSS feed is valid and lists every post', async ({ page }) => {
    const res = await page.request.get('/rss.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    await page.goto('/writing/');
    const posts = await page.locator('.post-row').count();
    const feed = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      return {
        error: doc.querySelector('parsererror')?.textContent ?? null,
        root: doc.documentElement.nodeName,
        version: doc.documentElement.getAttribute('version'),
        title: doc.querySelector('channel > title')?.textContent,
        items: [...doc.querySelectorAll('item')].map((i) => ({
          title: i.querySelector('title')?.textContent ?? '',
          link: i.querySelector('link')?.textContent ?? '',
          guid: i.querySelector('guid')?.textContent ?? '',
          date: i.querySelector('pubDate')?.textContent ?? '',
          description: i.querySelector('description')?.textContent ?? '',
        })),
      };
    }, xml);
    expect(feed.error).toBeNull();
    expect([feed.root, feed.version]).toEqual(['rss', '2.0']);
    expect(feed.title).toBeTruthy();
    expect(feed.items).toHaveLength(posts);
    expect(posts).toBeGreaterThanOrEqual(8);
    for (const it of feed.items) {
      expect(it.title.length).toBeGreaterThan(3);
      expect(it.link).toMatch(/^https?:\/\/[^/]+\/writing\/[a-z0-9-]+\/$/);
      expect(it.guid).toBe(it.link);
      expect(Number.isNaN(Date.parse(it.date))).toBe(false);
      expect(it.description.length).toBeGreaterThan(20);
      expect((await page.request.get(new URL(it.link).pathname)).status()).toBe(200);
    }
    // Newest first.
    const times = feed.items.map((i) => Date.parse(i.date));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    await expect(page.locator('link[type="application/rss+xml"]')).toHaveAttribute('href', '/rss.xml');
  });

  test('the sitemap is valid and robots.txt points to it', async ({ page }) => {
    const xml = await (await page.request.get('/sitemap.xml')).text();
    await page.goto('/');
    const parsed = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      return { error: doc.querySelector('parsererror')?.textContent ?? null, root: doc.documentElement.nodeName, ns: doc.documentElement.namespaceURI, locs: [...doc.querySelectorAll('url > loc')].map((l) => l.textContent ?? '') };
    }, xml);
    expect(parsed.error).toBeNull();
    expect(parsed.root).toBe('urlset');
    expect(parsed.ns).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
    expect(new Set(parsed.locs).size).toBe(parsed.locs.length);
    for (const loc of parsed.locs) expect(loc).toMatch(/^https?:\/\/[^/]+\/(.*\/)?$/);
    expect(parsed.locs.some((l) => l.endsWith('/404.html'))).toBe(false);
    const robots = await (await page.request.get('/robots.txt')).text();
    expect(robots).toMatch(/Sitemap: https?:\/\/[^/]+\/sitemap\.xml/);
  });

  test('the footer says which commit the site was built from, and that nothing is tracked', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.built code')).toHaveText(/^[0-9a-f]{7}$/);
    await expect(page.locator('.built time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('footer')).toContainText('No tracking');
    await expect(page.locator('footer a', { hasText: 'GitHub' })).toHaveAttribute('href', 'https://github.com/jsb-pixel');
    await expect(page.locator('footer a', { hasText: 'RSS' })).toHaveAttribute('href', '/rss.xml');
  });

  test('makes no requests to other sites, and sets no cookies', async ({ page, context }) => {
    const foreign: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith('http') && u.host !== new URL(page.url() === 'about:blank' ? 'http://localhost:4317' : page.url()).host) foreign.push(r.url());
    });
    for (const path of KEY_PAGES) {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(150);
    }
    expect(foreign).toEqual([]);
    expect(await context.cookies()).toEqual([]);
  });

  test('the home page is light (under 1.5 MB with everything loaded)', async ({ page }) => {
    let bytes = 0;
    page.on('response', async (r) => {
      try {
        bytes += (await r.body()).length;
      } catch {
        /* redirects have no body */
      }
    });
    await page.goto('/');
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await expect(page.locator('.mini.ready')).toHaveCount(3);
    await page.waitForLoadState('networkidle');
    expect(bytes).toBeGreaterThan(50_000);
    expect(bytes).toBeLessThan(1_500_000);
  });
});

test.describe('Website behaviour', () => {
  test('the menu opens, is keyboard friendly, and marks the current page', async ({ page }) => {
    await page.goto('/about/');
    const btn = page.getByRole('button', { name: 'Menu' });
    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav).toBeHidden();
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link')).toHaveText(['Home', 'About', 'Projects', 'Courses', 'Writing', 'Linksketch']);
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(btn).toBeFocused();
    await btn.press('Enter');
    await nav.getByRole('link', { name: 'Linksketch' }).click();
    await expect(page).toHaveURL(/\/linksketch\/$/);
  });

  test('home leads to the editor, and the editor works when opened from the site', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Open Linksketch/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`${APP}$`));
    await page.waitForFunction(() => !!(window as unknown as { fairway?: { ed?: { doc?: unknown } } }).fairway?.ed?.doc);
    await page.locator('#toolbox button[data-tool="brush"]').click();
    const box = (await page.locator('#view').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    expect(await ed<number>(page, `ed.doc.layers.filter((l) => l.kind === 'raster').reduce((n, l) => n + l.pixels.reduce((m, v) => m + (v ? 1 : 0), 0), 0)`)).toBeGreaterThan(50);
  });

  test('visitors with a saved course are told it is still there; new visitors are not', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(200);
    await expect(page.locator('#saved-note')).toBeHidden();
    // Looking for a saved course must not create an empty database.
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('fairway-paint');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const req = indexedDB.open('fairway-paint', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('kv');
          req.onsuccess = () => {
            req.result.close();
            resolve();
          };
        }),
    );
    await page.reload();
    await expect(page.locator('#saved-note')).toBeVisible();
    await expect(page.locator('#saved-note a')).toHaveAttribute('href', APP);
  });

  test('the sample‑course link opens the sample, but asks before replacing work in progress', async ({ page }) => {
    await page.goto(`${APP}?sample=1`);
    await page.waitForFunction(() => (window as unknown as { fairway?: { ed?: { doc?: { holes: unknown[] } } } }).fairway?.ed?.doc?.holes.length === 9);
    await expect(page).toHaveURL(new RegExp(`${APP}$`)); // the ?sample=1 is dropped, so a reload doesn't repeat it
    // Now there is a course in progress: the same link must ask.
    await page.evaluate(() => (window as unknown as { fairway: { ed: { doc: { name: string }; history: { begin(l: string): void; snapshotMeta(): void; commit(): void } } } }).fairway.ed.history.begin('x'));
    await ed(page, `(ed.history.snapshotMeta(), ed.doc.name = 'My real course', ed.history.commit())`);
    await expect.poll(() => page.evaluate(() => document.title)).toContain('My real course');
    await page.goto(`${APP}?sample=1`);
    const dialog = page.getByRole('dialog', { name: 'Open the sample course?' });
    await expect(dialog).toContainText('My real course');
    await dialog.getByRole('button', { name: 'Keep my course' }).click();
    expect(await ed<string>(page, 'ed.doc.name')).toBe('My real course');
  });
});

test.describe('Minis (live demos on the home page)', () => {
  const mini = (page: Page, kind: string) => page.locator(`.mini[data-mini="${kind}"]`);
  async function ready(page: Page): Promise<void> {
    await page.goto('/');
    await page.locator('.minis').scrollIntoViewIfNeeded();
    await expect(page.locator('.mini.ready')).toHaveCount(3);
  }
  /** Drag inside a mini's canvas between two points given as fractions of its size. */
  async function dragIn(page: Page, kind: string, from: [number, number], to: [number, number]): Promise<void> {
    const c = mini(page, kind).locator('canvas');
    await c.scrollIntoViewIfNeeded();
    const b = (await c.boundingBox())!;
    await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 8 });
    await page.mouse.up();
  }

  test('shot pattern: dragging the oval onto the water raises the trouble', async ({ page }) => {
    await ready(page);
    const out = mini(page, 'pattern').locator('[data-out]');
    await expect(out).toContainText('% trouble');
    const onGreen = Number(await out.getAttribute('data-trouble'));
    expect(onGreen).toBeLessThan(15);
    await dragIn(page, 'pattern', [0.7, 0.46], [0.53, 0.22]); // from the green to the pond
    const onWater = Number(await out.getAttribute('data-trouble'));
    expect(onWater).toBeGreaterThan(onGreen + 30);
    await expect(out).toContainText('water');
  });

  test('pixel green: painting adds pixels and the area updates', async ({ page }) => {
    await ready(page);
    const out = mini(page, 'paint').locator('[data-out]');
    const before = Number(await out.getAttribute('data-painted'));
    const text = await out.innerText();
    await dragIn(page, 'paint', [0.2, 0.8], [0.7, 0.85]);
    expect(Number(await out.getAttribute('data-painted'))).toBeGreaterThan(before + 100);
    expect(await out.innerText()).not.toBe(text);
    // Switching surface works too.
    await mini(page, 'paint').getByRole('button', { name: 'Paint Water' }).click();
    await expect(mini(page, 'paint').getByRole('button', { name: 'Paint Water' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('yardage arcs: dragging the ball changes the distance, and arrow keys work', async ({ page }) => {
    await ready(page);
    const out = mini(page, 'ruler').locator('[data-out]');
    const start = Number(await out.getAttribute('data-yards'));
    await dragIn(page, 'ruler', [0.21, 0.62], [0.5, 0.5]);
    const near = Number(await out.getAttribute('data-yards'));
    expect(near).toBeLessThan(start - 20);
    await expect(out).toHaveText(`${near} yards to the pin`);
    await mini(page, 'ruler').locator('canvas').focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
    expect(Number(await out.getAttribute('data-yards'))).toBeGreaterThan(near + 5);
  });
});

test.describe('Reduced motion', () => {
  test('with reduced motion, nothing animates and everything is visible at once', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const path of ['/', '/linksketch/']) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.classList.contains('motion'))).toBe(false);
      const state = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.reveal')].map((el) => {
          const s = getComputedStyle(el);
          return { opacity: s.opacity, transform: s.transform, seconds: parseFloat(s.transitionDuration) };
        }),
      );
      expect(state.length).toBeGreaterThan(4);
      for (const s of state) {
        expect(s.opacity).toBe('1');
        expect(s.transform).toBe('none');
        expect(s.seconds).toBeLessThan(0.01);
      }
      // Hover zoom is off too.
      const img = page.locator('a.card .card-media img').first();
      if (await img.count()) expect(parseFloat(await img.evaluate((el) => getComputedStyle(el).transitionDuration))).toBeLessThan(0.01);
    }
    await context.close();
  });

  test('without it, cards below the fold start hidden and reveal on scroll', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.classList.contains('motion'))).toBe(true);
    const last = page.locator('.reveal').last();
    expect(await last.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toHaveClass(/\bin\b/);
    await expect.poll(() => last.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await context.close();
  });
});

test.describe('Small screens', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test('key pages fit a 360 px wide phone with nothing cut off', async ({ page }) => {
    for (const path of [...KEY_PAGES, '/linksketch/manual/how-hazard-odds-are-counted/', '/writing/v0-5-strategy/']) {
      await page.goto(path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${path} is wider than the screen`).toBeLessThanOrEqual(0);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
    }
  });
});
