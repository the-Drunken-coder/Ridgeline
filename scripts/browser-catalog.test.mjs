import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { browserCatalog, browserCases, starterCases, supportCases } from '../tests/browser/catalog.ts';
import support from '../playwright.support.config.mjs';

function isBrowserImplementation(url) {
  const path = url.replaceAll(String.fromCharCode(92), '/');
  return path.includes('/tests/browser/') && !path.endsWith('/catalog.ts');
}
const loader = 'const isBrowserImplementation = ' + isBrowserImplementation.toString() + `;
export function load(url, context, next) {
  if (isBrowserImplementation(url)) throw new Error('Discovery imported browser implementation: ' + url);
  return next(url, context);
}`;
const guard = `
  import { register, createRequire } from 'node:module';
  const require = createRequire(import.meta.url);
  register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(loader))}, import.meta.url);
  const isBrowserImplementation = ${isBrowserImplementation.toString()};
  process.on('exit', () => {
    const unexpected = Object.keys(require.cache).find(isBrowserImplementation);
    if (unexpected) {
      process.stderr.write('Discovery imported browser implementation: ' + unexpected);
      process.exitCode = 1;
    }
  });
`;
function discover(script) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', guard + script], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: '', NODE_OPTIONS: '' },
  });
}

test('Node discovery guard rejects actual ESM and CommonJS browser implementation imports', () => {
  const parent = resolve('.artifacts/validation');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(parent + '/discovery-');
  const browser = directory + '/tests/browser';
  mkdirSync(browser, { recursive: true });
  try {
    for (const name of ['catalog.ts', 'case.mjs', 'case.cjs']) writeFileSync(browser + '/' + name, 'globalThis.discoveryLoaded = true;');
    const catalog = discover(`require(${JSON.stringify(browser + '/catalog.ts')});`);
    assert.ifError(catalog.error);
    assert.equal(catalog.status, 0, catalog.stdout + catalog.stderr);
    for (const name of ['case.mjs', 'case.cjs']) {
      const result = discover(name.endsWith('cjs')
        ? `require(${JSON.stringify(browser + '/' + name)});`
        : `await import(${JSON.stringify(pathToFileURL(browser + '/' + name).href)});`);
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Discovery imported browser implementation/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Browser metadata retains the original isolation viewport touch and DPR environments', () => {
  const expected = JSON.parse(readFileSync(new URL('../tests/fixtures/browser-environments.json', import.meta.url), 'utf8'));
  const actual = Object.fromEntries(Object.entries(browserCatalog).flatMap(([title, { support, ...environment }]) =>
    Object.keys(environment).length ? [[title, environment]] : []));
  assert.deepEqual(actual, expected);
  assert.equal(browserCases.length, 257);
  assert.equal(supportCases.length, 45);
  assert.equal(Object.values(starterCases).length, 3);
});

test('Support grep matches full titles by their ending and excludes other workflows', () => {
  const title = 'Queued features render with stable string IDs and click events';
  assert.ok(support.grep.test(`chromium browser.spec.ts ${title}`));
  assert.ok(support.grep.test(title));
  assert.ok(!support.grep.test(`chromium browser.spec.ts ${title} extra`));
  assert.ok(!support.grep.test(`prefix${title}`));
  assert.ok(!support.grep.test('Destroy during initialization, repeat destroy, then remount'));
  for (const title of Object.values(starterCases)) assert.ok(support.grep.test(`starter.spec.ts ${title}`));
});

test('Actual packaged Playwright discovery loads only the import-free browser catalog', () => {
  const result = discover(`
    import { dirname, join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
    process.argv = [process.execPath, cli, 'test', '--config', 'playwright.packaged.config.mjs', '--list', '--reporter=json'];
    await import(pathToFileURL(cli).href);
  `);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  function titles(suites) {
    return suites.flatMap(suite => [...suite.specs.map(spec => spec.title), ...titles(suite.suites ?? [])]);
  }
  assert.deepEqual(titles(report.suites), browserCases.filter(title => !browserCatalog[title].pixelObservation)
    .concat(browserCases.filter(title => browserCatalog[title].pixelObservation)));
});
