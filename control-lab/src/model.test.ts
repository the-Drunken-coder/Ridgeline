import { describe, expect, it } from 'vitest';
import { createScene, reducer, toScreen, toWorld, zoomAt } from './model';

describe('everyday map', () => {
  it('requires a selected unit and an armed move before placing an order', () => {
    let scene = createScene();
    scene = reducer(scene, { type: 'move', point: { x: 100, y: 200 } });
    expect(scene.units[0]).toMatchObject({ x: 315, y: 375 });
    scene = reducer(scene, { type: 'select', id: 'alpha', additive: true });
    scene = reducer(scene, { type: 'arm' });
    expect(scene.armed).toBe(false);
    scene = reducer(scene, { type: 'select', id: 'bravo', additive: false });
    scene = reducer(scene, { type: 'arm' });
    scene = reducer(scene, { type: 'move', point: { x: 100, y: 200 } });
    expect(scene.units[0]).toMatchObject({ x: 315, y: 375 });
    expect(scene.units[1]).toMatchObject({ x: 100, y: 200 });
    expect(scene.trails[0]?.points).toEqual([{ x: 485, y: 290 }, { x: 100, y: 200 }]);
    expect(scene.armed).toBe(false);
  });

  it('moves a group with spacing, and reset restores the sample scene', () => {
    let scene = reducer(createScene(), { type: 'select', id: 'bravo', additive: true });
    scene = reducer(scene, { type: 'arm' });
    scene = reducer(scene, { type: 'move', point: { x: 500, y: 600 } });
    expect(scene.units.slice(0, 2).map(({ x, y }) => ({ x, y }))).toEqual([{ x: 480, y: 600 }, { x: 520, y: 600 }]);
    expect(reducer(scene, { type: 'reset' }).units).toEqual(createScene().units);
  });

  it('cancels an armed destination without moving units', () => {
    const armed = reducer(createScene(), { type: 'arm' });
    const scene = reducer(armed, { type: 'cancel' });
    expect(scene.armed).toBe(false);
    expect(scene.units).toEqual(createScene().units);
  });

  it('leaves targeting mode when the last selected unit is deselected', () => {
    const armed = reducer(createScene(), { type: 'arm' });
    const scene = reducer(armed, { type: 'select', id: 'alpha', additive: true });
    expect(scene.selected).toEqual([]);
    expect(scene.armed).toBe(false);
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
