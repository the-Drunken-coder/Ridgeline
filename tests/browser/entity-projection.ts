import { createViewport } from '@ridgeline/map';
import type { MapFeature } from '@ridgeline/map';
import type { CustomRenderMethodInput } from 'maplibre-gl';
import { style, point, check, pointer, pixelAt } from './helpers';
import type { BrowserCaseModule, BrowserCaseRun } from './context';

function meterScaleProjection(projection: "flat" | "globe"): BrowserCaseRun {
  return async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style('#ffffff'), projection,
      camera: { center: [6.87, 46], zoom: 18, pitch: 35, bearing: 23 },
      elevationSampler: { sample: () => 0 }, style: () => ({ color: '#ff0000', radius: 4 }), logger: () => {} }));
    await air.ready;
    let rendered: CustomRenderMethodInput | undefined;
    air.map.addLayer({ id: 'projection-reference', type: 'custom', renderingMode: '3d',
      render(_gl, input) { rendered = input; } });
    // This consumer reference evaluates geographic coordinates with double-precision
    // arithmetic directly against MapLibre's matrices, without library projection helpers.
    const reference = (lng: number, lat: number, height: number) => {
      if (!rendered) throw new Error('The renderer has not supplied a projection frame');
      const d = rendered.defaultProjectionData, radians = Math.PI / 180;
      const latitude = lat * radians, longitude = lng * radians;
      const world = Math.round((air.map.getCenter().lng - lng) / 360);
      const flat = [(lng + 180) / 360 + world,
        (1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI) / 2,
        height / (2 * Math.PI * 6371008.8 * Math.cos(latitude)), 1];
      const multiply = (matrix: ArrayLike<number>, position: number[]) => {
        const result = [0, 0, 0, 0];
        for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++)
          result[row]! += matrix[column * 4 + row]! * position[column]!;
        return result;
      };
      let clip = multiply(d.mainMatrix, flat);
      if (rendered.shaderData.define.includes('GLOBE')) {
        const radius = 1 + height / 6371008.8;
        const sphere = [Math.sin(longitude) * Math.cos(latitude) * radius, Math.sin(latitude) * radius,
          Math.cos(longitude) * Math.cos(latitude) * radius, 1];
        const globe = multiply(d.mainMatrix, sphere), mercator = multiply(d.fallbackMatrix, flat);
        clip = globe.map((value, i) => value * d.projectionTransition + mercator[i]! * (1 - d.projectionTransition));
      }
      const canvas = air.map.getCanvas();
      return { x: (clip[0]! / clip[3]! + 1) * canvas.clientWidth / 2,
        y: (1 - clip[1]! / clip[3]!) * canvas.clientHeight / 2 };
    };
    const capture = () => new Promise<{ pixels: Uint8Array; width: number; height: number; scale: number }>((resolve, reject) => {
      air.map.once('render', () => {
        const canvas = air.map.getCanvas(), gl = canvas.getContext('webgl2');
        if (!gl) { reject(new Error('WebGL2 is unavailable')); return; }
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        resolve({ pixels, width: canvas.width, height: canvas.height, scale: canvas.width / canvas.clientWidth });
      });
      air.map.triggerRepaint();
    });
    let picked: string[] = [], attachments: string[] = [];
    air.on('click', event => { picked = event.features.map(feature => feature.id);
      attachments = event.attachments.map(hit => hit.attachmentId); });
    let sawTransition = false;
    const unrelated: MapFeature = { ...point('unrelated', -70), entity: { altitude: { meters: 6, reference: 'ground' } } };
    try {
      const zooms = projection === 'globe' ? [11, 11.25, 11.5, 11.75, 12, 18, 19, 20] : [18, 19, 20];
      for (const zoom of zooms) for (const [longitude, copy] of [[6.87, 0], [179.99999, 1], [-179.99999, -1]] as const) {
        const altitude = zoom >= 18 ? 6 : 1000;
        const feature: MapFeature = { ...point('precise'), geometry: { type: 'Point', coordinates: [longitude, 46] },
          entity: { altitude: { meters: altitude, reference: 'ground' },
            attachments: zoom >= 18 ? [{ id: 'meter-sphere', type: 'sphere', radius: 3, color: '#0000ff' }] : [] } };
        air.map.jumpTo({ center: [longitude + copy * 360, 46], zoom, pitch: 35, bearing: 23 });
        for (const reversed of [false, true]) {
          const before = air.getEntityState(feature.id)?.computedAt;
          air.remove([feature.id, unrelated.id]);
          air.upsert(reversed ? [feature, unrelated] : [unrelated, feature]);
          air.setSelection(zoom >= 18 ? [feature.id] : []);
          await until(() => air.getEntityState(feature.id)?.placement === 'airborne'
            && air.getEntityState(feature.id)?.computedAt !== before && air.map.loaded(), 'meter-scale entity placement');
          const { pixels, width, height, scale } = await capture();
          const expected = reference(longitude, 46, altitude);
          const blend = rendered?.defaultProjectionData.projectionTransition ?? 0;
          sawTransition ||= blend > 0 && blend < 1;
          let redX = 0, redY = 0, redCount = 0;
          let blue: { x: number; y: number } | undefined, blueDistance = Infinity;
          for (let index = 0; index < pixels.length; index += 4) {
            const pixel = index / 4, x = (pixel % width + .5) / scale,
              y = (height - Math.floor(pixel / width) - .5) / scale;
            const red = pixels[index]!, green = pixels[index + 1]!, blueValue = pixels[index + 2]!;
            if (red > green + 80 && red > blueValue + 30) { redX += x; redY += y; redCount++; }
            const distance = Math.hypot(x - expected.x, y - expected.y);
            if (blueValue > red + 40 && blueValue > green + 40 && distance > 9 && distance < blueDistance) {
              blue = { x, y }; blueDistance = distance;
            }
          }
          const context = JSON.stringify({ projection, zoom, longitude, copy, reversed, expected,
            centroid: { x: redX / redCount, y: redY / redCount }, redCount,
            shader: rendered?.shaderData.variantName, blend });
          check(redCount > 10 && Math.hypot(redX / redCount - expected.x, redY / redCount - expected.y) <= 1,
            'Meter-scale marker differs from the double-precision reference: ' + context);
          await pointer('click', expected);
          check(picked.includes(feature.id), 'Drawn marker cannot be picked: ' + context);
          if (zoom >= 18) {
            check(blue, 'Meter-scale attachment has no distinct blue pixels: ' + context);
            await pointer('click', blue!);
            check(picked.includes(feature.id) && attachments.includes('meter-sphere'), 'Drawn attachment cannot be picked: ' + context);
          }
          check(zoom < 18 || air.getSelection().includes(feature.id), 'Camera/world-copy changes lost selection');
          check(air.getFeature(feature.id)?.geometry.coordinates[0] === longitude, 'World-copy selection changed stored longitude');
        }
      }
      if (projection === 'globe') {
        // At this low altitude the globe clips part of the screen-facing marker.
        // Its visible pixels must survive the native globe depth convention.
        air.map.jumpTo({ center: [-539.99999, 46], zoom: 11, pitch: 35, bearing: 23 });
        const before = air.getEntityState('precise')?.computedAt;
        air.setSelection([]);
        air.upsert([{ ...point('precise'), geometry: { type: 'Point', coordinates: [-179.99999, 46] },
          entity: { altitude: { meters: 6, reference: 'ground' } } }]);
        await until(() => air.getEntityState('precise')?.computedAt !== before && air.map.loaded(), 'near-surface globe placement');
        const { pixels, width, height, scale } = await capture();
        const expected = reference(-179.99999, 46, 6);
        let visible: { x: number; y: number } | undefined, nearest = 5;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index]! < pixels[index + 1]! + 80 || pixels[index]! < pixels[index + 2]! + 80) continue;
          const pixel = index / 4, candidate = { x: (pixel % width + .5) / scale,
            y: (height - Math.floor(pixel / width) - .5) / scale };
          const distance = Math.hypot(candidate.x - expected.x, candidate.y - expected.y);
          if (distance < nearest) { visible = candidate; nearest = distance; }
        }
        check(visible, 'Native globe depth hid the entire near-surface marker');
        await pointer('click', visible!);
        check(picked.includes('precise'), 'Near-surface globe marker cannot be picked at its drawn pixels');
      }
      check(projection === 'flat' || sawTransition, 'Globe coverage never exercised an intermediate projection blend');
      await new Promise<void>(resolve => { air.map.once('idle', () => resolve()); air.map.triggerRepaint(); });
      let frames = 0;
      const onRender = () => { frames++; };
      air.map.on('render', onRender);
      await new Promise(resolve => setTimeout(resolve, 5000));
      air.map.off('render', onRender);
      check(frames === 0, `Settled entity scene rendered ${frames} unsolicited frames`);
    } finally { air.destroy(); }
  };
}

