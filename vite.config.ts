import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { generateSite } from './site/build/generate';
import { writeServiceWorker } from './site/build/sw';

// One static, multi‑page build: the personal site, with the Linksketch editor at
// /linksketch/app/. Pages are generated into .site/ first (see site/build/generate.ts).
export default defineConfig(({ command, isPreview }) => {
  const repo = __dirname;
  const dev = command === 'serve' && !isPreview;
  let site = generateSite(repo, '.site', dev);

  const sitePlugin: Plugin = {
    name: 'linksketch-site',
    // The feed, sitemap and robots.txt aren't HTML, so they are added to the build here…
    generateBundle() {
      for (const [url, source] of Object.entries(site.extras)) this.emitFile({ type: 'asset', fileName: url.slice(1), source });
    },
    // …and served straight from memory while developing. Editing anything in content/
    // or site/build/ rebuilds the pages and reloads the browser.
    configureServer(server) {
      server.watcher.add([resolve(repo, 'content'), resolve(repo, 'site')]);
      server.watcher.on('change', (file) => {
        if (!/[\\/](content|site[\\/]build)[\\/]|site[\\/]app\.html$/.test(file)) return;
        site = generateSite(repo, '.site', dev);
        server.ws.send({ type: 'full-reload' });
      });
      server.middlewares.use((req, res, next) => {
        const body = site.extras[(req.url ?? '').split('?')[0]];
        if (body === undefined) return next();
        res.setHeader('Content-Type', req.url!.endsWith('.txt') ? 'text/plain' : 'application/xml');
        res.end(body);
      });
    },
    // After everything is written, so the worker can list the real file names.
    closeBundle() {
      if (this.meta.watchMode) return;
      const urls = writeServiceWorker(resolve(repo, 'dist'));
      console.log(`service worker: ${urls.length} files cached for offline use`);
    },
  };

  return {
    root: '.site',
    publicDir: '../public',
    appType: 'mpa' as const,
    server: { fs: { allow: [repo] } },
    plugins: [sitePlugin],
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      rollupOptions: { input: site.inputs },
    },
  };
});
