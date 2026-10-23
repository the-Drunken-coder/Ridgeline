import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomRenderMethodInput, Map as GLMap } from 'maplibre-gl';
import { EntityLayer } from '../src/entity-layer';
import type { AirbornePrimitive } from '../src/entity-primitives';

for (const mode of ['triangles', 'lines'] as const) {
  for (const globe of [false, true]) {
    test(`${mode} picking keeps coherent geometry together in ${globe ? 'globe fallback' : 'flat'} projection`, () => {
      const noop = () => {};
      let longitude = 179;
      const map = { getCanvas: () => ({ clientWidth: 1000, clientHeight: 1000 }), getCenter: () => ({ lng: longitude }),
        getTerrain: () => null,
        _camera: { transform: { clone: () => ({ screenPointToLocation: () => ({ lng: 0, lat: 0 }) }) } }, unproject: () => ({ lng: longitude, lat: 0 }), triggerRepaint: noop } as unknown as GLMap;
      const gl = {
        createBuffer: () => ({}), createProgram: () => ({}), createShader: () => ({}),
        getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0, getUniformLocation: () => ({}),
        shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop,
        deleteShader: noop, deleteBuffer: noop, deleteProgram: noop, useProgram: noop, bindBuffer: noop, bufferData: noop,
        uniformMatrix4fv: noop, uniform3f: noop, uniform4f: noop, uniform4fv: noop, uniform1f: noop, uniform2f: noop, uniform1i: noop,
        enableVertexAttribArray: noop, vertexAttribPointer: noop, enable: noop, blendFunc: noop, blendFuncSeparate: noop, disable: noop,
        depthMask: noop, drawArrays: noop, drawingBufferWidth: 1000, drawingBufferHeight: 1000,
      } as unknown as WebGL2RenderingContext;
      const layer = new EntityLayer(cause => { throw cause; });
      const pixelRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
      Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
      try {
        layer.onAdd(map, gl);
        const primitives: AirbornePrimitive[] = [
          { entityId: 'volume', mode: 'points', vertices: [[0, 0, 1_000_000]], color: [0, 0, 1, 1] },
          { entityId: 'volume', attachmentId: 'face', mode, color: [1, 0, 0, 1],
            vertices: mode === 'lines' ? [[-2, 0, 1_000_000], [2, 0, 1_000_000]]
              : [[-2, -2, 1_000_000], [2, -2, 1_000_000], [2, 2, 1_000_000],
                [-2, -2, 1_000_000], [2, 2, 1_000_000], [-2, 2, 1_000_000]] },
          { entityId: 'other', mode: 'points', vertices: [[90, 20, 1_000_000]], color: [0, 0, 1, 1] },
        ];
        for (const reversed of [false, true]) {
          layer.set(reversed ? [...primitives].reverse() : primitives, 1);
          for (longitude of [179, -179]) {
            const flat = [1.6, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, -1.6 * (longitude + 180) / 360, -1, 0, 1];
            const sphere = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
            const input = { shaderData: { variantName: globe ? 'globe' : 'flat', define: globe ? '#define GLOBE' : '', vertexShaderPrelude: '' },
              defaultProjectionData: { mainMatrix: globe ? sphere : flat, fallbackMatrix: flat,
                clippingPlane: [0, 0, 1, 1], projectionTransition: globe ? .25 : 0 },
            } as unknown as CustomRenderMethodInput;
            layer.render(gl, input);
            assert.deepEqual(layer.pick(500, 500, 1), [], `Empty center must reject ${longitude}/${reversed}`);
            const visible = layer.project([0, 0, 1_000_000]);
            assert.ok(visible);
            assert.ok(layer.pick(visible.x, visible.y, 1).some(hit => hit.attachmentId === 'face'), 'Visible coherent attachment must remain pickable');
          }
        }
      } finally {
        layer.onRemove();
        if (pixelRatio) Object.defineProperty(globalThis, 'devicePixelRatio', pixelRatio);
        else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
      }
    });
  }
}

