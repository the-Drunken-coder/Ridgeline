import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nightlyScenarios, nightlyRepeats, reportNightly } from './ci/nightly-report.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nightly-report-'));
  const issues = [];
  const comments = new Map();
  let writesRemaining = Infinity;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET') {
      const commentNumber = url.pathname.match(/issues\/(\d+)\/comments$/)?.[1];
      const items = commentNumber ? comments.get(Number(commentNumber)) ?? [] : issues;
      const start = (Number(url.searchParams.get('page')) - 1) * 100;
      res.end(JSON.stringify(items.slice(start, start + 100)));
    } else if (req.method === 'POST') {
      if (writesRemaining === 0) { res.writeHead(403); res.end('{}'); return; }
      writesRemaining--;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const commentNumber = url.pathname.match(/issues\/(\d+)\/comments$/)?.[1];
      if (commentNumber) {
        const existing = comments.get(Number(commentNumber)) ?? [];
        existing.push(body);
        comments.set(Number(commentNumber), existing);
      } else {
        body.number = issues.length + 1;
        body.state = 'open';
        issues.push(body);
      }
      res.writeHead(201);
      res.end(JSON.stringify(body));
    } else { res.writeHead(405); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  async function results(failed = [], { retry = false, moved = false, omit = false } = {}) {
    const specs = nightlyScenarios.map((title, index) => ({ title, file: moved ? 'moved.spec.ts' : 'browser.spec.ts', line: moved ? 99 : 1,
      tests: Array.from({ length: nightlyRepeats }, (_, repeatEachIndex) => {
        const bad = failed.includes(index);
        return { projectName: 'chromium', repeatEachIndex, status: bad ? (retry ? 'flaky' : 'unexpected') : 'expected', results: bad ? [{ status: 'failed', error: { message: 'Controlled failure' } }, ...(retry ? [{ status: 'passed' }] : [])] : [{ status: 'passed' }] };
      }),
    }));
    await writeFile(join(directory, 'nightly-1.json'), JSON.stringify({ suites: [{ specs: omit ? [] : specs.slice(0, 2) }], errors: [] }));
    await writeFile(join(directory, 'nightly-2.json'), JSON.stringify({ suites: [{ specs: specs.slice(2) }], errors: [] }));
  }
  const report = (runId, outcome = 'failure') => reportNightly({ directory, repository: 'example/ridgeline', revision: 'abc123', runId, outcome, serverUrl: 'https://github.com', apiUrl: `http://127.0.0.1:${server.address().port}`, token: 'test-token' });
  return { directory, issues, comments, results, report,
    rejectWrites: (after = 0) => { writesRemaining = after; },
    allowWrites: () => { writesRemaining = Infinity; },
  };
}

