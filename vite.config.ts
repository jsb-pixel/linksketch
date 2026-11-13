import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { generateSite } from './site/build/generate';
import { writeServiceWorker } from './site/build/sw';

// One static, multi‑page build: the personal site, with the Linksketch editor at
// /linksketch/app/. Pages are generated into .site/ first (see site/build/generate.ts).
export default defineConfig(() => {
  const repo = __dirname;
  const input = generateSite(repo);
  return {
    root: '.site',
    publicDir: '../public',
    appType: 'mpa' as const,
    server: { fs: { allow: [repo] } },
    plugins: [
      {
        name: 'linksketch-service-worker',
        apply: 'build' as const,
        // After everything is written, so the worker can list the real file names.
        closeBundle() {
          const urls = writeServiceWorker(resolve(repo, 'dist'));
          console.log(`service worker: ${urls.length} files cached for offline use`);
        },
      },
    ],
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      rollupOptions: { input },
    },
  };
});
