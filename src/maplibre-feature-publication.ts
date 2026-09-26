import { GeoJSONSource } from 'maplibre-gl';
import type { Map as GLMap } from 'maplibre-gl';
import type { FeaturePublicationTarget } from './feature-publication';

export const FEATURE_SOURCE = 'rl:features';

export function mapLibreFeaturePublication(map: GLMap): FeaturePublicationTarget {
  return {
    current() {
      const source = map.getSource(FEATURE_SOURCE);
      return source instanceof GeoJSONSource ? source : undefined;
    },
    create(features) {
      map.addSource(FEATURE_SOURCE, { type: 'geojson', promoteId: '_rl_id', data: { type: 'FeatureCollection', features } });
    },
  };
}
