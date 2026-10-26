import { createViewport } from '@ridgeline/map';
import type { BrowserCaseContext } from './context';
import { point, style } from './helpers';

export async function withBaseViewport(
  context: BrowserCaseContext,
  run: (base: Awaited<ReturnType<typeof createBaseViewport>>) => Promise<void>,
) {
  const base = await createBaseViewport(context);
  try { await run(base); }
  finally { base.viewport.destroy(); }
}

async function createBaseViewport({ container, own, until }: BrowserCaseContext) {
  const viewport = own(createViewport({ container, basemap: style(), camera: { center: [0,0], zoom: 8 },
    features: [point('initial')], style: feature => {
      if (feature.properties.broken) throw new Error('Broken style');
      return { color: feature.properties.color === 'red' ? '#ff0000' : '#008855',
        icon: typeof feature.properties.icon === 'string' ? feature.properties.icon : undefined };
    }, logger: () => {} }));
  const hits = () => viewport.map.queryRenderedFeatures({ layers: ['rl:points'] });
  viewport.upsert([point('queued')]);
  await viewport.ready;
  await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'base feature rendered');
  const featureState = (id: string) => {
    const sourceFeature = viewport.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === id);
    return sourceFeature?.id === undefined ? {} : viewport.map.getFeatureState({ source: 'rl:features', id: sourceFeature.id });
  };
  return { viewport, hits, featureState };
}
