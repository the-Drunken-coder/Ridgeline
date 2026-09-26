import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  root: 'playground',
  resolve: command === 'serve' ? { alias: {
    '@ridgeline/map/style.css': fileURLToPath(new URL('./src/style.css', import.meta.url)),
    '@ridgeline/map': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
  } } : undefined,
  build: { outDir: '../playground-dist', emptyOutDir: true, sourcemap: true,
    rollupOptions: { input: { main: fileURLToPath(new URL('./playground/index.html', import.meta.url)) } },
  },
}));
