import { isScheme, type SchemeId } from './schemes';

const key = 'ridgeline.controls.v1';
export type Preferences = { scheme: SchemeId; favorites: SchemeId[]; edgePan: boolean };
const defaults: Preferences = { scheme: 'maps', favorites: [], edgePan: true };

export function readPreferences(): Preferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      scheme: 'scheme' in parsed && isScheme(parsed.scheme) ? parsed.scheme : defaults.scheme,
      favorites: 'favorites' in parsed && Array.isArray(parsed.favorites) ? parsed.favorites.filter(isScheme) : [],
      edgePan: 'edgePan' in parsed && typeof parsed.edgePan === 'boolean' ? parsed.edgePan : true,
    };
  } catch { return defaults; }
}

export function writePreferences(preferences: Preferences) {
  try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Private browsing can disable storage. Controls still work. */ }
}
