import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkValidation, requiredJobs } from './check-validation.mjs';
import { checkShards } from './check-shards.mjs';

const successfulNeeds = () => Object.fromEntries(requiredJobs.map(name => [name, { result: 'success' }]));

test('gate only succeeds when all required jobs succeed', () => {
  checkValidation(successfulNeeds());
  for (const name of requiredJobs) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const needs = successfulNeeds();
      if (result) needs[name].result = result;
      else delete needs[name];
      const run = spawnSync(process.execPath, ['scripts/check-validation.mjs'], {
        env: { ...process.env, VALIDATION_NEEDS: JSON.stringify(needs) }, encoding: 'utf8',
      });
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, new RegExp(name));
    }
  }
});

test('actual Playwright shard reports cover every case and preserve failures', async t => {
  const artifacts = resolve('.artifacts/validation');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(`${artifacts}/fixture-`);
  let completed = false;
  try {
    await writeFile(`${directory}/playwright.config.mjs`, `export default { testDir: '.', fullyParallel: true, workers: 1, retries: 0, outputDir: './results' };`);
    await writeFile(`${directory}/cases.spec.mjs`, `import { test, expect } from 'playwright/test';
      for (let i = 0; i < 8; i++) test('case ' + i, () => expect(i).not.toBe(0));`);
    async function run(name, args, env = {}) {
      const result = spawnSync('pnpm', ['exec', 'playwright', ...args], {
        encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000,
      });
      await writeFile(`${directory}/${name}.process.json`, JSON.stringify({
        args, status: result.status, signal: result.signal, error: result.error?.message,
        stdout: result.stdout, stderr: result.stderr,
      }, null, 2));
      assert.ifError(result.error);
      return result;
    }
    const testArgs = ['test', '-c', `${directory}/playwright.config.mjs`];
    // File output avoids depending on a subprocess flushing JSON to a stdout pipe.
    const discoveryPath = `${directory}/discovery.json`;
    const discovery = await run('discovery', [...testArgs, '--list', '--reporter=json'], { PLAYWRIGHT_JSON_OUTPUT_FILE: discoveryPath });
    assert.equal(discovery.status, 0, discovery.stderr);
    const expected = JSON.parse(await readFile(discoveryPath, 'utf8'));
    const reports = [];
    for (let shard = 1; shard <= 4; shard++) {
      const path = `${directory}/${shard}.json`;
      const result = await run(`shard-${shard}`, [...testArgs, `--shard=${shard}/4`, '--reporter=json,blob'], {
        PLAYWRIGHT_JSON_OUTPUT_FILE: path,
        PLAYWRIGHT_BLOB_OUTPUT_DIR: `${directory}/blobs-${shard}`,
      });
      assert.equal(result.status, shard === 1 ? 1 : 0, result.stderr);
      reports.push(JSON.parse(await readFile(path, 'utf8')));
    }
    assert.equal(checkShards(expected, reports), 8);
    await mkdir(`${directory}/combined`);
    for (let shard = 1; shard <= 4; shard++) {
      await cp(`${directory}/blobs-${shard}`, `${directory}/combined`, { recursive: true });
    }
    const mergedPath = `${directory}/merged.json`;
    const merged = await run('merge', ['merge-reports', '--reporter=json', `${directory}/combined`], { PLAYWRIGHT_JSON_OUTPUT_FILE: mergedPath });
    assert.equal(merged.status, 0, merged.stderr);
    const combined = JSON.parse(await readFile(mergedPath, 'utf8'));
    assert.equal(combined.stats.expected, 7);
    assert.equal(combined.stats.unexpected, 1);
    assert.equal(checkShards(expected, [combined], 1), 8);
    assert.throws(() => checkShards(expected, reports.slice(1)), /Expected 4/);
    assert.throws(() => checkShards(expected, [reports[0], reports[0], ...reports.slice(2)]), /Duplicated/);
    const missing = structuredClone(reports);
    missing[0].suites[0].specs.pop();
    assert.throws(() => checkShards(expected, missing), /Missing/);
    for (const status of ['skipped', 'interrupted']) {
      const incomplete = structuredClone(reports);
      incomplete[0].suites[0].specs[0].tests[0].results[0].status = status;
      assert.throws(() => checkShards(expected, incomplete), /exactly once/);
    }
    const retried = structuredClone(reports);
    retried[0].suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 });
    assert.throws(() => checkShards(expected, retried), /exactly once/);

    await t.test('unsharded consumer reports retain both suites and their results', async () => {
      const consumerBlobs = `${directory}/consumer-blobs`;
      await mkdir(consumerBlobs);
      for (const name of ['control', 'playground']) {
        const consumer = `${directory}/${name}`;
        await mkdir(consumer);
        await writeFile(`${consumer}/playwright.config.mjs`, `export default { testDir: '.', workers: 1, retries: 0, outputDir: './results' };`);
        await writeFile(`${consumer}/consumer.spec.mjs`, `import { test, expect } from 'playwright/test';
          test('${name} result', () => expect('${name}').toBe('control'));`);
        const result = await run(name, ['test', '-c', `${consumer}/playwright.config.mjs`, '--reporter=blob'], {
          PLAYWRIGHT_BLOB_OUTPUT_DIR: `${consumer}/blob-report`,
          PLAYWRIGHT_BLOB_OUTPUT_NAME: `report-${name}.zip`,
        });
        assert.equal(result.status, name === 'control' ? 0 : 1, result.stderr);
        await cp(`${consumer}/blob-report`, consumerBlobs, { recursive: true });
      }
      assert.deepEqual((await readdir(consumerBlobs)).sort(), ['report-control.zip', 'report-playground.zip']);

      const mergeArgs = ['merge-reports', '--config', 'scripts/playwright-merge.config.mjs', consumerBlobs];
      const htmlDirectory = `${directory}/consumer-html`;
      const html = await run('consumer-html', mergeArgs, { PLAYWRIGHT_HTML_OUTPUT_DIR: htmlDirectory });
      assert.equal(html.status, 0, html.stderr);
      assert.ok((await readFile(`${htmlDirectory}/index.html`)).byteLength > 0);

      const consumerJson = `${directory}/consumer-merged.json`;
      const json = await run('consumer-json', [...mergeArgs, '--reporter=json'], { PLAYWRIGHT_JSON_OUTPUT_FILE: consumerJson });
      assert.equal(json.status, 0, json.stderr);
      const consumerReport = JSON.parse(await readFile(consumerJson, 'utf8'));
      assert.equal(consumerReport.stats.expected, 1);
      assert.equal(consumerReport.stats.unexpected, 1);
      const results = consumerReport.suites.flatMap(suite => suite.specs).map(spec => ({
        title: spec.title,
        results: spec.tests.flatMap(test => test.results.map(result => result.status)),
      }));
      assert.deepEqual(results.sort((a, b) => a.title.localeCompare(b.title)), [
        { title: 'control result', results: ['passed'] },
        { title: 'playground result', results: ['failed'] },
      ]);
      completed = true;
    });
  } finally {
    if (completed) await rm(directory, { recursive: true, force: true });
    else t.diagnostic(`Validation fixture and subprocess diagnostics retained at ${directory}`);
  }
});
