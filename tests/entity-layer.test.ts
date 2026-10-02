import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomRenderMethodInput, Map as GLMap } from 'maplibre-gl';
import { EntityLayer } from '../src/entity-layer';

test('null entity buffer allocation reports once and explicit retry renders only current geometry', () => {
  const noop = () => {};
  let available = false, allocations = 0, draws = 0, deletedBuffers = 0, deletedPrograms = 0;
  const gl = {
    createBuffer: () => { allocations++; return available ? {} : null; }, createProgram: () => ({}), createShader: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getAttribLocation: () => 0, getUniformLocation: () => ({}),
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop, deleteShader: noop,
    deleteBuffer: () => { deletedBuffers++; }, deleteProgram: () => { deletedPrograms++; },
    useProgram: noop, bindBuffer: noop, bufferData: noop, uniformMatrix4fv: noop, uniform4f: noop, uniform4fv: noop,
    uniform1f: noop, uniform2f: noop, uniform1i: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop,
    enable: noop, blendFunc: noop, disable: noop, depthMask: noop, drawArrays: () => { draws++; },
    drawingBufferWidth: 1000, drawingBufferHeight: 1000,
  } as unknown as WebGL2RenderingContext;
  const map = { getCanvas: () => ({ clientWidth: 1000, clientHeight: 1000 }), getCenter: () => ({ lng: 0 }),
    getTerrain: () => null, unproject: () => ({ lng: 0, lat: 0 }), triggerRepaint: noop } as unknown as GLMap;
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
    uniformMatrix4fv: noop, uniform4f: noop, uniform4fv: noop, uniform1f: noop,
    uniform2f: noop, uniform1i: noop, enableVertexAttribArray: noop,
    vertexAttribPointer: noop, enable: noop, blendFunc: noop, disable: noop,
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
