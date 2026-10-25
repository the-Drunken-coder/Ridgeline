import { test } from 'playwright/test';
import type { CDPSession, Page } from 'playwright/test';
import { open, writeFile } from 'node:fs/promises';

const title = 'Reliability drawing date-line storage snapping and reload globe with terrain';
const categories = ['toplevel', 'blink.user_timing', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame', 'renderer.scheduler', 'scheduler', 'sequence_manager',
  'v8', 'disabled-by-default-v8.cpu_profiler', 'gpu', 'viz', 'cc'];

async function bounded<T>(work: Promise<T>, milliseconds: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Diagnostic deadline exceeded during ${operation}`)), Math.max(1, milliseconds));
    })]);
  } finally { clearTimeout(timer); }
}

export function registerDateLineDiagnostics(source: { revision: string; status: string; diffSha256: string; command: string[] }) {
  const sessions = new Map<Page, { session: CDPSession; bufferUsage: unknown[] }>();
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.title !== title) return;
    const session = await bounded(page.context().newCDPSession(page), 5_000, 'CDP attach');
    const bufferUsage: unknown[] = [];
    sessions.set(page, { session, bufferUsage });
    session.on('Tracing.bufferUsage', event => { if (bufferUsage.length < 128) bufferUsage.push(event); });
    await page.addInitScript(() => { window.dateLineDiagnosticEnabled = true; });
    await bounded(session.send('Tracing.start', {
      transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'gzip', bufferUsageReportingInterval: 1000,
      traceConfig: { recordMode: 'recordUntilFull', traceBufferSizeInKb: 131072, enableSampling: true, includedCategories: categories },
    }), 5_000, 'Tracing.start');
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.title !== title) return;
    const capture = sessions.get(page);
    sessions.delete(page);
    const deadline = Date.now() + 18_000;
    const errors: string[] = [];
    const provenance = { source, originalRuntimeRevision: 'c747d780d2dcf73efed2a2857d4cb1cb48cd6121',
      test: testInfo.titlePath, status: testInfo.status, retry: testInfo.retry, repeatEachIndex: testInfo.repeatEachIndex,
      workerIndex: testInfo.workerIndex, browserVersion: page.context().browser()?.version(),
      categories, bufferLimitKiB: 131072, cleanupLimitMs: 20_000, bufferUsage: capture?.bufferUsage,
      observerLimits: { control: 4096, map: 1024, longtask: 256, terminalEvents: 10 },
      limitations: ['observerMs counts record and user-timing mark cost only, excluding tracing and listener dispatch',
        'source events are not exact worker settlement or per-update publication acknowledgement',
        'render events do not establish visible pixels or compositor presentation',
        'the current task can finish after Long Tasks observation stops'],
      captureDateNow: Date.now(), nodeVersion: process.version, errors };
    try {
      const observation = await bounded(page.evaluate(() => {
        window.stopDateLineDiagnostic?.();
        return { timeline: window.dateLineTimeline ?? null, environment: Reflect.get(window, 'browserEnvironment'),
          timeOrigin: performance.timeOrigin, now: performance.now(), dateNow: Date.now(), visibility: document.visibilityState };
      }), 5_000, 'page timeline retrieval');
      await writeFile(testInfo.outputPath('date-line-timeline.json'), JSON.stringify(observation, null, 2));
    } catch (error) { errors.push(String(error)); }
    if (capture) {
      const { session } = capture;
      let stream: string | undefined;
      try {
        const complete = new Promise<{ stream?: string; dataLossOccurred?: boolean }>(resolve => session.once('Tracing.tracingComplete', resolve));
        await bounded(session.send('Tracing.end'), deadline - Date.now(), 'Tracing.end');
        const result = await bounded(complete, deadline - Date.now(), 'Tracing.tracingComplete');
        stream = result.stream;
        if (!stream) throw new Error('Chromium returned no trace stream');
        const file = await open(testInfo.outputPath('date-line-chrome.json.gz'), 'w');
        try {
          while (true) {
            const chunk = await bounded(session.send('IO.read', { handle: stream, size: 1024 * 1024 }), deadline - Date.now(), 'IO.read');
            await file.write(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
            if (chunk.eof) break;
          }
        } finally { await file.close(); }
        if (result.dataLossOccurred) throw new Error('Chromium reported trace data loss');
      } catch (error) { errors.push(String(error)); }
      finally {
        if (stream) await bounded(session.send('IO.close', { handle: stream }), 1_000, 'IO.close').catch(error => errors.push(String(error)));
        await bounded(session.detach(), 1_000, 'CDP detach').catch(error => errors.push(String(error)));
      }
    } else errors.push('Target diagnostic CDP session was not created');
    await writeFile(testInfo.outputPath('date-line-provenance.json'), JSON.stringify(provenance, null, 2));
    if (errors.length) throw new Error(`Date-line diagnostic capture incomplete: ${errors.join('; ')}`);
  });
}
