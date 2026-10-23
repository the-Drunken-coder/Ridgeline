import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@ridgeline/map/style.css';
import { browserCases } from './catalog';
import { caseModules } from './case-modules';
import type { BrowserCaseContext, BrowserViewport } from './context';
import { createCaseFixture } from './fixture';
import { until } from './helpers';
import { createCaseRegistry } from './registry';

setWorkerUrl(workerUrl);
const container = document.querySelector<HTMLDivElement>('#map')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const fixture = createCaseFixture<BrowserViewport>(viewport => {
  // Capture before lifecycle cases deliberately destroy their viewport.
  void viewport.ready.then(() => {
    const gl = viewport.map.getCanvas().getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    Reflect.set(window, 'browserEnvironment', {
      userAgent: navigator.userAgent, platform: navigator.platform,
      touchPoints: navigator.maxTouchPoints, devicePixelRatio,
      renderer: gl ? gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) : null,
      vendor: gl ? gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR) : null,
    });
  }).catch(() => {});
});
window.cleanupBrowserCase = () => fixture.cleanup();

async function run() {
  const registry = createCaseRegistry<BrowserCaseContext>(browserCases, caseModules);
  const selectedCase = new URLSearchParams(location.search).get('case');
  if (!selectedCase) {
    status.dataset.state = 'ready';
    status.textContent = 'Consumer fixture ready. Run cases with pnpm test:browser.';
    return;
  }
  status.dataset.state = 'running';
  const row = document.createElement('li');
  row.textContent = selectedCase;
  results.append(row);
  try {
    await registry.run(selectedCase, () => ({ container, until, own: fixture.own }));
    row.className = 'pass';
    row.textContent = `PASS: ${selectedCase}`;
    status.dataset.state = 'passed';
    status.textContent = `${selectedCase} passed through the installed package.`;
  } catch (error) {
    row.className = 'fail';
    row.textContent = `FAIL: ${selectedCase}: ${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)}`;
    throw error;
  }
}
void run().catch(error => {
  status.dataset.state = 'failed';
  status.textContent = `Failed: ${error instanceof Error ? error.stack : String(error)}`;
});
