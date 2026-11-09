import { realpathSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

try {
  process.chdir(realpathSync(process.cwd()));
} catch {
  // fallback if already realpath
}

export default defineConfig(({ mode }) => ({
  base: mode === 'web' ? '/openscad-ai/' : '/',
  plugins: [react()],
  worker: { format: 'es' },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
}));