test('null entity buffer allocation reports once and explicit retry renders only current geometry', () => {
  const noop = () => {};
  let available = false, allocations = 0, draws = 0, deletedBuffers = 0, deletedPrograms = 0;
  const gl = {
    createBuffer: () => { allocations++; return available ? {} : null; }, createProgram: () => ({}), createShader: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getAttribLocation: () => 0, getUniformLocation: () => ({}),
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop, deleteShader: noop,
    deleteBuffer: () => { deletedBuffers++; }, deleteProgram: () => { deletedPrograms++; },
    useProgram: noop, bindBuffer: noop, bufferData: noop, uniformMatrix4fv: noop, uniform3f: noop, uniform4f: noop, uniform4fv: noop,
    uniform1f: noop, uniform2f: noop, uniform1i: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop,
    enable: noop, blendFunc: noop, blendFuncSeparate: noop, disable: noop, depthMask: noop, drawArrays: () => { draws++; },
    drawingBufferWidth: 1000, drawingBufferHeight: 1000,
  } as unknown as WebGL2RenderingContext;
  const map = { getCanvas: () => ({ clientWidth: 1000, clientHeight: 1000 }), getCenter: () => ({ lng: 0 }),
    getTerrain: () => null,
    _camera: { transform: { clone: () => ({ screenPointToLocation: () => ({ lng: 0, lat: 0 }) }) } }, unproject: () => ({ lng: 0, lat: 0 }), triggerRepaint: noop } as unknown as GLMap;
  const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, -1, -1, 0, 1];
  const input = { shaderData: { variantName: 'flat', define: '', vertexShaderPrelude: '' },
    defaultProjectionData: { mainMatrix: matrix, fallbackMatrix: matrix, clippingPlane: [0, 0, 1, 1], projectionTransition: 0 },
  } as unknown as CustomRenderMethodInput;
  const errors: unknown[] = [];
  const layer = new EntityLayer(cause => errors.push(cause));
  const pixelRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
  try {
    layer.onAdd(map, gl);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /entity.*buffer/i);
    layer.set([{ entityId: 'removed', mode: 'points', vertices: [[0, 0, 100]], color: [1, 0, 0, 1] }], 1);
    layer.render(gl, input); layer.render(gl, input);
    assert.equal(allocations, 1, 'Rendering must not retry allocation automatically');
    assert.equal(draws, 0);
    layer.set([{ entityId: 'current', mode: 'points', vertices: [[0, 0, 100]], color: [1, 0, 0, 1] }], 1);
    available = true;
    layer.retry();
    layer.render(gl, input);
    assert.equal(allocations, 2);
    assert.equal(draws, 1);
    assert.deepEqual(layer.pick(500, 500, 1).map(hit => hit.entityId), ['current']);
    layer.onRemove(); layer.onRemove(); layer.retry(); layer.render(gl, input);
    assert.equal(allocations, 2, 'Detached layer must not allocate after retry');
    assert.equal(deletedBuffers, 1);
    assert.equal(deletedPrograms, 1);
    assert.equal(draws, 1);
    available = false;
    const incomplete = new EntityLayer(cause => errors.push(cause));
    incomplete.onAdd(map, gl);
    incomplete.onRemove(); incomplete.onRemove();
    available = true;
    incomplete.retry(); incomplete.render(gl, input);
    assert.equal(allocations, 3, 'Destroyed incomplete resources must not resurrect');
    assert.equal(deletedBuffers, 1);
    assert.equal(deletedPrograms, 1);
  } finally {
    layer.onRemove();
    if (pixelRatio) Object.defineProperty(globalThis, 'devicePixelRatio', pixelRatio);
    else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
  }
});

