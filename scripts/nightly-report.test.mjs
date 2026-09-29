import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nightlyScenarios, nightlyRepeats, reportNightly } from './ci/nightly-report.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nightly-report-'));
  const issues = [];
  const comments = new Map();
  let rejectWrites = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET') {
      const commentNumber = url.pathname.match(/issues\/(\d+)\/comments$/)?.[1];
      const items = commentNumber ? comments.get(Number(commentNumber)) ?? [] : issues;
      const start = (Number(url.searchParams.get('page')) - 1) * 100;
      res.end(JSON.stringify(items.slice(start, start + 100)));
    } else if (req.method === 'POST') {
      if (rejectWrites) { res.writeHead(403); res.end('{}'); return; }
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
  return { directory, issues, comments, results, report, rejectWrites: () => { rejectWrites = true; } };
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

test('GitHub issue-writing failures reject instead of silently losing follow-up', async t => {
  const f = await fixture(t);
  await f.results([0]);
  f.rejectWrites();
  await assert.rejects(f.report('1'), /GitHub POST .* failed: 403/);
});
