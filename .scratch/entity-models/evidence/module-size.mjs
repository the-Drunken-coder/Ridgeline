// Run from the repository root after installing its pinned dependencies.
// These are isolated entry bundles, not additive pieces of the production bundle.
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { build } = await import(pathToFileURL(resolve('node_modules/vite/dist/node/index.js')).href);
const modules = [];
for (const [name, entry] of [['parser', 'src/model-glb.ts'], ['renderer', 'src/model-renderer.ts']]) {
  const result = await build({ configFile: false, logLevel: 'error', build: {
    write: false, sourcemap: false,
    lib: { entry, formats: ['es'], fileName: name },
    rollupOptions: { external: ['maplibre-gl'] },
  } });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) for (const chunk of output.output) {
    if (chunk.type !== 'chunk') continue;
    modules.push({ entry, file: chunk.fileName, rawBytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length,
      includedModules: Object.keys(chunk.modules).map(file => file.startsWith(process.cwd() + '/') ? file.slice(process.cwd().length + 1) : file) });
  }
}
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version,
  method: 'Vite isolated ES-library entry builds, default production settings, MapLibre external. Each includes its reachable helpers. Shared helpers may repeat between these entries; do not sum gzip sizes or call this the net package delta.', modules }, null, 2));
