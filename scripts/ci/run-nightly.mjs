import { spawnSync } from 'node:child_process';
import { nightlyScenarios, nightlyRepeats, nightlyShards } from './nightly-report.mjs';

const shard = Number(process.argv[2]);
if (!Number.isInteger(shard) || shard < 1 || shard > nightlyShards) throw new Error('Expected nightly shard 1 or 2');
const grep = nightlyScenarios.map(title => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const result = spawnSync(process.execPath, ['scripts/test-browser.mjs', '--fully-parallel', `--grep=${grep}`, `--repeat-each=${nightlyRepeats}`, `--shard=${shard}/${nightlyShards}`, '--reporter=list,json,html'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
