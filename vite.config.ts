import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'ridgeline', cssFileName: 'ridgeline' },
    sourcemap: true,
    rollupOptions: { external: ['maplibre-gl'] },
  },
});
