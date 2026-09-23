import { describe, expect, it } from 'vitest';
import { createScene, lineFormation, parseCommand, reducer, toScreen, toWorld, zoomAt, type Point } from './model';

describe('orders and selection', () => {
  it('captures queue recipients and executes their orders in sequence', () => {
    let scene = createScene('plan');
    scene = reducer(scene, { type: 'move', point: { x: 100, y: 200 } });
    scene = reducer(scene, { type: 'select', ids: ['bravo'] });
    scene = reducer(scene, { type: 'move', point: { x: 500, y: 600 } });
    scene = reducer(scene, { type: 'select', ids: ['alpha'] });
    scene = reducer(scene, { type: 'move', point: { x: 300, y: 400 } });
    expect(scene.units[0]).toMatchObject({ x: 315, y: 375 });
    scene = reducer(scene, { type: 'execute' });
    expect(scene.units[0]).toMatchObject({ id: 'alpha', x: 300, y: 400 });
    expect(scene.units[1]).toMatchObject({ id: 'bravo', x: 500, y: 600 });
    expect(scene.orders).toHaveLength(0);
    expect(scene.trails[2]?.points[0]).toEqual({ x: 100, y: 200 });
  });

  it('holding one unit removes only that recipient from a group order', () => {
    let scene = reducer(createScene('plan'), { type: 'select', ids: ['alpha', 'bravo'] });
    scene = reducer(scene, { type: 'move', point: { x: 200, y: 300 } });
    scene = reducer(scene, { type: 'hold', ids: ['alpha'] });
    expect(scene.orders[0]?.ids).toEqual(['bravo']);
    scene = reducer(scene, { type: 'execute' });
    expect(scene.units[0]).toMatchObject({ x: 315, y: 375 });
    expect(scene.units[1]).toMatchObject({ x: 200, y: 300 });
  });

  it('switching schemes preserves the scene and queue but discards unfinished gestures', () => {
    let scene = reducer(createScene(), { type: 'move', point: { x: 600, y: 200 } });
    scene = reducer(scene, { type: 'scheme', scheme: 'plan' });
    scene = reducer(scene, { type: 'move', point: { x: 800, y: 400 } });
    scene = reducer(scene, { type: 'route', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    scene = reducer(scene, { type: 'scheme', scheme: 'rts' });
    expect(scene.units[0]).toMatchObject({ x: 600, y: 200 });
    expect(scene.orders).toHaveLength(1);
    expect(scene.route).toEqual([]);
  });

  it('additive selection has no duplicate units and changes cancel a route preview', () => {
    let scene = reducer(createScene('route'), { type: 'route', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] });
    scene = reducer(scene, { type: 'select', ids: ['alpha', 'bravo'], additive: true });
    expect(scene.selected).toEqual(['alpha', 'bravo']);
    expect(scene.route).toEqual([]);
  });

  it('sending a route keeps its bends as a trail and moves only selected units', () => {
    const points: Point[] = [{ x: 100, y: 100 }, { x: 200, y: 50 }, { x: 350, y: 250 }];
    const scene = reducer(reducer(createScene('route'), { type: 'route', points }), { type: 'send-route' });
    expect(scene.units[0]).toMatchObject({ x: 350, y: 250 });
    expect(scene.units[1]).toMatchObject({ x: 485, y: 290 });
    expect(scene.trails[0]?.points.slice(1)).toEqual(points);
    expect(scene.route).toEqual([]);
  });

  it('formation preview does not move units until committed', () => {
    const placements = lineFormation(['alpha', 'bravo', 'charlie'], { x: 100, y: 200 }, { x: 700, y: 200 });
    let scene = reducer(createScene('formation'), { type: 'formation', placements });
    expect(scene.units[0]?.x).toBe(315);
    scene = reducer(scene, { type: 'apply-formation' });
    expect(scene.units.map(unit => unit.x)).toEqual([100, 400, 700]);
    expect(lineFormation(['alpha'], { x: 0, y: 0 }, { x: 100, y: 200 })).toEqual([{ id: 'alpha', x: 50, y: 100 }]);
  });

  it('empty selection cannot issue an order', () => {
    const scene = reducer(reducer(createScene('plan'), { type: 'select', ids: [] }), { type: 'move', point: { x: 1, y: 1 } });
    expect(scene.orders).toEqual([]);
    expect(scene.message).toBe('Select at least one unit.');
  });
});

describe('camera', () => {
  it('zooms around the pointer without moving the world point under it', () => {
    const viewport = { width: 828, height: 540 };
    const camera = { x: 125, y: -37, zoom: 1.8 };
    const anchor = { x: 177, y: 423 };
    const world = toWorld(anchor, camera, viewport);
    for (const factor of [1.2, 100, 0.001]) {
      const zoomed = zoomAt(camera, viewport, anchor, factor);
      const projected = toScreen(world, zoomed, viewport);
      expect(projected.x).toBeCloseTo(anchor.x);
      expect(projected.y).toBeCloseTo(anchor.y);
      expect(zoomed.zoom).toBeGreaterThanOrEqual(0.5);
      expect(zoomed.zoom).toBeLessThanOrEqual(4);
    }
  });
});

describe('command grammar', () => {
  it('normalizes input and parses grid coordinates', () => {
    expect(parseCommand('  ALPHA   to B2  ')).toEqual({ kind: 'move', ids: ['alpha'], destination: { column: 1, row: 1 } });
    expect(parseCommand('all to beacon')).toEqual({ kind: 'move', ids: ['alpha', 'bravo', 'charlie'], destination: 'beacon' });
    expect(parseCommand('hold bravo')).toEqual({ kind: 'hold', ids: ['bravo'] });
  });

  it.each(['alpha to D4', 'alpha to B0', 'unknown to beacon', 'all to beacon; hold all', '', '<script>'])('rejects unsupported command %j', input => {
    expect(parseCommand(input).kind).toBe('error');
  });
});
