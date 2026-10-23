import assert from 'node:assert/strict';
import test from 'node:test';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { dashExpression, featureStyle, fontExpression, highlightExpression, nativeExpressions, nativeVisibility, resolveHighlight, resolveNativeAppearance, styleProperties } from '../src/feature-style';
import { clipToRectangle, screenRectangle } from '../src/screen-rectangle';
import { modelPresentationGeometry } from '../src/model-presentation';
import type { FeatureStyle } from '../src/types';

test('styles snapshot nested presentation data and reject invalid fields before renderer publication', () => {
  const font = ['Noto Sans Regular'], offset: [number, number] = [1, -2], dash = [4, 1, 1, 1];
  const input: FeatureStyle = { labelStyle: { font, offset, size: 18, anchor: 'bottom' },
    dashArray: dash, selected: { color: '#ff0000', fillOpacity: .6 }, iconSize: 2, iconAnchor: 'bottom' };
  const snapshot = featureStyle(input);
  font[0] = 'changed'; offset[0] = 8; dash[0] = 9; input.selected!.color = '#000000';
  assert.deepEqual(snapshot.labelStyle, { font: ['Noto Sans Regular'], offset: [1, -2], size: 18, anchor: 'bottom' });
  assert.deepEqual(snapshot.dashArray, [4, 1, 1, 1]); assert.equal(snapshot.selected?.color, '#ff0000');
  for (const style of [{ labelStyle: { size: 0 } }, { labelStyle: { haloWidth: -1 } }, { labelStyle: { font: [] } },
    { labelStyle: { offset: [NaN, 0] as [number, number] } }, { labelStyle: { color: 'not-a-color' } }, { iconSize: 0 },
    { iconRotation: Infinity }, { dashArray: [] }, { dashArray: [0, 0] }, { dashArray: [-1, 2] },
    { selected: { fillOpacity: 2 } }, { hover: { radius: -1 } }, { selected: { modelBrightness: -1 } },
    { hover: { modelBrightness: Infinity } }, { selected: { modelBrightness: 1.01 } }] satisfies FeatureStyle[]) assert.throws(() => featureStyle(style));
});

test('disabled feedback retains base appearance without changing selected identity and explicit zero brightening wins', () => {
  const expression = createExpression(highlightExpression('lineWidth', 3, 5, 12), 'layers[0].paint.line-width');
  assert.equal(expression.result, 'success');
  if (expression.result !== 'success') throw new Error('Highlight expression did not compile.');
  const disabled = featureStyle({ selected: { enabled: false }, hover: { lineWidth: 20 } });
  assert.equal(expression.value.evaluate({ zoom: 1 }, { type: 2, properties: styleProperties(disabled) }, { selected: true, hover: true }), 3);
  const hoverDisabled = featureStyle({ hover: { enabled: false, lineWidth: 20 } });
  assert.equal(expression.value.evaluate({ zoom: 1 }, { type: 2, properties: styleProperties(hoverDisabled) }, { hover: true }), 3);
  assert.equal(expression.value.evaluate({ zoom: 1 }, { type: 2, properties: styleProperties(hoverDisabled) }, { selected: true, hover: true }), 5);
  assert.deepEqual(resolveHighlight(disabled, true, true).selected, false);
  const feedback = resolveHighlight({ selected: { modelBrightness: 0, color: undefined }, hover: { modelBrightness: .8, color: '#ff0000' } }, true, true);
  assert.equal(feedback.appearance.modelBrightness, 0);
  assert.equal(feedback.appearance.color, '#ff0000');
});

test('sparse dash, font and offset arrays are rejected before they can enter native expressions', () => {
  const dash = new Array<number>(2); dash[1] = 1;
  const font = new Array<string>(2); font[1] = 'Noto Sans Regular';
  const offset: [number, number] = [0, 1]; Reflect.deleteProperty(offset, '0');
  for (const style of [{ dashArray: dash }, { labelStyle: { font } }, { labelStyle: { offset } }] satisfies FeatureStyle[])
    assert.throws(() => featureStyle(style));
});

