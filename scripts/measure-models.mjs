import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { preview } from 'vite';

const root = resolve(import.meta.dirname, '..'), artifacts = resolve(root, '.artifacts/model-measurement'), consumer = resolve(artifacts, 'consumer');
const lock = resolve(root, '.artifacts/browser-run.lock'), args = process.argv.slice(2).filter(arg => arg !== '--');
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const verify = args.includes('--verify'), serve = args.includes('--serve'), smoke = args.includes('--smoke');
const hardware = args.includes('--hardware');
let ownsLock = false, retainLock = false, server, browser;
function run(command, values, cwd = root) {
  const result = spawnSync(command, values, { cwd, stdio: 'inherit', timeout: 180_000 });
  if (result.error?.code === 'ETIMEDOUT' || result.signal) retainLock = true;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${values.join(' ')} failed with ${result.status}`);
}
function git(...values) {
  const result = spawnSync('git', values, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim();
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
try {
  if (!verify && !serve && !smoke && !hardware) throw new Error('Use --verify, --smoke, --hardware --metadata machine.json, or --serve (native Safari/manual browser). Optional: --case ID, --matrix, --browser chromium|chrome|edge|firefox, --port 5178.');
  if (smoke && hardware) throw new Error('Choose smoke or hardware, not both.');
  const machine = option('--metadata') ? JSON.parse(await readFile(resolve(option('--metadata')), 'utf8')) : undefined;
  if (hardware && !machine) throw new Error('--hardware requires --metadata with device, os, gpu, driver, browser, displayHz.');
  await mkdir(artifacts, { recursive: true });
  try { await mkdir(lock); } catch (error) { if (error.code !== 'EEXIST') throw error; throw new Error(`Checkout browser artifacts are locked: ${lock}. Stop interrupted child processes before clearing the lock.`); }
  ownsLock = true; await writeFile(resolve(lock, 'owner'), `PID: ${process.pid}\nmodel measurement\n`);
  run('pnpm', ['build']); run('pnpm', ['pack', '--pack-destination', artifacts]);
  run('node', ['--import', 'tsx', 'scripts/model-workloads.ts']);
  await rm(consumer, { recursive: true, force: true }); await mkdir(consumer);
  await cp(resolve(root, 'tools/model-measurement'), consumer, { recursive: true });
  await mkdir(resolve(consumer, 'public'), { recursive: true });
  await cp(resolve(artifacts, 'assets'), resolve(consumer, 'public/assets'), { recursive: true });
  // The focused probe deliberately re-registers original bytes without generator normalization.
  await cp(resolve(root, 'playground/public/entity-models/drone.glb'), resolve(consumer, 'public/assets/drone.glb'));
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const archive = resolve(artifacts, `ridgeline-map-${pkg.version}.tgz`);
  const provenance = { date: new Date().toISOString(), revision: git('rev-parse', 'HEAD'), status: git('status', '--short'),
    diffSha256: sha256(git('diff', 'HEAD')), package: pkg.name, version: pkg.version, archiveSha256: sha256(await readFile(archive)),
    manifestSha256: sha256(await readFile(resolve(artifacts, 'assets/manifest.json'))), maplibre: pkg.dependencies['maplibre-gl'], node: process.version };
  await writeFile(resolve(consumer, 'public/provenance.json'), JSON.stringify(provenance, null, 2));
  await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { build: 'tsc --noEmit && vite build' },
    dependencies: { '@ridgeline/map': `file:../ridgeline-map-${pkg.version}.tgz`, 'maplibre-gl': pkg.dependencies['maplibre-gl'] },
    devDependencies: { vite: pkg.devDependencies.vite, typescript: pkg.devDependencies.typescript } }, null, 2));
  await writeFile(resolve(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: ['vite/client'] }, include: ['consumer.ts'] }, null, 2));
  await writeFile(resolve(consumer, 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n');
  run('pnpm', ['install', '--prefer-offline'], consumer); run('pnpm', ['build'], consumer);
  const port = Number(option('--port') ?? 5178);
  server = await preview({ root: consumer, configFile: false, preview: { host: '127.0.0.1', port, strictPort: true } });
  const url = `http://127.0.0.1:${port}`;
  if (serve) {
    console.log(`Open ${url} in the installed native browser. Native Safari is a manual run, not Playwright WebKit. Press Ctrl+C to stop.`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  } else {
    const engine = option('--browser') ?? 'chromium';
    if (!['chromium', 'chrome', 'edge', 'firefox'].includes(engine)) throw new Error('Browser must be chromium, chrome, edge or firefox. Use --serve for native Safari.');
    const software = smoke || verify;
    const launch = { headless: software, ...(engine === 'chrome' || engine === 'edge' ? { channel: engine === 'chrome' ? 'chrome' : 'msedge' } : {}),
      ...(software && engine !== 'firefox' ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) };
    browser = await (engine === 'firefox' ? firefox : chromium).launch(launch);
    const page = await browser.newPage({ viewport: { width: 1320, height: 1000 } }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}${verify ? '?verify' : ''}`);
    if (verify) {
      await page.waitForFunction(() => window.measurementResult || window.measurementError, {}, { timeout: 60_000 });
      const result = await page.evaluate(() => ({ result: window.measurementResult, error: window.measurementError }));
      if (result.error || errors.length) throw new Error([result.error, ...errors].filter(Boolean).join('\n'));
      await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ ...result.result, provenance, browser: browser.version() }, null, 2));
    } else {
      await page.waitForFunction(() => Boolean(window.modelMeasurement));
      const cases = await page.evaluate(() => window.modelMeasurement.matrix());
      const id = value => `${value.variant}-${value.appearance}-${value.projection}-dpr${value.pixelRatio}`;
      const selected = args.includes('--matrix') ? cases : option('--case') ? cases.filter(value => id(value) === option('--case')) :
        cases.filter(value => ['icons-mixed-flat-dpr1', 'original-mixed-flat-dpr1', 'original-assigned-globe-dpr2', 'materials-original-flat-dpr1'].includes(id(value)));
      if (!selected.length) throw new Error(`Unknown case. Available IDs:\n${cases.map(id).join('\n')}`);
      const runDir = resolve(artifacts, `run-${new Date().toISOString().replaceAll(':', '-')}`); await mkdir(runDir);
      const reports = [];
      for (const value of selected) {
        const pair = [];
        for (const instrumentation of [false, true]) {
          console.log(`Measuring ${id(value)}, instrumentation ${instrumentation ? 'on' : 'off'}`);
          const settings = { ...value, mode: hardware ? 'hardware' : 'smoke', instrumentation, gpu: true,
            warmupMs: hardware ? 10_000 : 1000, durationMs: hardware ? 30_000 : 2000, repeats: hardware ? 3 : 1 };
          const name = `${id(value)}-${instrumentation ? 'on' : 'off'}`;
          let report;
          try { report = await page.evaluate(async ({ settings, machine }) => window.modelMeasurement.run(settings, machine), { settings, machine }); }
          catch (error) {
            const partial = await page.evaluate(() => window.measurementFailure);
            await writeFile(resolve(runDir, `${name}-failure.json`), JSON.stringify({ provenance, settings, machine, error: String(error), partial, pageErrors: errors }, null, 2));
            throw error;
          }
          const png = report.visibility.png; delete report.visibility.png;
          await writeFile(resolve(runDir, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
          await writeFile(resolve(runDir, `${name}.json`), JSON.stringify({ provenance, browserVersion: browser.version(), softwareFlags: software, screenshot: `${name}.png`, ...report }, null, 2));
          pair.push(report); reports.push({ caseId: report.caseId, instrumentation, file: `${name}.json`, diagnostics: report.diagnostics, gpuStatus: report.gpuStatus });
          if (report.validation.failures.length || report.instrumentationError || report.diagnostics.length || errors.length) throw new Error(`Measurement failed: ${[...report.validation.failures, report.instrumentationError, ...report.diagnostics, ...errors].filter(Boolean).join('\n')}`);
        }
        // Paired raw distributions stay separate; this is observed measurement overhead, not a correction to GPU time.
        await writeFile(resolve(runDir, `${id(value)}-overhead.json`), JSON.stringify({ caseId: id(value), order: ['off', 'on'],
          off: pair[0].results, on: pair[1].results, note: 'Do not subtract GPU from CPU or combine overlapping phases. Repeat/reverse order to study thermal or order effects.' }, null, 2));
      }
      await writeFile(resolve(runDir, 'index.json'), JSON.stringify({ provenance, browserVersion: browser.version(), mode: hardware ? 'hardware' : 'smoke', reports,
        completeMatrix: selected.length === cases.length, performanceAcceptance: 'pending independent target-hardware review' }, null, 2));
      console.log(`Raw reports and screenshots: ${runDir}`);
    }
  }
} finally {
  await browser?.close(); await new Promise(resolve => server ? server.httpServer.close(resolve) : resolve());
  if (ownsLock && !retainLock) await rm(lock, { recursive: true, force: true });
  if (ownsLock && retainLock) console.error(`Lock retained at ${lock}. Stop child processes before clearing it.`);
}
