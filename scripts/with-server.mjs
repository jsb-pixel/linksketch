// Serves the built site (dist/) on a private port for scripts that need it.
import { spawn } from 'node:child_process';

export async function withServer(port, fn) {
  const server = spawn(process.execPath, ['scripts/serve.mjs', String(port)], { stdio: 'ignore' });
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
