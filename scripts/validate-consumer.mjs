import { resolve } from 'node:path';

/** Run every required consumer stage under the caller's existing process owner. */
export function validateConsumer(root, run) {
  const consumer = resolve(root, '.artifacts/consumer');
  run(['install', '--prefer-offline'], consumer);
  run(['build'], consumer);
  const starter = resolve(consumer, 'standalone/examples/starter');
  run(['install', '--prefer-offline'], starter);
  run(['build'], starter);
  run(['exec', 'node', 'scripts/check-package.mjs', '.artifacts/ridgeline-map-0.1.0.tgz'], root);
}
