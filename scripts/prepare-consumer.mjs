import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';

// This separate Vite application deliberately has no alias to Ridgeline's source.
const directory = '.artifacts/consumer';
await mkdir(directory, { recursive: true });
await copyFile('tests/browser.html', `${directory}/index.html`);
await copyFile('tests/browser.ts', `${directory}/main.ts`);
await copyFile('tests/browser-cases.ts', `${directory}/browser-cases.ts`);
await copyFile('tests/model-registration.browser.ts', `${directory}/model-registration.browser.ts`);
await copyFile('tests/model-switching.browser.ts', `${directory}/model-switching.browser.ts`);
await copyFile('tests/model-materials.browser.ts', `${directory}/model-materials.browser.ts`);
await copyFile('tests/model-material-fixtures.ts', `${directory}/model-material-fixtures.ts`);
await copyFile('tests/model-fixtures.ts', `${directory}/model-fixtures.ts`);
// The focused GPU test compiles the production GLSL function directly.
await copyFile('src/gpu-camera-shaders.ts', `${directory}/gpu-camera-shaders.ts`);
await writeFile(`${directory}/gpu-vote.ts`, (await readFile('tests/gpu-vote.ts', 'utf8')).replace('../src/gpu-camera-shaders', './gpu-camera-shaders'));
await writeFile(`${directory}/package.json`, JSON.stringify({
  private: true, type: 'module',
  scripts: { build: 'tsc --noEmit && vite build', dev: 'vite --host 127.0.0.1 --port 5174' },
  dependencies: { '@ridgeline/map': 'file:../ridgeline-map-0.1.0.tgz', 'maplibre-gl': '6.11.0' },
  devDependencies: { vite: '8.3.0', typescript: '7.0.2' },
}, null, 2));
await writeFile(`${directory}/tsconfig.json`, JSON.stringify({ compilerOptions: {
  target: 'ES2022', lib: ['ES2022','DOM','DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, types: ['vite/client'],
}, include: ['main.ts'] }, null, 2));
await writeFile(`${directory}/pnpm-workspace.yaml`, 'allowBuilds:\n  esbuild: true\n');
console.log(`Prepared ${directory}. Install dependencies, build, then open its dev server to run the checks.`);
