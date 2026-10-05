import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const started = new Date().toISOString();
const artifacts = resolve(root, '.artifacts/validation/model-measurement', `run-${started.replaceAll(':', '-')}-${process.pid}`);
await mkdir(artifacts, { recursive: true });
const contextPath = resolve(artifacts, 'context.json');
const contextErrors = [];
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    contextErrors.push(`git ${args.join(' ')}: ${result.error?.message ?? result.stderr}`);
    return null;
  }
  return result.stdout;
}
let prHeadRevision = null;
if (process.env.GITHUB_EVENT_PATH) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    prHeadRevision = event.pull_request?.head?.sha ?? null;
  } catch (error) {
    contextErrors.push(`Read GitHub event: ${error.message}`);
  }
}
const diff = git('diff', 'HEAD');
const context = {
  started, command: ['pnpm', 'test:measurement'], checkout: root,
  revision: git('rev-parse', 'HEAD')?.trim() ?? null,
  sourceStatus: git('status', '--short'),
  diffSha256: diff === null ? null : createHash('sha256').update(diff).digest('hex'),
  prHeadRevision, workflowRevision: process.env.GITHUB_SHA ?? null,
  runUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT ?? '1'}` : null,
  node: process.version, contextErrors, stages: [],
};
const saveContext = () => writeFile(contextPath, JSON.stringify(context, null, 2));
await saveContext();
console.log(`Measurement command context and producer output: ${artifacts}`);

// CI records checkout context before installing dependencies or the browser.
if (!process.argv.includes('--record-context')) {
  try {
    const tests = (await readdir(resolve(root, 'tools/model-measurement')))
      .filter(name => name.endsWith('.test.ts')).sort().map(name => `tools/model-measurement/${name}`);
    if (!tests.length) throw new Error('No measurement report/workload/pixel tests found.');
    const stages = [
      ['--import', 'tsx', '--test', ...tests],
      ['--test', 'tools/model-measurement/instrumentation.test.mjs'],
    ];
    for (const [index, args] of stages.entries()) {
      const result = spawnSync(process.execPath, args, { cwd: root, timeout: 240_000, maxBuffer: 32 * 1024 * 1024 });
      const stdout = `${index + 1}.stdout.log`, stderr = `${index + 1}.stderr.log`;
      await writeFile(resolve(artifacts, stdout), result.stdout ?? Buffer.alloc(0));
      await writeFile(resolve(artifacts, stderr), result.stderr ?? Buffer.alloc(0));
      context.stages.push({ command: [process.execPath, ...args], status: result.status,
        signal: result.signal, error: result.error?.message ?? null, stdout, stderr });
      await saveContext();
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.error || result.signal || result.status !== 0) {
        process.exitCode = result.status || 1;
        break;
      }
    }
  } catch (error) {
    context.error = error.message;
    process.exitCode = 1;
    console.error(error);
  } finally {
    context.finished = new Date().toISOString();
    await saveContext();
  }
}