test('literal dash branches support distinct per-feature patterns and legacy dashed fallback', () => {
  const input = [{ dashArray: [1, 1] }, { dashArray: [4, 2] }, { dashed: true }];
  const parsed = createExpression(dashExpression(input), 'layers[0].paint.line-dasharray');
  assert.equal(parsed.result, 'success');
  if (parsed.result !== 'success') throw new Error('Dash expression did not compile.');
  for (const style of input) assert.deepEqual(parsed.value.evaluate({ zoom: 1 }, { type: 2, properties: styleProperties(style) }), style.dashArray ?? [3, 2]);
  const fonts: FeatureStyle[] = [{ labelStyle: { font: ['Custom Regular', 'Fallback Regular'] } }, {}];
  const font = createExpression(fontExpression(fonts), 'layers[0].layout.text-font', { type: 'array', value: 'string', 'property-type': 'data-driven', transition: false });
  assert.equal(font.result, 'success');
  if (font.result !== 'success') throw new Error('Font expression did not compile.');
  for (const style of fonts) assert.deepEqual(font.value.evaluate({ zoom: 1 }, { type: 1, properties: styleProperties(style) }), style.labelStyle?.font ?? ['Noto Sans Regular']);
  const highlight = createExpression(highlightExpression('color', '#000000', undefined, '#db6a20'), 'layers[0].paint.line-color');
  assert.equal(highlight.result, 'success');
  if (highlight.result !== 'success') throw new Error('Highlight expression did not compile.');
  const feature = { type: 1 as const, properties: styleProperties({ selected: { color: '#0000ff' }, hover: { color: '#ff0000' } }) };
  assert.equal(highlight.value.evaluate({ zoom: 1 }, feature, { selected: true, hover: true }), '#0000ff');
  assert.equal(highlight.value.evaluate({ zoom: 1 }, feature, { hover: true }), '#ff0000');
});

test('rectangle intersection catches crossing edges and containing polygons without testing their centers', () => {
  const rectangle = screenRectangle([{ x: 15, y: 15 }, { x: 5, y: 5 }]);
  const point = (x: number, y: number) => ({ x, y, depth: .5 });
  assert.ok(clipToRectangle([point(-100, 10), point(100, 10)], rectangle).length);
  assert.ok(clipToRectangle([point(0, 0), point(20, 0), point(20, 20), point(0, 20)], rectangle).length);
  assert.equal(clipToRectangle([point(0, 0), point(3, 0), point(3, 3)], rectangle).length, 0);
  assert.throws(() => screenRectangle([{ x: NaN, y: 0 }, { x: 10, y: 10 }]));
});

test('model labels clear projected bodies in the configured anchor direction and text-size units', () => {
  const frame = { id: 'model', hasLabel: true, anchor: { x: 100, y: 100, depth: 0 }, labelAnchor: { x: 100, y: 100, depth: 0 },
    box: { minX: 90, minY: 90, maxX: 110, maxY: 110 } };
  const top = modelPresentationGeometry({ ...frame, labelStyle: { size: 24, anchor: 'top', offset: [2, 0] } });
  assert.equal(top.labelOffset[0], 2); assert.ok(top.labelOffset[1] * 24 >= top.radius + 10);
  const left = modelPresentationGeometry({ ...frame, labelStyle: { size: 18, anchor: 'right' } });
  assert.ok(left.labelOffset[0] < 0); assert.equal(left.labelOffset[1], 0);
  const centered = modelPresentationGeometry({ ...frame, labelStyle: { anchor: 'center', offset: [1, 2] } });
  assert.deepEqual(centered.labelOffset, [1, 2]);
});

test('presentation captures each consumer property once before validating the published snapshot', () => {
  const changing = <T>(valid: T, invalid: T) => { let reads = 0; return () => ++reads === 1 ? valid : invalid; };
  const labelSize = changing(24, -10), selectedColor = changing('#ff0000', 'invalid'), baseColor = changing('#0000ff', 'invalid');
  const modelColor = changing('#00ff00', 'invalid');
  const dash = [1, 2]; Object.defineProperty(dash, 0, { enumerable: true, get: changing(1, -1) });
  const offset: [number, number] = [0, 1]; Object.defineProperty(offset, 0, { enumerable: true, get: changing(2, NaN) });
  const font = ['Noto Sans Regular']; Object.defineProperty(font, 0, { enumerable: true, get: changing('Noto Sans Regular', '') });
  const result = featureStyle({ get color() { return baseColor(); }, labelStyle: { get size() { return labelSize(); }, font, offset },
    selected: { get color() { return selectedColor(); } }, modelAppearance: { mode: 'color', get color() { return modelColor(); } }, dashArray: dash });
  assert.equal(result.color, '#0000ff'); assert.equal(result.labelStyle?.size, 24);
  assert.equal(result.selected?.color, '#ff0000'); assert.deepEqual(result.modelAppearance, { mode: 'color', color: '#00ff00' });
  assert.deepEqual(result.dashArray, [1, 2]); assert.deepEqual(result.labelStyle?.offset, [2, 1]); assert.deepEqual(result.labelStyle?.font, ['Noto Sans Regular']);
});

