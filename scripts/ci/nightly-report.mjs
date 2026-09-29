import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const nightlyScenarios = [
  'Destroy during initialization, repeat destroy, then remount',
  'Late terrain preparation cannot affect a replacement viewport',
  'Real pointer drawing previews stay ephemeral, snap, and place circle and rotated rectangle',
  'Raster tile arrivals recover camera coverage despite unrelated missing terrain',
];
export const nightlyRepeats = 10;
export const nightlyShards = 2;

// Titles and project names identify scenarios across moves, repetitions, and revisions.
export async function reportNightly({ directory, repository, revision, runId, serverUrl, token, apiUrl = 'https://api.github.com', outcome }) {
  const failures = new Map();
  const counts = new Map(nightlyScenarios.map(title => [title, 0]));
  const incomplete = [];
  for (let shard = 1; shard <= nightlyShards; shard++) {
    try {
      const report = JSON.parse(await readFile(`${directory}/nightly-${shard}.json`, 'utf8'));
      if (!Array.isArray(report.suites) || !Array.isArray(report.errors)) throw new Error('Invalid Playwright report');
      if (report.errors.length) incomplete.push(`Shard ${shard} reported runner errors`);
      function visit(suites) {
        for (const suite of suites) {
          for (const spec of suite.specs ?? []) {
            if (!counts.has(spec.title)) throw new Error(`Unexpected scenario: ${spec.title}`);
            for (const test of spec.tests) {
              counts.set(spec.title, counts.get(spec.title) + 1);
              if (test.status !== 'expected' || test.results.length !== 1 || test.results[0].status !== 'passed') {
                const identity = `${test.projectName ?? ''}\n${spec.title}`;
                failures.set(identity, { title: spec.title, detail: JSON.stringify(test.results, null, 2).slice(0, 12_000) });
              }
            }
          }
          visit(suite.suites ?? []);
        }
      }
      visit(report.suites);
    } catch (error) {
      incomplete.push(`Shard ${shard}: ${error.message}`);
    }
  }
  for (const [title, count] of counts) {
    if (count !== nightlyRepeats) incomplete.push(`${title}: expected ${nightlyRepeats} executions, found ${count}`);
  }
  if (outcome !== 'success' && failures.size === 0) incomplete.push(`Browser job outcome: ${outcome}`);
  if (incomplete.length) failures.set('nightly-infrastructure', { title: 'Incomplete nightly execution', detail: incomplete.join('\n') });
  if (!failures.size) return;

  async function request(path, method = 'GET', body) {
    const response = await fetch(`${apiUrl}/repos/${repository}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed: ${response.status} ${await response.text()}`);
    return response.json();
  }
  async function list(path) {
    const items = [];
    for (let page = 1; ; page++) {
      const batch = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Invalid GitHub list response');
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }
  // The workflow serializes this operation. List issues directly, avoiding search indexing delays.
  const issues = await list('/issues?state=open');
  const runUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
  const runMarker = `<!-- nightly-run:${runId} -->`;
  for (const [identity, failure] of failures) {
    const marker = `<!-- ridgeline-nightly:${createHash('sha256').update(identity).digest('hex')} -->`;
    const body = `${marker}\n${runMarker}\nScenario: ${failure.title}\n\nRevision: ${revision}\n\n[Workflow run](${runUrl}) · [Reports, traces and screenshots](${runUrl}#artifacts)\n\n<details><summary>Failure evidence</summary>\n\n\`\`\`text\n${failure.detail.replaceAll('```', "'''")}\n\`\`\`\n</details>\n\nA passing run does not close this issue. Resolve the underlying cause before closing.`;
    const existing = issues.find(issue => !issue.pull_request && issue.body?.includes(marker));
    if (!existing) {
      issues.push(await request('/issues', 'POST', { title: `[Nightly] ${failure.title}`, body }));
    } else if (!existing.body.includes(runMarker)) {
      const comments = await list(`/issues/${existing.number}/comments`);
      if (!comments.some(comment => comment.body?.includes(runMarker))) await request(`/issues/${existing.number}/comments`, 'POST', { body });
    }
  }
  if (incomplete.length) throw new Error(`Nightly results are incomplete:\n${incomplete.join('\n')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await reportNightly({
    directory: process.argv[2] ?? 'reports', repository: process.env.GITHUB_REPOSITORY,
    revision: process.env.NIGHTLY_REVISION, runId: process.env.GITHUB_RUN_ID,
    serverUrl: process.env.GITHUB_SERVER_URL, token: process.env.GITHUB_TOKEN,
    outcome: process.env.NIGHTLY_OUTCOME,
  });
}
