import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Playwright's built-in JSON omits repeatEachIndex. Preserve it from TestCase
// so completeness checks can distinguish repeated executions from duplicates.
export default class NightlyJsonReporter {
  tests = [];
  errors = [];

  onBegin(_config, suite) {
    this.tests = suite.allTests();
  }

  onError(error) {
    this.errors.push(error);
  }

  async onEnd() {
    const path = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
    if (!path) throw new Error('Nightly JSON output path is required');
    const specs = this.tests.map(test => ({
      title: test.title,
      tests: [{
        projectName: test.parent.project()?.name ?? '',
        repeatEachIndex: test.repeatEachIndex,
        status: test.outcome(),
        results: test.results.map(result => ({
          status: result.status, retry: result.retry, errors: result.errors,
          attachments: result.attachments.map(({ name, contentType, path }) => ({ name, contentType, path })),
        })),
      }],
    }));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ suites: [{ specs }], errors: this.errors }));
  }
}
