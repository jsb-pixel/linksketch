// Starts a production preview server on a private port for scripts that need the built site.
import { spawn } from 'node:child_process';

export async function withServer(port, fn) {
  // Run Vite directly (not through npx) so stopping it really stops the server.
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${base}/linksketch/app/`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return await fn(base);
  } finally {
    server.kill();
  }
}