test('picks the visible part of a face whose third vertex crosses the near plane', () => {
  const canvas = { clientWidth: 1000, clientHeight: 1000 };
  const map = {
    getCanvas: () => canvas,
    getCenter: () => ({ lng: 0 }),
    getTerrain: () => null,
    _camera: { transform: { clone: () => ({ screenPointToLocation: () => ({ lng: 0, lat: 0 }) }) } },
    unproject: () => ({ lng: 0, lat: 0 }),
    triggerRepaint: () => {},
  } as unknown as GLMap;
  const noop = () => {};
  let failProgram = false;
  let drawCalls = 0;
  const gl = {
    createBuffer: () => ({}), createProgram: () => failProgram ? null : ({}), createShader: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getAttribLocation: () => 0, getUniformLocation: () => ({}),
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop,
    deleteShader: noop, deleteBuffer: noop, deleteProgram: noop, useProgram: noop, bindBuffer: noop, bufferData: noop,
    uniformMatrix4fv: noop, uniform3f: noop, uniform4f: noop, uniform4fv: noop, uniform1f: noop,
    uniform2f: noop, uniform1i: noop, enableVertexAttribArray: noop,
    vertexAttribPointer: noop, enable: noop, blendFunc: noop, blendFuncSeparate: noop, disable: noop,
    depthMask: noop, drawArrays: () => { drawCalls++; },
    drawingBufferWidth: 1000, drawingBufferHeight: 1000,
  } as unknown as WebGL2RenderingContext;
  const matrix = [5000, 0, 0, 0, 0, 5000, 0, 0, 0, 0, -40000, 0, -2500, -2500, -0.5, 1];
  const input = {
    shaderData: { variantName: 'flat', define: '', vertexShaderPrelude: '' },
    defaultProjectionData: { mainMatrix: matrix, fallbackMatrix: matrix, clippingPlane: [0, 0, 1, 1], projectionTransition: 0 },
  } as unknown as CustomRenderMethodInput;
  const errors: unknown[] = [];
  const layer = new EntityLayer(cause => errors.push(cause));
  const pixelRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
  try {
    layer.onAdd(map, gl);
    layer.set([{ entityId: 'aircraft', attachmentId: 'face', mode: 'triangles',
      vertices: [[0, 0, 1000], [0.05, 0, 0], [0, -0.05, 0]], color: [1, 0, 0, 0.5] }], 1);
    layer.render(gl, input);
    assert.deepEqual(errors, []);
    assert.equal(layer.project([0, 0, 1000]), null);
    assert.deepEqual(layer.pick(700, 400, 0).map(hit => [hit.entityId, hit.attachmentId]), [['aircraft', 'face']]);

    layer.set([{ entityId: 'aircraft', attachmentId: 'ray', mode: 'lines',
      vertices: [[0, 0, 1000], [0.05, 0, 0]], color: [1, 0, 0, 1] }], 1);
    assert.equal(layer.pick(700, 500, 2).some(hit => hit.attachmentId === 'ray'), false, 'Prepared lines are not displayed');
    layer.render(gl, input);
    assert.deepEqual(layer.pick(700, 500, 2).map(hit => [hit.entityId, hit.attachmentId]), [['aircraft', 'ray']]);

    const changedProjection = { ...input, shaderData: { ...input.shaderData, variantName: 'changed' } };
    failProgram = true;
    layer.render(gl, changedProjection);
    assert.equal(errors.length, 1);
    const beforeRetry = drawCalls;
    layer.render(gl, changedProjection);
    assert.equal(drawCalls, beforeRetry);
    failProgram = false;
    layer.retry();
    layer.render(gl, changedProjection);
    assert.equal(drawCalls, beforeRetry + 1);
    assert.equal(errors.length, 1);
  } finally {
    layer.onRemove();
    if (pixelRatio) Object.defineProperty(globalThis, 'devicePixelRatio', pixelRatio);
    else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
  }
});

function completedFrameFixture(report: (error: unknown, layer: EntityLayer) => void = () => {}) {
  const ratio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
  const noop = () => {};
  let fail = false, draws = 0;
  const canvas = { clientWidth: 1000, clientHeight: 1000 };
  const uniforms = new Map<string, number[]>();
  const gl = { createBuffer: () => ({}), createProgram: () => fail ? null : ({}), createShader: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: (_program: unknown, name: string) => name,
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop,
    deleteShader: noop, deleteBuffer: noop, deleteProgram: noop, useProgram: noop, bindBuffer: noop, bufferData: noop,
    uniformMatrix4fv: noop, uniform3f: noop, uniform4f: noop, uniform4fv: noop,
    uniform1f: (name: string, value: number) => uniforms.set(name, [value]),
    uniform2f: (name: string, x: number, y: number) => uniforms.set(name, [x, y]), uniform1i: noop,
    enableVertexAttribArray: noop, vertexAttribPointer: noop, enable: noop, blendFuncSeparate: noop, disable: noop,
    depthMask: noop, drawArrays: () => draws++, drawingBufferWidth: 2000, drawingBufferHeight: 1999,
  } as unknown as WebGL2RenderingContext;
  const map = { getCanvas: () => canvas, getCenter: () => ({ lng: 0 }), getTerrain: () => null,
    _camera: { transform: { clone: () => ({ screenPointToLocation: () => ({ lng: 0, lat: 0 }) }) } },
    unproject: () => ({ lng: 0, lat: 0 }), triggerRepaint: noop } as unknown as GLMap;
  const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, -1, -1, 0, 1];
  const input = { shaderData: { variantName: 'flat', define: '', vertexShaderPrelude: '' },
    defaultProjectionData: { mainMatrix: matrix, fallbackMatrix: matrix, clippingPlane: [0, 0, 1, 1], projectionTransition: 0 },
  } as unknown as CustomRenderMethodInput;
  const layer = new EntityLayer(error => report(error, layer));
  layer.onAdd(map, gl);
  return { layer, gl, canvas, input, uniforms, draws: () => draws,
    dispose() { layer.onRemove();
      if (ratio) Object.defineProperty(globalThis, 'devicePixelRatio', ratio);
      else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
    },
    fail(value: boolean) { fail = value; },
    render(variant = 'flat') { layer.render(gl, { ...input, shaderData: { ...input.shaderData, variantName: variant } }); } };
}
const face: AirbornePrimitive = { entityId: 'old', attachmentId: 'face', mode: 'triangles', color: [1, 0, 0, 1],
  vertices: [[-20, -20, 100], [20, -20, 100], [0, 20, 100]] };
const point: AirbornePrimitive = { entityId: 'new', mode: 'points', color: [0, 1, 0, 1], size: 20, vertices: [[36, 0, 100]] };
const center = { minX: 498, minY: 498, maxX: 502, maxY: 502 };

