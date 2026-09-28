import { GeoJSONSource } from 'maplibre-gl';
import type { Map as GLMap } from 'maplibre-gl';
import type { FeaturePublicationTarget } from './feature-publication';

export const FEATURE_SOURCE = 'rl:features';

/** MapLibre stores feature state in plain objects. Prefix all IDs to keep the map injective. */
export function sourceFeatureId(id: string) {
  return `rl:${id}`;
}

export function mapLibreFeaturePublication(map: GLMap): FeaturePublicationTarget {
  return {
    current() {
      const source = map.getSource(FEATURE_SOURCE);
      return source instanceof GeoJSONSource ? source : undefined;
    },
    create(features) {
      map.addSource(FEATURE_SOURCE, { type: 'geojson', promoteId: '_rl_id', data: { type: 'FeatureCollection', features } });
    },
    watchInitial(failed) {
      const source = map.getSource(FEATURE_SOURCE);
      if (!(source instanceof GeoJSONSource)) return () => {};
      const onError = (event: { error: unknown }) => failed(event.error);
      const release = () => { source.off('error', onError); source.off('data', release); };
      source.on('error', onError);
      source.on('data', release);
      return release;
    },
  };
}
