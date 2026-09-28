import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RasterElevationSampler } from '../src/elevation-sampler';

test('raster readiness is local to failed tiles and resets on retry', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('tile failed'); };
  let reportFailure: (cause: unknown) => void = () => {};
  const failure = new Promise<unknown>(resolve => { reportFailure = resolve; });
  const sampler = new RasterElevationSampler(
    { tiles: ['https://example.test/{z}/{x}/{y}.png'], maxzoom: 1 },
    () => {},
    reportFailure,
  );
  try {
    assert.equal(sampler.sample(-90, -1), null);
    assert.match(String(await failure), /tile failed/);
    assert.equal(sampler.readiness([-90, -1], 1000), 'unavailable');
    assert.equal(sampler.readiness([90, -1], 1000), 'loading');
    assert.equal(sampler.readiness([179, -1], 300_000), 'unavailable');
    assert.equal(sampler.readiness([90, 86], 0), 'unavailable');
    sampler.retry();
    assert.equal(sampler.readiness([-90, -1], 1000), 'loading');
  } finally {
    sampler.destroy();
    globalThis.fetch = originalFetch;
  }
});

test('raster source failure makes every area unavailable', async () => {
  let reportFailure: (cause: unknown) => void = () => {};
  const failure = new Promise<unknown>(resolve => { reportFailure = resolve; });
  const sampler = new RasterElevationSampler({ tiles: [] }, () => {}, reportFailure);
  try {
    assert.equal(sampler.sample(0, 0), null);
    assert.match(String(await failure), /Elevation source needs tiles/);
    assert.equal(sampler.readiness([0, 0], 0), 'unavailable');
    assert.equal(sampler.readiness([90, 0], 0), 'unavailable');
  } finally {
    sampler.destroy();
  }
});
