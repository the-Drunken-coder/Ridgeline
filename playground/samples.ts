import type { MapFeature, Viewport, IconDefinition } from '@ridgeline/map';

export type Sample = { name: string; kind: string; color: string; icon?: string; label?: string; group?: number };
export const groups = [
  { count: 2, center: [6.8615, 45.9291] }, { count: 3, center: [6.8762, 45.928] },
  { count: 8, center: [6.8592, 45.9212] }, { count: 10, center: [6.8725, 45.9188] },
  { count: 20, center: [6.8688, 45.9239] },
];
const names = ['Rescue 1', 'Medic 2', 'Supply van', 'Field team', 'Relay north', 'Trail marker', 'Survey crew', 'Base camp'];
const kinds = ['truck', 'medical', 'supply', 'team', 'radio', '', 'survey', 'camp'];

export function point(id: string, name: string, lng: number, lat: number, icon?: string): MapFeature<Sample> {
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name, kind: icon || 'Point', color: '#216e5b', ...(icon ? { icon } : {}) } };
}
export function overlapFeatures() {
  return groups.flatMap(group => Array.from({ length: group.count }, (_, index) => {
    const base = names[index % names.length] ?? 'Feature';
    const name = index < 8 ? base : `${base} ${Math.floor(index / 8) + 1}`;
    const jitter = group.count === 8 ? index * .000007 : 0;
    const feature = point(`group-${group.count}-${index + 1}`, name, group.center[0]! + jitter, group.center[1]!, kinds[index % kinds.length]);
    feature.properties.group = group.count;
    return feature;
  }));
}
export function terrainFeatures(): MapFeature<Sample>[] {
  return [
    point('vehicle-42', 'Rescue 1', 6.8694, 45.9255, 'truck'),
    point('medic-2', 'Medic 2', 6.881, 45.936, 'medical'),
    point('camp-1', 'Base camp', 6.874, 45.906, 'camp'),
    { type: 'Feature', id: 'route-north', properties: { name: 'Valley route', kind: 'Route', color: '#3875aa', label: 'Valley route' }, geometry: { type: 'LineString', coordinates: [[6.862,45.914],[6.869,45.924],[6.878,45.935],[6.887,45.947]] } },
    { type: 'Feature', id: 'survey-area', properties: { name: 'Survey area', kind: 'Area', color: '#b97b27', label: 'Survey area' }, geometry: { type: 'Polygon', coordinates: [[[6.89,45.923],[6.905,45.923],[6.905,45.936],[6.89,45.936],[6.89,45.923]]] } },
  ];
}
export function movingFeatures(tick = 0, count = 1_000): MapFeature<Sample>[] {
  return Array.from({ length: count }, (_, index) => {
    const moving = index < 100;
    const lng = 6.84 + (index % 40) * .0015 + (moving ? Math.sin(tick / 14 + index) * .0007 : 0);
    const lat = 45.902 + Math.floor(index / 40) * .0015 + (moving ? Math.cos(tick / 18 + index) * .0005 : 0);
    const feature = point(`moving-${index}`, `Unit ${index + 1}`, lng, lat, index < 8 ? kinds[index] : undefined);
    feature.properties.color = moving ? '#a54a22' : '#216e5b';
    return feature;
  });
}

/** Small local sample icons. No remote icon service or production icon dependency. */
export function registerSampleIcons(viewport: Viewport<Sample>) {
  const definitions = new Map<string, IconDefinition>();
  for (const kind of kinds.filter(Boolean)) {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    context.scale(2, 2);
    context.fillStyle = '#fcfcf7'; context.beginPath(); context.roundRect(1, 1, 30, 30, 4); context.fill();
    context.strokeStyle = '#215b47'; context.fillStyle = '#215b47'; context.lineWidth = 1.7; context.lineJoin = 'round';
    if (kind === 'truck') {
      context.strokeRect(5, 9, 13, 12); context.strokeRect(18, 13, 8, 8);
      for (const x of [10, 23]) { context.beginPath(); context.arc(x, 23, 3, 0, Math.PI * 2); context.fill(); }
    } else if (kind === 'medical') {
      context.fillRect(13, 6, 6, 20); context.fillRect(6, 13, 20, 6);
    } else if (kind === 'camp') {
      context.beginPath(); context.moveTo(4, 25); context.lineTo(16, 6); context.lineTo(28, 25); context.closePath(); context.stroke();
      context.beginPath(); context.moveTo(16, 6); context.lineTo(16, 25); context.stroke();
    } else if (kind === 'radio') {
      context.beginPath(); context.moveTo(16, 13); context.lineTo(11, 26); context.lineTo(21, 26); context.closePath(); context.stroke();
      context.beginPath(); context.arc(16, 11, 3, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.arc(16, 11, 8, -.8, .8); context.stroke(); context.beginPath(); context.arc(16, 11, 8, Math.PI - .8, Math.PI + .8); context.stroke();
    } else if (kind === 'supply') {
      context.strokeRect(6, 7, 20, 19); context.beginPath(); context.moveTo(6, 13); context.lineTo(26, 13); context.moveTo(16, 7); context.lineTo(16, 19); context.stroke();
    } else if (kind === 'team') {
      for (const x of [11, 22]) { context.beginPath(); context.arc(x, 10, 3, 0, Math.PI * 2); context.stroke(); context.beginPath(); context.arc(x, 24, 6, Math.PI, 0); context.stroke(); }
    } else {
      for (const x of [10, 22]) { context.beginPath(); context.arc(x, 20, 5, 0, Math.PI * 2); context.stroke(); }
      context.strokeRect(10, 9, 12, 7);
    }
    const definition = { image: context.getImageData(0, 0, 64, 64), url: canvas.toDataURL(), pixelRatio: 2 };
    definitions.set(kind, definition); viewport.registerIcon(kind, definition);
  }
  return definitions;
}
