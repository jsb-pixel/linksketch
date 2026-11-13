/**
 * Service worker for the installable editor (PWA).
 *
 * It caches only the editor's own "app shell" — its page, script, styles, icons and
 * the sample course — so the editor opens with no connection. Map tiles, USGS
 * elevation and place search are other sites' data: requests to them are never
 * intercepted and never cached.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const APP_PATH = '/linksketch/app/';

/** Extra files the editor needs offline, besides what its HTML references. */
export const SHELL_EXTRAS = ['/linksketch/app/manifest.webmanifest', '/icons/linksketch.svg', '/icons/linksketch-192.png', '/icons/linksketch-512.png', '/icons/linksketch-180.png', '/samples/sample-course.fairway'];

/**
 * Everything the editor page loads from its own site: assets named in the HTML, plus
 * any other chunks those scripts import. `read` returns a file's text by URL path
 * (null if it doesn't exist).
 */
export function shellUrls(appHtml: string, read: (url: string) => string | null, extras: string[] = SHELL_EXTRAS): string[] {
  const urls = new Set<string>([APP_PATH]);
  const queue: string[] = [];
  const add = (u: string) => {
    if (!urls.has(u)) {
      urls.add(u);
      queue.push(u);
    }
  };
  for (const m of appHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) add(m[1]);
  while (queue.length) {
    const u = queue.pop()!;
    if (!u.endsWith('.js')) continue;
    const code = read(u);
    if (!code) continue;
    // Static and dynamic imports of sibling chunks: from"./x.js", import"./x.js", import("./x.js")
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*["']\.\/([\w.-]+\.(?:js|css))["']/g)) add(`/assets/${m[1]}`);
  }
  for (const e of extras) if (read(e) !== null) urls.add(e);
  return [...urls].sort();
}

/** The service worker's source for a list of shell URLs. */
export function serviceWorkerSource(urls: string[], version: string): string {
  return `// Generated at build time by site/build/sw.ts — do not edit.
const CACHE = 'linksketch-app-${version}';
const SHELL = ${JSON.stringify(urls)};
const IN_SHELL = new Set(SHELL);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('linksketch-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Other sites (map tiles, USGS elevation, place search): never intercepted, never cached.
  if (url.origin !== self.location.origin) return;
  if (!IN_SHELL.has(url.pathname)) return;
  if (req.mode === 'navigate') {
    // The page itself: fresh when online, cached copy when not.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(url.pathname, res.clone()));
          return res.clone();
        })
        .catch(() => caches.match(url.pathname).then((hit) => hit || Response.error())),
    );
    return;
  }
  // Fingerprinted files and icons: the cached copy is always right.
  event.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(req)));
});
`;
}

/** Write dist/linksketch/app/sw.js for a finished build. Returns the cached URLs. */
export function writeServiceWorker(dist: string): string[] {
  const read = (url: string) => {
    const file = join(dist, url.endsWith('/') ? `${url}index.html` : url);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
  const html = read(APP_PATH);
  if (html === null) throw new Error('The editor page is missing from the build.');
  const urls = shellUrls(html, read);
  const hash = createHash('sha256');
  for (const u of urls) hash.update(u).update(read(u) ?? '');
  writeFileSync(join(dist, 'linksketch/app/sw.js'), serviceWorkerSource(urls, hash.digest('hex').slice(0, 12)));
  return urls;
}
