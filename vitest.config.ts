import { defineConfig } from 'vitest/config';

// Unit tests run on the plain sources; they don't need the website build.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
