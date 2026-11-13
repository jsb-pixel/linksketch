/**
 * Builds the website's HTML pages into `.site/` (git‑ignored), which Vite then uses as
 * its root. Pages are plain HTML; scripts and styles are referenced from `src/` and
 * `site/` so Vite bundles and fingerprints them.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export interface SitePage {
  /** URL path, e.g. "/about/" (always ends with a slash) or "/404.html". */
  url: string;
  html: string;
}

/** Where a page's file goes inside the output folder. */
export function pageFile(url: string): string {
  return url.endsWith('/') ? `${url.slice(1)}index.html` : url.slice(1);
}

export function generateSite(repo: string, outDir = '.site'): Record<string, string> {
  const out = resolve(repo, outDir);
  rmSync(out, { recursive: true, force: true });
  const pages: SitePage[] = [];

  // The editor itself. Its HTML is hand‑written (site/app.html).
  pages.push({ url: '/linksketch/app/', html: readFileSync(join(repo, 'site/app.html'), 'utf8') });
  pages.push({
    url: '/',
    html: `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Home</title></head><body><main><h1>Site coming soon</h1><p><a href="/linksketch/app/">Open Linksketch</a></p></main></body></html>`,
  });

  const inputs: Record<string, string> = {};
  for (const p of pages) {
    const file = join(out, pageFile(p.url));
    mkdirSync(dirname(file), { recursive: true });
    // %SRC% and %SITE% become relative paths back into the repo, so Vite bundles them.
    const rel = (target: string) => relative(dirname(file), join(repo, target)).split('\\').join('/');
    writeFileSync(file, p.html.replaceAll('%SRC%', rel('src')).replaceAll('%SITE%', rel('site')));
    inputs[pageFile(p.url).replace(/\.html$/, '').replace(/[\/]/g, '_') || 'index'] = file;
  }
  return inputs;
}
