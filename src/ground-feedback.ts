import type { Map as MapLibreMap } from "maplibre-gl";
import type { DrawingPosition } from "./drawing-types";
import type { GroundTarget, ScreenPoint } from "./ground-target";
import { wrapLongitude } from "./drawing-geometry";
import { nearbyLongitude } from "./longitude";

/** The overlay owns only DOM feedback. The resolver remains authoritative for placement. */
export function createGroundFeedback(
  container: HTMLElement,
  map: MapLibreMap,
  resolve: (point: ScreenPoint) => GroundTarget,
) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("rl-ground-feedback");
  svg.setAttribute("aria-hidden", "true");
  const footprint = document.createElementNS("http://www.w3.org/2000/svg", "path");
  footprint.classList.add("rl-ground-footprint");
  const footprintAccent = document.createElementNS("http://www.w3.org/2000/svg", "path");
  footprintAccent.classList.add("rl-ground-footprint-accent");
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outline.classList.add("rl-ground-crosshair-outline");
  const crosshair = document.createElementNS("http://www.w3.org/2000/svg", "path");
  crosshair.classList.add("rl-ground-crosshair");
  const unavailable = document.createElementNS("http://www.w3.org/2000/svg", "path");
  unavailable.classList.add("rl-ground-unavailable");
  const snapGuide = document.createElementNS("http://www.w3.org/2000/svg", "path");
  snapGuide.classList.add("rl-ground-snap-guide");
  const snapRing = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  snapRing.classList.add("rl-ground-snap-ring");
  snapRing.setAttribute("r", "10");
  svg.append(footprint, footprintAccent, snapGuide, snapRing, outline, crosshair, unavailable);
  container.append(svg);
  let ownedCursor = false;
  const canvas = map.getCanvas();
  let previousCursor = "";
  let revision = 0;
  let lastSignature = "";
  function visible(element: SVGElement, show: boolean) {
    if (show) element.removeAttribute("hidden");
    else element.setAttribute("hidden", "");
  }
  function cursor(hidden: boolean) {
    if (hidden) {
      if (!ownedCursor) {
        previousCursor = canvas.style.cursor;
        canvas.style.cursor = "none";
        ownedCursor = true;
      }
    } else if (ownedCursor) {
      if (canvas.style.cursor === "none") canvas.style.cursor = previousCursor;
      ownedCursor = false;
    }
  }
  function clear() {
    lastSignature = "";
    for (const element of [svg, crosshair, outline, unavailable, footprint, footprintAccent, snapGuide, snapRing]) visible(element, false);
    cursor(false);
  }
  function invalidate() {
    revision++;
  }
  function show(pointer: ScreenPoint, target: GroundTarget, snapped: DrawingPosition | undefined) {
    const camera = map.getCenter();
    const signature = [revision, pointer.x, pointer.y, target.kind,
      target.kind === "available" ? target.position.join(",") : target.reason,
      snapped?.join(","), camera.lng, camera.lat, map.getZoom(), map.getPitch(), map.getBearing(),
      map.getProjection()?.type, canvas.clientWidth, canvas.clientHeight].join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;
    visible(svg, true);
    cursor(true);
    if (target.kind !== "available") {
      for (const element of [crosshair, outline, footprint, footprintAccent, snapGuide, snapRing]) visible(element, false);
      visible(unavailable, true);
      unavailable.setAttribute("d", `M ${pointer.x - 4} ${pointer.y - 4} l 8 8 m 0 -8 l -8 8`);
      return;
    }
    visible(unavailable, false);
    const reference = map.unproject([pointer.x, pointer.y]).lng;
    const displayed: DrawingPosition = [nearbyLongitude((snapped ?? target.position)[0], reference),
      (snapped ?? target.position)[1]];
    const center = snapped ? map.project(displayed) : pointer;
    visible(snapRing, Boolean(snapped));
    visible(snapGuide, Boolean(snapped) && Math.hypot(center.x - pointer.x, center.y - pointer.y) > 2);
    if (snapped) {
      snapRing.setAttribute("cx", String(center.x));
      snapRing.setAttribute("cy", String(center.y));
      snapGuide.setAttribute("d", `M ${pointer.x} ${pointer.y} L ${center.x} ${center.y}`);
    }
    const d = `M ${center.x - 8} ${center.y} h 5 m 6 0 h 5 M ${center.x} ${center.y - 8} v 5 m 0 6 v 5`;
    crosshair.setAttribute("d", d);
    outline.setAttribute("d", d);
    visible(crosshair, true);
    visible(outline, true);
    const ring = footprintPath(displayed, map, resolve);
    visible(footprint, Boolean(ring));
    visible(footprintAccent, Boolean(ring));
    if (ring) {
      footprint.setAttribute("d", ring);
      footprintAccent.setAttribute("d", ring);
    }
  }
  clear();
  return { show, clear, invalidate, destroy() { clear(); svg.remove(); } };
}

function footprintPath(
  position: DrawingPosition,
  map: MapLibreMap,
  resolve: (point: ScreenPoint) => GroundTarget,
): string | undefined {
  const center = map.project(position);
  const neighbor = resolve({ x: center.x + 10, y: center.y });
  if (neighbor.kind !== "available") return;
  const latitudeRadians = position[1] * Math.PI / 180;
  const east = wrapLongitude(neighbor.position[0] - position[0]) * 111_320 * Math.cos(latitudeRadians);
  const north = (neighbor.position[1] - position[1]) * 111_320;
  const radius = Math.hypot(east, north);
  if (!Number.isFinite(radius) || radius <= 0) return;
  const centerHit = resolve(center);
  if (centerHit.kind !== "available" || Math.hypot(
    wrapLongitude(centerHit.position[0] - position[0]) * 111_320 * Math.cos(latitudeRadians),
    (centerHit.position[1] - position[1]) * 111_320,
  ) > radius * 0.3) return;
  const points: ScreenPoint[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = 2 * Math.PI * i / 16;
    const geographic: DrawingPosition = [
      position[0] + radius * Math.cos(angle) / (111_320 * Math.cos(latitudeRadians)),
      position[1] + radius * Math.sin(angle) / 111_320,
    ];
    // The local approximation can cross a pole even when the center is valid.
    if (!geographic.every(Number.isFinite) || Math.abs(geographic[1]) > 90) return;
    const pixel = map.project(geographic);
    if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y) ||
      Math.hypot(pixel.x - center.x, pixel.y - center.y) > 20) return;
    const hit = resolve(pixel);
    if (hit.kind !== "available") return;
    const difference = Math.hypot(
      wrapLongitude(hit.position[0] - geographic[0]) * 111_320 * Math.cos(latitudeRadians),
      (hit.position[1] - geographic[1]) * 111_320,
    );
    if (difference > radius * 0.3) return;
    points.push(pixel);
  }
  return points.map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`).join(" ") + " Z";
}
