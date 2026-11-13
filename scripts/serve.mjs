// A tiny static file server for the built site (dist/), behaving like Netlify and
// Cloudflare Pages: folder addresses serve their index.html, and unknown addresses
// get 404.html with a 404 status. Used by the end-to-end tests and helper scripts.
//
//   node scripts/serve.mjs [port]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.argv[2] ?? 4317);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.fairway': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
};

createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(dist, path));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) {
      res.writeHead(301, { Location: `${path}/` }).end();
      return;
    }
    file = join(file, 'index.html');
  }
  let status = 200;
  if (!existsSync(file)) {
    file = join(dist, '404.html');
    status = 404;
  }
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': path.startsWith('/assets/') || path.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving dist/ on http://localhost:${port}`));
