import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: { ridgeline: 'src/index.ts', entities: 'src/attach-entities.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => entryName === 'ridgeline' ? 'ridgeline.js' : 'entities.js',
      cssFileName: 'ridgeline',
    },
    sourcemap: true,
    rollupOptions: { external: ['maplibre-gl'], output: { chunkFileNames: 'ridgeline-shared.js' } },
  },
});
