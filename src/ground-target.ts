import type { Map as MapLibreMap } from "maplibre-gl";
import type { DrawingPosition } from "./drawing-types";

export type ScreenPoint = { x: number; y: number };
type Hit = { x: number; y: number; toLngLat(): { lng: number; lat: number } };
type Coverage = { zooms: number[]; samplerPerTile: Map<string, unknown> };
type Terrain = { getCoverageIndex(): Coverage | null };
type Transform = {
  screenTerrainPointToMercatorCoordinate(point: ScreenPoint, terrain: Terrain): Hit | null;
  isPointOnMapSurface(point: ScreenPoint): boolean;
};
type Renderer = MapLibreMap & { _camera?: { transform?: Transform }; terrain?: Terrain | null };

export type GroundTarget =
  | { kind: "available"; position: DrawingPosition }
  | { kind: "unavailable"; reason: "no-surface" | "no-elevation" | "incompatible-renderer" };

/** MapLibre 6.11.0 internal boundary. Its public unproject and elevation query both permit false ground hits. */
export function createGroundTargetResolver(
  map: MapLibreMap,
  terrainEnabled: () => boolean,
  incompatible: (cause?: unknown) => void,
) {
  let reported = false;
  function capabilityMissing(cause?: unknown): GroundTarget {
    if (!reported) {
      reported = true;
      incompatible(cause);
    }
    return { kind: "unavailable", reason: "incompatible-renderer" };
  }
  return (point: ScreenPoint): GroundTarget => {
    if (![point.x, point.y].every(Number.isFinite)) return { kind: "unavailable", reason: "no-surface" };
    try {
      const renderer = map as Renderer;
      const transform = renderer._camera?.transform;
      if (!transform || typeof transform.isPointOnMapSurface !== "function") return capabilityMissing();
      if (!terrainEnabled()) {
        if (!transform.isPointOnMapSurface(point)) return { kind: "unavailable", reason: "no-surface" };
        const location = map.unproject([point.x, point.y]);
        return Number.isFinite(location.lng) && Number.isFinite(location.lat)
          ? { kind: "available", position: [location.lng, location.lat] }
          : { kind: "unavailable", reason: "no-surface" };
      }
      const terrain = renderer.terrain;
      if (!terrain) return { kind: "unavailable", reason: "no-elevation" };
      if (typeof terrain.getCoverageIndex !== "function" ||
        typeof transform.screenTerrainPointToMercatorCoordinate !== "function") return capabilityMissing();
      const hit = transform.screenTerrainPointToMercatorCoordinate(point, terrain);
      if (!hit) return { kind: "unavailable", reason: "no-surface" };
      const index = terrain.getCoverageIndex();
      if (!index) return { kind: "unavailable", reason: "no-elevation" };
      if (!Array.isArray(index.zooms) || !(index.samplerPerTile instanceof Map)) return capabilityMissing();
      if (![hit.x, hit.y].every(Number.isFinite) || hit.y < 0 || hit.y >= 1) return { kind: "unavailable", reason: "no-surface" };
      if (typeof hit.toLngLat !== "function") return capabilityMissing();
      const wrap = Math.floor(hit.x), x = hit.x - wrap;
      for (const zoom of index.zooms) {
        if (!Number.isInteger(zoom) || zoom < 0 || zoom > 24) return capabilityMissing();
        const scale = 2 ** zoom;
        const key = `${wrap}/${zoom}/${Math.floor(x * scale)}/${Math.floor(hit.y * scale)}`;
        if (!index.samplerPerTile.has(key)) continue;
        if (typeof index.samplerPerTile.get(key) !== "function") return { kind: "unavailable", reason: "no-elevation" };
        const location = hit.toLngLat();
        return Number.isFinite(location.lng) && Number.isFinite(location.lat)
          ? { kind: "available", position: [location.lng, location.lat] }
          : capabilityMissing();
      }
      return { kind: "unavailable", reason: "no-elevation" };
    } catch (cause) {
      return capabilityMissing(cause);
    }
  };
}