test('HTTP integration: first failure, recurrence, reruns, distinct scenarios, and later pass', async t => {
  const f = await fixture(t);
  // Exercise pagination rather than relying on GitHub search indexing.
  for (let number = 1; number <= 101; number++) f.issues.push({ number, body: 'Unrelated', state: 'open' });
  await f.results([0]);
  await f.report('1');
  assert.equal(f.issues.length, 102);
  const issue = f.issues[101];
  assert.match(issue.body, /abc123/);
  assert.match(issue.body, /actions\/runs\/1#artifacts/);
  await f.report('1');
  assert.equal(f.comments.size, 0);
  await f.results([0], { moved: true });
  await f.report('2');
  await f.report('2');
  assert.equal(f.issues.length, 102);
  assert.equal(f.comments.get(issue.number).length, 1);
  await f.results([0, 1], { retry: true });
  await f.report('3');
  assert.equal(f.issues.length, 103);
  await f.results();
  await f.report('4', 'success');
  assert.equal(f.issues.length, 103);
  assert.ok(f.issues.every(issue => issue.state === 'open'));
});

test('missing and incomplete reports create an infrastructure issue and fail visibly', async t => {
  const f = await fixture(t);
  await f.results();
  await rm(join(f.directory, 'nightly-2.json'));
  await assert.rejects(f.report('1'), /results are incomplete/);
  assert.equal(f.issues.length, 1);
  assert.match(f.issues[0].body, /Shard 2/);
  await f.results([], { omit: true });
  await assert.rejects(f.report('2'), /expected 10 executions, found 0/);
  assert.equal(f.issues.length, 1);
  assert.equal(f.comments.get(1).length, 1);
});

test('runner failure with passing reports is still tracked', async t => {
  const f = await fixture(t);
  await f.results();
  await assert.rejects(f.report('1'), /Browser job outcome: failure/);
  assert.equal(f.issues.length, 1);
});

test('nightly completeness requires distinct, valid repetitions for each scenario and project', async t => {
  for (const variant of ['duplicate', 'out-of-range', 'missing-index', 'split-projects', 'cross-shard-duplicate']) {
    await t.test(variant, async t => {
      const f = await fixture(t);
      await f.results();
      const path = join(f.directory, 'nightly-1.json');
      const report = JSON.parse(await readFile(path, 'utf8'));
      const tests = report.suites[0].specs[0].tests;
      if (variant === 'duplicate') tests.forEach(test => { test.repeatEachIndex = 0; });
      if (variant === 'out-of-range') tests[0].repeatEachIndex = nightlyRepeats;
      if (variant === 'missing-index') delete tests[0].repeatEachIndex;
      if (variant === 'split-projects') tests[0].projectName = 'other-project';
      if (variant === 'cross-shard-duplicate') {
        tests.splice(nightlyRepeats / 2);
        const secondPath = join(f.directory, 'nightly-2.json');
        const second = JSON.parse(await readFile(secondPath, 'utf8'));
        second.suites[0].specs.push(structuredClone(report.suites[0].specs[0]));
        await writeFile(secondPath, JSON.stringify(second));
      }
      await writeFile(path, JSON.stringify(report));
      await assert.rejects(f.report('1', 'success'), /results are incomplete/);
      assert.equal(f.issues.length, 1);
      assert.match(f.issues[0].title, /Incomplete nightly execution/);
    });
  }
});

test('distinct repetitions distributed across shards complete without creating issues', async t => {
  const f = await fixture(t);
  await f.results();
  const paths = [1, 2].map(shard => join(f.directory, `nightly-${shard}.json`));
  const reports = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const specs = reports.flatMap(report => report.suites[0].specs);
  for (let shard = 0; shard < 2; shard++) {
    reports[shard].suites[0].specs = specs.map(spec => ({
      ...spec, tests: spec.tests.filter(test => test.repeatEachIndex % 2 === shard),
    }));
    await writeFile(paths[shard], JSON.stringify(reports[shard]));
  }
  await f.report('1', 'success');
  assert.equal(f.issues.length, 0);
  assert.equal(f.comments.size, 0);
});

test('GitHub issue-writing failures reject instead of silently losing follow-up', async t => {
  const f = await fixture(t);
  await f.results([0]);
  f.rejectWrites();
  await assert.rejects(f.report('1'), /GitHub POST .* failed: 403/);
});

test('reporting resumes after a partial write without duplicate issues or recurrence comments', async t => {
  const f = await fixture(t);
  await f.results([0, 1]);
  f.rejectWrites(1);
  await assert.rejects(f.report('1'), /GitHub POST .* failed: 403/);
  assert.equal(f.issues.length, 1);
  const first = structuredClone(f.issues[0]);
  f.allowWrites();
  await f.report('1');
  assert.equal(f.issues.length, 2);
  assert.deepEqual(f.issues[0], first);
  assert.notEqual(f.issues[0].title, f.issues[1].title);
  assert.equal(f.comments.size, 0);

  f.rejectWrites(1);
  await assert.rejects(f.report('2'), /GitHub POST .* failed: 403/);
  assert.equal(f.comments.get(1).length, 1);
  assert.equal(f.comments.has(2), false);
  f.allowWrites();
  await f.report('2');
  await f.report('2');
  assert.equal(f.issues.length, 2);
  assert.equal(f.comments.get(1).length, 1);
  assert.equal(f.comments.get(2).length, 1);
});
