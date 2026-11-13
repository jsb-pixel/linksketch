import { defineConfig } from 'vite';
import { generateSite } from './site/build/generate';

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
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      rollupOptions: { input },
    },
  };
});
