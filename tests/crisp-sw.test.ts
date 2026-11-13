import { describe, expect, it } from 'vitest';
import { crispOutline, snapView } from '../src/render/crisp';
import { flatten } from '../src/render/raster';
import type { Feature } from '../src/model/types';
import { APP_PATH, serviceWorkerSource, shellUrls } from '../site/build/sw';

const blob: Feature = {
  id: 'f',
  surface: 'green',
  smooth: true,
  points: [{ x: 10, y: 10 }, { x: 40, y: 8 }, { x: 52, y: 30 }, { x: 30, y: 46 }, { x: 8, y: 34 }],
};

describe('crisp shapes', () => {
  it('samples smooth outlines more finely the further you zoom in', () => {
    const coarse = flatten(blob, 1).flat.poly.length;
    const at4 = crispOutline(blob, 1, 4);
    const at16 = crispOutline(blob, 1, 16);
    expect(at4.length).toBeGreaterThan(coarse);
    expect(at16.length).toBeGreaterThan(at4.length);
    // About two screen pixels between points at 16× zoom.
    let longest = 0;
    for (let i = 0; i < at16.length; i++) {
      const a = at16[i];
      const b = at16[(i + 1) % at16.length];
      longest = Math.max(longest, Math.hypot(a.x - b.x, a.y - b.y) * 16);
    }
    expect(longest).toBeLessThan(12);
  });
  it('is the same curve as the pixel version, just finer', () => {
    const pixel = flatten(blob, 1).flat.poly;
    const fine = crispOutline(blob, 1, 8);
    for (const p of pixel) {
      const nearest = Math.min(...fine.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
      expect(nearest).toBeLessThan(0.3);
    }
  });
  it('leaves straight‑edged shapes alone, and respects the pixel size', () => {
    const square: Feature = { ...blob, smooth: false };
    expect(crispOutline(square, 1, 16)).toEqual(square.points);
    expect(crispOutline(square, 0.5, 16)[0]).toEqual({ x: 20, y: 20 });
  });
  it('snaps the visible area to a coarse grid inside the course', () => {
    expect(snapView({ x0: 70.2, y0: 10.9, x1: 300.5, y1: 190 }, 1000, 600)).toEqual({ x: 64, y: 0, w: 256, h: 192 });
    expect(snapView({ x0: -50, y0: -50, x1: 2000, y1: 2000 }, 1000, 600)).toEqual({ x: 0, y: 0, w: 1000, h: 600 });
    expect(snapView({ x0: 1200, y0: 0, x1: 1400, y1: 100 }, 1000, 600)).toBeNull();
  });
});

describe('service worker (offline app shell)', () => {
  const files: Record<string, string> = {
    '/assets/app-abc.js': 'import{a}from"./shared-123.js";import"./vendor-9.js";const x=()=>import("./lazy-77.js");',
    '/assets/shared-123.js': 'export const a=1;',
    '/assets/vendor-9.js': 'export{}',
    '/assets/lazy-77.js': 'export{}',
    '/assets/app-abc.css': 'body{}',
    '/assets/home-zzz.js': 'unrelated site script',
    '/icons/linksketch.svg': '<svg/>',
    '/samples/sample-course.fairway': '{}',
  };
  const read = (u: string) => files[u] ?? null;
  const html = `<link rel="stylesheet" href="/assets/app-abc.css"><script type="module" src="/assets/app-abc.js"></script><link rel="icon" href="/icons/linksketch.svg">`;

  it('lists the editor page, its assets and the chunks they import — and nothing else', () => {
    const urls = shellUrls(html, read);
    expect(urls).toEqual([
      '/assets/app-abc.css',
      '/assets/app-abc.js',
      '/assets/lazy-77.js',
      '/assets/shared-123.js',
      '/assets/vendor-9.js',
      '/icons/linksketch.svg',
      APP_PATH,
      '/samples/sample-course.fairway',
    ].sort());
    expect(urls).not.toContain('/assets/home-zzz.js');
    // Extras that weren't built are left out rather than breaking the install.
    expect(urls).not.toContain('/icons/linksketch-512.png');
  });

  it('never touches other sites, so map tiles and elevation are not cached', () => {
    const src = serviceWorkerSource(['/linksketch/app/', '/assets/app-abc.js'], 'v1');
    expect(src).toContain("const CACHE = 'linksketch-app-v1'");
    expect(src).toContain('if (url.origin !== self.location.origin) return;');
    expect(src).toContain('if (!IN_SHELL.has(url.pathname)) return;');
    // The origin check comes before anything responds.
    expect(src.indexOf('url.origin !== self.location.origin')).toBeLessThan(src.indexOf('event.respondWith'));
    for (const host of ['nationalmap.gov', 'arcgisonline', 'nominatim']) expect(src).not.toContain(host);
    // It is valid JavaScript.
    expect(() => new Function('self', 'caches', 'fetch', 'Response', src)).not.toThrow();
  });
});