export const entityProjectionCases = {
  "Reliability entity meter-scale projection agrees with double precision in flat views": meterScaleProjection("flat"),
  "Reliability entity meter-scale projection agrees with double precision in globe views": meterScaleProjection("globe"),
  "Reliability entity coherent attachments reject empty space across the opposite world seam": async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style('#ffffff'), projection: 'flat',
      camera: { center: [179, 0], zoom: 0 }, elevationSampler: { sample: () => 0 },
      style: () => ({ color: '#0000ff', radius: 0 }), logger: () => {} }));
    await air.ready;
    const feature: MapFeature = { ...point('seam-volume'), entity: { altitude: { meters: 1_000_000, reference: 'ground' },
      attachments: [{ id: 'volume', type: 'sphere', radius: 300_000, color: '#ff0000' }] } };
    const other: MapFeature = { ...point('unrelated'), geometry: { type: 'Point', coordinates: [90, 20] } };
    let hits: string[] = [], attachments: string[] = [];
    air.on('click', event => { hits = event.features.map(f => f.id); attachments = event.attachments.map(hit => hit.attachmentId); });
    try {
      for (const reversed of [false, true]) {
        air.remove([feature.id, other.id]);
        air.upsert(reversed ? [other, feature] : [feature, other]);
        await until(() => air.getEntityState(feature.id)?.placement === 'airborne', 'seam volume placement');
        for (const longitude of [179, -179]) {
          air.setCamera({ center: [longitude, 0], zoom: 0 });
          const visible = await new Promise<{ x: number; y: number } | undefined>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error('Timed out reading the sphere')), 8000);
            air.map.once('render', () => {
              window.clearTimeout(timeout);
              const canvas = air.map.getCanvas(), gl = canvas.getContext('webgl2');
              if (!gl) { reject(new Error('WebGL2 unavailable while reading the sphere')); return; }
              const pixels = new Uint8Array(canvas.width * canvas.height * 4);
              gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              let strongest = 35, point: { x: number; y: number } | undefined;
              const scale = canvas.width / canvas.clientWidth;
              for (let index = 0; index < pixels.length; index += 4) {
                const contrast = pixels[index]! - Math.max(pixels[index + 1]!, pixels[index + 2]!);
                if (contrast <= strongest) continue;
                strongest = contrast;
                const pixel = index / 4;
                point = { x: (pixel % canvas.width) / scale, y: (canvas.height - 1 - Math.floor(pixel / canvas.width)) / scale };
              }
              resolve(point);
            });
            air.map.triggerRepaint();
          });
          check(visible, 'Sphere control has no rendered red face');
          const empty: [number, number] = [longitude, 0];
          const pixel = await pixelAt(air, empty, 8000, 'empty viewport center');
          await pointer('click', air.map.project(empty));
          check(pixel.red === 255 && pixel.green === 255 && pixel.blue === 255 && hits.length === 0 && attachments.length === 0,
            'Coherent attachment spans empty space ' + JSON.stringify({ pixel, hits, attachments, longitude, reversed }));
          await pointer('click', visible!);
          check(hits.includes(feature.id) && attachments.includes('volume'), 'Visible sphere face cannot be picked');
        }
      }
    } finally { air.destroy(); }
  },
} satisfies BrowserCaseModule;
