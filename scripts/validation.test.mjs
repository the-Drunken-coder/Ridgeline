import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('actual Playwright shard reports cover every case and preserve failures', async () => {
  const directory = await mkdtemp(resolve('.validation-fixture-'));
  try {
    await writeFile(`${directory}/playwright.config.mjs`, `export default { testDir: '.', fullyParallel: true, workers: 1, retries: 0, outputDir: './results' };`);
    await writeFile(`${directory}/cases.spec.mjs`, `import { test, expect } from 'playwright/test';
      for (let i = 0; i < 8; i++) test('case ' + i, () => expect(i).not.toBe(0));`);
    function run(args, env = {}) {
      return spawnSync('pnpm', ['exec', 'playwright', 'test', '-c', `${directory}/playwright.config.mjs`, ...args], {
        encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000,
      });
    }
    const discovery = run(['--list', '--reporter=json']);
    assert.equal(discovery.status, 0, discovery.stderr);
    const expected = JSON.parse(discovery.stdout);
    const reports = [];
    for (let shard = 1; shard <= 4; shard++) {
      const path = `${directory}/${shard}.json`;
      const result = run([`--shard=${shard}/4`, '--reporter=json,blob'], {
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
    const merged = spawnSync('pnpm', ['exec', 'playwright', 'merge-reports', '--reporter=json', `${directory}/combined`], {
      encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(merged.status, 0, merged.stderr);
    const combined = JSON.parse(merged.stdout);
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