test('malformed offsets are rejected before snapshotting can discard their extra entries', () => {
  for (const offset of [[1, 2, 3], [1, 2, Infinity], [1], []]) {
    const style: FeatureStyle = { labelStyle: {} };
    Reflect.set(style.labelStyle!, 'offset', offset);
    assert.throws(() => featureStyle(style));
  }
});

test('native expressions and JavaScript appearance agree across per-field feedback and explicit zeros', () => {
  const styles: FeatureStyle[] = [
    {}, { selected: {}, hover: {} },
    { color: '#123456', radius: 20, lineWidth: 30, fillColor: 'rgba(0, 0, 255, 0)', fillOpacity: 0, labelStyle: { color: '#654321' } },
    { radius: 0, lineWidth: 0, fillOpacity: 0 },
    { selected: { color: '#ff0000', radius: 0, lineWidth: 0, fillColor: '#00000000', fillOpacity: 0, iconOpacity: 0, labelColor: '#00ff00' },
      hover: { color: '#0000ff', radius: 14, lineWidth: 15, fillColor: '#abcdef', fillOpacity: .9, iconOpacity: .8, labelColor: '#ffff00' } },
    { selected: { color: '#ff0000' }, hover: { radius: 0, lineWidth: 0, fillColor: '#abcdef', fillOpacity: 0, iconOpacity: 0, labelColor: '#ffff00' } },
    { selected: { radius: 0 }, hover: { color: '#ff0000' } },
    { selected: { enabled: false, color: '#ff0000', fillOpacity: 0 }, hover: { color: '#0000ff', fillOpacity: 0 } },
    { selected: { lineWidth: 0 }, hover: { enabled: false, radius: 0, color: '#0000ff', fillOpacity: 0 } },
    { selected: { enabled: false }, hover: { enabled: false } },
  ];
  const fields: (keyof typeof nativeExpressions)[] = ['fillColor', 'fillOpacity', 'lineColor', 'lineWidth', 'circleRadius', 'circleColor',
    'circleStrokeWidth', 'circleStrokeColor', 'iconOpacity', 'labelColor'];
  for (const key of fields) {
    const expression = createExpression(nativeExpressions[key], key);
    assert.equal(expression.result, 'success');
    if (expression.result !== 'success') throw new Error(`${key} did not compile.`);
    for (const [index, input] of styles.entries()) for (const selected of [false, true]) for (const hover of [false, true]) {
      const style = featureStyle(input);
      const expected = resolveNativeAppearance(style, selected, hover)[key];
      const actual = expression.value.evaluate({ zoom: 1 }, { type: 1, properties: styleProperties(style) }, { selected, hover });
      assert.equal(actual, expected, `${key}, style ${index}, selected ${selected}, hover ${hover}`);
    }
  }
  const selected = resolveNativeAppearance({ lineWidth: 30 }, true, false);
  assert.equal(selected.lineWidth, 30);
  assert.equal(selected.fillOpacity, .45);
  assert.equal(selected.circleStrokeColor, '#ffffff');
  const hovered = resolveNativeAppearance({}, false, true);
  assert.equal(hovered.lineColor, '#db6a20');
  assert.equal(hovered.circleColor, '#216e5b');
  assert.equal(hovered.circleRadius, 12);
  assert.equal(hovered.circleStrokeColor, '#db6a20');
});

test('native picking visibility preserves independent representations, CSS alpha and disabled feedback', () => {
  assert.deepEqual(nativeVisibility({ hover: { iconOpacity: 0 } }, false, true), { icon: false, fill: true });
  assert.deepEqual(nativeVisibility({ hover: { fillOpacity: 0 } }, false, true), { icon: true, fill: false });
  for (const fillColor of ['transparent', 'rgba(255, 0, 0, 0)', '#ff000000']) {
    const style: FeatureStyle = { fillColor, selected: { fillOpacity: 1 } };
    assert.deepEqual(nativeVisibility(style, true, false), { icon: true, fill: false });
    assert.deepEqual(nativeVisibility({ ...style, selected: { fillColor: '#ff0000', fillOpacity: .1 } }, true, false), { icon: true, fill: true });
  }
  assert.deepEqual(nativeVisibility({ selected: { enabled: false }, hover: { iconOpacity: 0, fillOpacity: 0 } }, true, true), { icon: true, fill: true });
  assert.deepEqual(nativeVisibility({ selected: { iconOpacity: 0, fillOpacity: 0 }, hover: { iconOpacity: 1, fillOpacity: 1 } }, true, true), { icon: false, fill: false });
  assert.deepEqual(nativeVisibility({ fillOpacity: 0, selected: { enabled: false } }, true, false), { icon: true, fill: false });
});
