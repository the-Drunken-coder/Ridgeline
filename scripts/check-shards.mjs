import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function cases(report) {
  const found = [];
  function visit(suite, parents) {
    const titles = [...parents, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        found.push({ key: JSON.stringify([spec.file, ...titles, spec.title, test.projectName]), results: test.results });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  }
  for (const suite of report.suites) visit(suite, []);
  return found;
}

export function checkShards(discovery, reports, shardCount = 4) {
  if (reports.length !== shardCount) throw new Error(`Expected ${shardCount} shard reports, received ${reports.length}`);
  const expected = cases(discovery).map(test => test.key);
  if (!expected.length || new Set(expected).size !== expected.length) throw new Error('Discovery must contain unique cases');
  const seen = new Set();
  for (const report of reports) {
    const executed = cases(report);
    if (!executed.length) throw new Error('A shard received no cases');
    for (const test of executed) {
      if (!expected.includes(test.key)) throw new Error(`Unexpected case: ${test.key}`);
      if (seen.has(test.key)) throw new Error(`Duplicated case: ${test.key}`);
      if (test.results.length !== 1 || test.results[0].retry !== 0 || !['passed', 'failed', 'timedOut'].includes(test.results[0].status)) {
        throw new Error(`Case did not execute exactly once: ${test.key}`);
      }
      seen.add(test.key);
    }
  }
  const missing = expected.filter(key => !seen.has(key));
  if (missing.length) throw new Error(`Missing cases: ${missing.join(', ')}`);
  return seen.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [discovery, ...reports] = await Promise.all(process.argv.slice(2).map(async path => JSON.parse(await readFile(path, 'utf8'))));
  console.log(`Verified ${checkShards(discovery, reports)} cases across ${reports.length} shards.`);
}
