import { createDrawingSession, createViewport, RidgelineError } from '@ridgeline/map';
import type { DrawingChange, MapFeature, Properties, Viewport } from '@ridgeline/map';
import type { StyleSpecification } from 'maplibre-gl';

type Context = {
  container: HTMLElement;
  setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string): Promise<void>;
};
const basemap: StyleSpecification = { version: 8, sources: {}, layers: [
  { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
] };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function point(id: string, properties: Properties = {}): MapFeature {
  return { type: 'Feature', id, properties, geometry: { type: 'Point', coordinates: [0, 0] } };
}
function rejected(action: () => unknown, code: RidgelineError['code']) {
  let error: unknown;
  try { action(); } catch (cause) { error = cause; }
  check(error instanceof RidgelineError && error.code === code, `Expected ${code}, received ${String(error)}`);
  return error;
}
function bytesOf(feature: MapFeature | undefined) {
  check(feature?.properties.bytes instanceof Uint8Array, 'Required snapshot bytes missing');
  return feature.properties.bytes;
}
function sharedBytes() {
  check(crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined',
    'Shared snapshot cases require per-case COOP/COEP response headers');
  const bytes = new Uint8Array(new SharedArrayBuffer(8), 2, 4);
  bytes.set([1, 2, 3, 4]);
  return bytes;
}

export const snapshotReviewCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Snapshot review rejects invalid retained geometry atomically and keys by the cloned ID', async run({ container, setCurrent }) {
    class ComputedFeature {
      readonly type = 'Feature';
      readonly id = 'computed';
      readonly properties = {};
      get geometry(): MapFeature['geometry'] { return { type: 'Point', coordinates: [0, 0] }; }
    }
    rejected(() => createViewport({ container, basemap, features: [new ComputedFeature()], logger: () => {} }), 'INITIALIZATION_FAILED');
    check(container.querySelectorAll('canvas').length === 0, 'Invalid initial snapshot created a renderer');
    const viewport = createViewport({ container, basemap, features: [point('accepted', { revision: 1 })], logger: () => {} });
    setCurrent(viewport);
    try {
      await viewport.ready;
      viewport.setSelection(['accepted']);
      let changes = 0;
      const off = viewport.on('datachange', () => { changes++; });
      try {
        rejected(() => viewport.upsert([point('accepted', { revision: 2 }), point('new'), new ComputedFeature()]), 'INVALID_FEATURE');
        check(Object.is(changes, 0), 'Invalid batch emitted datachange');
        check(viewport.getFeature('accepted')?.properties.revision === 1, 'Invalid batch partly changed accepted data');
        check(viewport.getFeatures().length === 1 && !viewport.getFeature('computed') && !viewport.getFeature('new'), 'Invalid snapshot was retained');
        check(JSON.stringify(viewport.getSelection()) === '["accepted"]', 'Invalid batch changed consumer selection');
        let idReads = 0, geometryReads = 0;
        const ownGetter: MapFeature = {
          ...point('unused'), get id() { return `snapshot-${++idReads}`; },
          get geometry(): MapFeature['geometry'] { geometryReads++; return { type: 'Point', coordinates: [1, 1] }; },
        };
        viewport.upsert([ownGetter]);
        check(idReads === 1 && geometryReads === 1, 'Own snapshot getters were evaluated more than once');
        const saved = viewport.getFeature('snapshot-1');
        check(saved?.id === 'snapshot-1' && JSON.stringify(saved.geometry) === '{"type":"Point","coordinates":[1,1]}', 'Cloned identity and geometry were not retained together');
        check(viewport.getFeatures().length === 2 && changes === 1, 'Valid own getter feature did not publish once');
      } finally { off(); }
    } finally { viewport.destroy(); }
  } },
  { name: 'Snapshot review validates initial and updated model settings on the retained candidate', async run({ container, setCurrent }) {
    const invalid: MapFeature = { ...point('invalid'), entity: { model: { id: 'asset', switchDistanceMeters: 1 } } };
    rejected(() => createViewport({ container, basemap, features: [invalid], logger: () => {} }), 'INITIALIZATION_FAILED');
    check(container.querySelectorAll('canvas').length === 0, 'Invalid initial model settings created a renderer');
    function candidate(id: string) {
      let reads = 0;
      const feature: MapFeature = { ...point(id), entity: { model: {
        id: 'asset', get switchDistanceMeters() { return ++reads <= 2 ? 1000 : 1; },
      } } };
      return { feature, reads: () => reads };
    }
    const initial = candidate('initial');
    const viewport = createViewport({ container, basemap, features: [initial.feature], logger: () => {} });
    setCurrent(viewport);
    try {
      await viewport.ready;
      check(initial.reads() === 1 && viewport.getFeature('initial')?.entity?.model?.switchDistanceMeters === 1000,
        'Initial model validation read a different value from the retained settings');
      const updated = candidate('updated');
      viewport.upsert([updated.feature]);
      check(updated.reads() === 1 && viewport.getFeature('updated')?.entity?.model?.switchDistanceMeters === 1000,
        'Upsert model validation read a different value from the retained settings');
      let changes = 0;
      const off = viewport.on('datachange', () => { changes++; });
      try {
        rejected(() => viewport.upsert([point('initial', { replaced: true }), invalid]), 'INVALID_FEATURE');
        check(changes === 0 && viewport.getFeatures().length === 2, 'Invalid effective settings partly committed the batch');
        check(viewport.getFeature('initial')?.entity?.model?.switchDistanceMeters === 1000, 'Invalid settings replaced an accepted model');
      } finally { off(); }
    } finally { viewport.destroy(); }
  } },
  { name: 'Snapshot review isolates shared and ordinary buffers across public reads and callbacks', async run({ container, setCurrent, until }) {
    const shared = sharedBytes();
    const ordinary = new Uint8Array([1, 2, 3, 4]);
    const callbackInputs: MapFeature[] = [];
    const viewport = createViewport({ container, basemap, camera: { center: [0, 0], zoom: 14 }, logger: () => {},
      style(feature) {
        callbackInputs.push(feature);
        bytesOf(feature)[0] = 23;
        return { radius: 6, color: '#216e5b' };
      },
      name(feature) {
        callbackInputs.push(feature);
        bytesOf(feature)[0] = 31;
        return feature.id;
      },
    });
    setCurrent(viewport);
    try {
      await viewport.ready;
      let changes = 0;
      const off = viewport.on('datachange', () => { changes++; });
      try {
        for (const [id, bytes] of [['shared', shared], ['ordinary', ordinary]] as const) {
          const input = point(id, { bytes, repeated: bytes, buffer: bytes.buffer });
          viewport.upsert([input]);
          bytes[0] = 7;
          const snapshot = viewport.getFeature(id);
          check(snapshot && bytesOf(snapshot)[0] === 1, `${id} input changed accepted memory`);
          check(snapshot.properties.bytes === snapshot.properties.repeated && bytesOf(snapshot).buffer === snapshot.properties.buffer,
            `${id} snapshot lost view identity or backing aliases`);
          check(viewport.getName(snapshot) === id, 'Name callback result lost');
          check(viewport.getStyle(snapshot).radius === 6, 'Style callback result lost');
          check(bytesOf(snapshot)[0] === 1, `${id} callbacks changed their caller's snapshot`);
          bytesOf(snapshot)[0] = 9;
          const listed = viewport.getFeatures().find(feature => feature.id === id);
          check(bytesOf(listed)[0] === 1, `${id} read changed accepted memory`);
          bytesOf(listed)[0] = 11;
          check(bytesOf(viewport.getFeature(id))[0] === 1, `${id} list exposed accepted memory`);
        }
        await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:points'] }).length >= 2, 'snapshot features published');
        check(callbackInputs.length >= 4, 'Required name and style callbacks were not reached');
        for (const feature of callbackInputs) bytesOf(feature)[0] = 41;
        check(bytesOf(viewport.getFeature('shared'))[0] === 1 && bytesOf(viewport.getFeature('ordinary'))[0] === 1,
          'Retained callback arguments changed accepted memory');
        check(shared[0] === 7 && ordinary[0] === 7 && changes === 2, 'Snapshot reads or callbacks changed input memory or emitted datachange');
      } finally { off(); }
    } finally { viewport.destroy(); }
  } },
  { name: 'Snapshot review drawing state permissions history and submission isolate shared memory', async run({ container, setCurrent }) {
    const bytes = sharedBytes();
    const viewport = createViewport({ container, basemap, logger: () => {} });
    setCurrent(viewport);
    const requests: DrawingChange[] = [], permissions: MapFeature[] = [];
    const editor = createDrawingSession(viewport, {
      createFeature: () => ({ id: 'drawing', properties: { bytes } }),
      canEdit(feature) { permissions.push(feature); bytesOf(feature)[0] = 19; return true; },
      submit(change) {
        requests.push(change);
        if (change.before) bytesOf(change.before)[0] = 23;
        bytesOf(change.after)[0] = 29;
        return { accepted: true };
      },
    });
    try {
      await viewport.ready;
      editor.start('line');
      bytes[0] = 7;
      check(bytesOf(editor.getState().draft?.feature)[0] === 1, 'Factory shared memory escaped into the draft');
      bytesOf(editor.getState().draft?.feature)[0] = 11;
      editor.addPoint([0, 0]); editor.addPoint([1, 0]); editor.refreshPermissions();
      check(permissions.length > 0 && bytesOf(editor.getState().draft?.feature)[0] === 1, 'State or permission snapshots changed the draft');
      check(await editor.finish(), 'Shared-memory drawing was not accepted');
      check(bytesOf(viewport.getFeature('drawing'))[0] === 1, 'Create submit argument changed accepted drawing');
      editor.edit('drawing');
      const state = editor.getState();
      bytesOf(state.draft?.before)[0] = 13;
      bytesOf(state.draft?.feature)[0] = 17;
      editor.moveVertex(1, [2, 0]); editor.undo(); editor.redo();
      check(bytesOf(editor.getState().draft?.before)[0] === 1 && bytesOf(editor.getState().draft?.feature)[0] === 1,
        'Shared memory leaked through edit baselines or draft history');
      for (const feature of permissions) bytesOf(feature)[0] = 31;
      check(await editor.finish(), 'Shared-memory update was not accepted');
      check(requests.length === 2 && requests[1]?.kind === 'update', 'Required create and update submissions were not reached');
      check(bytesOf(requests[1]?.before)[0] === 23 && bytesOf(requests[1]?.after)[0] === 29, 'Submission mutations were not exercised');
      const accepted = viewport.getFeature('drawing');
      check(bytesOf(accepted)[0] === 1 && JSON.stringify(accepted?.geometry) === '{"type":"LineString","coordinates":[[0,0],[2,0]]}',
        'Submit snapshots changed accepted properties or geometry');
      check(bytes[0] === 7 && accepted?.drawing?.version === 1, 'Shared snapshots changed factory memory or drawing metadata');
    } finally { editor.destroy(); viewport.destroy(); }
  } },
];
