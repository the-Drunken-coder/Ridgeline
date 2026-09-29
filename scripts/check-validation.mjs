import { pathToFileURL } from 'node:url';

export const requiredJobs = ['typecheck', 'module-tests', 'packaged-browser', 'control-browser', 'consumer-builds', 'browser-reports'];

export function checkValidation(needs) {
  const failures = requiredJobs.filter(name => needs[name]?.result !== 'success');
  if (failures.length) throw new Error(`Required validation did not succeed: ${failures.map(name => `${name}=${needs[name]?.result ?? 'missing'}`).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkValidation(JSON.parse(process.env.VALIDATION_NEEDS ?? '{}'));
  console.log('All required validation jobs succeeded.');
}