test('set retains the last completed geometry projection and vertical scale until a successful render', () => {
  const f = completedFrameFixture();
  try {
    f.layer.set([face], 1);
    assert.deepEqual(f.layer.pick(500, 500, 0), []);
    f.render();
    assert.deepEqual(f.layer.pick(500, 500, 0).map(hit => hit.attachmentId), ['face']);
    const projected = f.layer.project([0, 0, 100]);
    assert.ok(projected);
    f.layer.set([point], 3);
    assert.deepEqual(f.layer.pick(500, 500, 0).map(hit => hit.attachmentId), ['face']);
    assert.deepEqual(f.layer.query(center).map(hit => hit.attachmentId), ['face']);
    assert.deepEqual(f.layer.pick(600, 500, 0), []);
    assert.deepEqual(f.layer.project([0, 0, 100]), projected);
    f.render();
    assert.deepEqual(f.layer.pick(600, 500, 0).map(hit => hit.entityId), ['new']);
    assert.deepEqual(f.layer.query(center), []);
    assert.equal(f.layer.project([0, 0, 100])?.depth, projected.depth * 3);
    f.layer.set([], 2);
    assert.deepEqual(f.layer.pick(600, 500, 0).map(hit => hit.entityId), ['new']);
    f.render();
    assert.deepEqual(f.layer.pick(600, 500, 0), []);
    assert.equal(f.layer.project([0, 0, 100]), null);
  } finally { f.dispose(); }
});

for (const afterSuccess of [false, true]) {
  test(`entity render failure ${afterSuccess ? 'after success' : 'on first frame'} clears hits before diagnostics and retry waits for a draw`, () => {
    const diagnostics: { hits: unknown[]; query: unknown[] }[] = [];
    const f = completedFrameFixture((error, layer) => {
      assert.match(String(error), /entity shader/);
      diagnostics.push({ hits: layer.pick(500, 500, 0), query: layer.query(center) });
    });
    try {
      if (afterSuccess) { f.layer.set([face], 1); f.render(); assert.equal(f.layer.pick(500, 500, 0).length, 1); }
      f.layer.set([face], 2);
      f.fail(true);
      f.render('failed');
      assert.deepEqual(diagnostics, [{ hits: [], query: [] }]);
      assert.equal(f.layer.project([0, 0, 100]), null);
      const failedDraws = f.draws();
      f.render('failed');
      assert.equal(f.draws(), failedDraws);
      f.fail(false);
      f.layer.retry();
      assert.deepEqual(f.layer.pick(500, 500, 0), []);
      f.render('failed');
      assert.deepEqual(f.layer.pick(500, 500, 0).map(hit => hit.attachmentId), ['face']);
      f.layer.onRemove();
      assert.deepEqual(f.layer.pick(500, 500, 0), []);
      assert.deepEqual(f.layer.query(center), []);
    } finally { f.dispose(); }
  });
}

test('completed point suppression follows the model-coordinated draw and transparent geometry has no hits', () => {
  const f = completedFrameFixture();
  const marker: AirbornePrimitive = { ...point, vertices: [[0, 0, 100]] };
  try {
    f.layer.set([marker, { ...face, color: [1, 0, 0, 0] }], 1);
    f.render();
    assert.deepEqual(f.layer.pick(500, 500, 0).map(hit => hit.entityId), ['new']);
    f.layer.suppressPoints(new Set(['new']));
    assert.deepEqual(f.layer.pick(500, 500, 0).map(hit => hit.entityId), ['new']);
    f.render();
    assert.deepEqual(f.layer.pick(500, 500, 0), []);
    f.layer.suppressPoints(new Set());
    assert.deepEqual(f.layer.query(center), []);
    f.render();
    assert.deepEqual(f.layer.query(center).map(hit => hit.entityId), ['new']);
  } finally { f.dispose(); }
});

test('entity sizes use independent drawing-buffer scales and collapsed canvases cannot retain hits', () => {
  const f = completedFrameFixture();
  try {
    f.layer.set([{ ...point, vertices: [[0, 0, 100]] }], 1);
    f.render();
    assert.deepEqual(f.uniforms.get('u_point_size'), [40]);
    assert.deepEqual(f.uniforms.get('u_viewport'), [1000, 1000]);
    assert.deepEqual(f.uniforms.get('u_point_scale'), [1, 2 / 1.999]);
    assert.equal(f.layer.pick(508, 500, 0).length, 1);
    f.canvas.clientWidth = 0;
    const draws = f.draws();
    f.render();
    assert.equal(f.draws(), draws);
    assert.deepEqual(f.layer.pick(500, 500, 0), []);
    assert.deepEqual(f.layer.query(center), []);
  } finally {
    f.dispose();
  }
});
