import { MercatorCoordinate } from 'maplibre-gl';
import { cameraFootprint, cameraGroundCornerOffsets, cameraRay, localFrame } from './entity-geometry';
import type { GeoPoint, Vec3 } from './entity-geometry';
import type { CameraAttachment } from './types';
import type { CameraTerrain } from './gpu-camera-terrain';
import type { Primitive } from './entity-layer';
import { parseColor } from './color';

export const cameraDefaults = {
  plainColor: '#288b59',
  visibleMaskColor: '#1ad96b',
  blockedMaskColor: '#ff382e',
  wireframeColor: '#8bab97',
  fillOpacity: 0.25,
  blockedOpacity: 0.25,
  outline: true,
  outlineWidth: 3,
  wireframeWidth: 3,
  outlineAlpha: 0.95,
} as const;

/** Plain overlays stop downward volume rays at flat ground. All heights remain raw meters. */
export function plainCameraPrimitives(
  entityId: string,
  origin: GeoPoint,
  ground: number,
  camera: CameraAttachment,
): { geometry: Primitive[]; footprintTriangles: number } {
  const footprint = cameraFootprint(origin, camera, ground);
  if (!footprint.length) return { geometry: [], footprintTriangles: 0 };

  const rgba = parseColor(camera.color ?? cameraDefaults.plainColor, 1);
  const geometry: Primitive[] = [];
  const add = (
    vertices: GeoPoint[],
    mode: Primitive['mode'],
    color: Primitive['color'],
    surface = false,
    size?: number,
  ) => {
    if (vertices.length) geometry.push({ entityId, attachmentId: camera.id, mode, vertices, color, size, surface });
  };

  if ((camera.volumeOpacity ?? 0) > 0 || camera.wireframe) {
    const local = localFrame(origin);
    const corners = cameraGroundCornerOffsets(origin, camera, ground)
      .map(([east, north, up]) => local(east, north, up));
    const faces: GeoPoint[] = [];
    const rays: GeoPoint[] = [];
    corners.forEach((a, index) => {
      const b = corners[(index + 1) % corners.length]!;
      faces.push(origin, a, b);
      rays.push(origin, a, a, b);
    });
    if ((camera.volumeOpacity ?? 0) > 0)
      add(faces, 'triangles', [rgba[0], rgba[1], rgba[2], camera.volumeOpacity!]);
    if (camera.wireframe)
      add(rays, 'lines', parseColor(cameraDefaults.wireframeColor, 1), false,
        camera.wireframeWidth ?? cameraDefaults.wireframeWidth);
  }

  add(footprint, 'polygon', [rgba[0], rgba[1], rgba[2], camera.fillOpacity ?? cameraDefaults.fillOpacity], true);
  if (camera.outline ?? cameraDefaults.outline)
    add(
      footprint.flatMap((point, index) => [point, footprint[(index + 1) % footprint.length]!]),
      'lines',
      [rgba[0], rgba[1], rgba[2], cameraDefaults.outlineAlpha],
      true,
      camera.outlineWidth ?? cameraDefaults.outlineWidth,
    );
  return { geometry, footprintTriangles: 2 };
}

/** Terrain-visibility volumes keep every ray at full range so terrain depth clips the view. */
export function terrainCameraPrimitives(
  entityId: string,
  origin: GeoPoint,
  camera: CameraAttachment,
  volume: CameraVolume,
  terrain: CameraTerrain,
): Primitive[] {
  const faces: GeoPoint[] = [];
  volume.corners.forEach((a, index) => {
    const b = volume.corners[(index + 1) % 4]!;
    faces.push(origin, a, b);
  });
  const geometry: Primitive[] = [];
  if ((camera.volumeOpacity ?? 0) > 0)
    geometry.push({
      entityId,
      attachmentId: camera.id,
      mode: 'triangles',
      vertices: faces,
      color: parseColor(camera.color ?? cameraDefaults.plainColor, camera.volumeOpacity!),
    });
  if (camera.wireframe)
    geometry.push({
      entityId,
      attachmentId: camera.id,
      mode: 'lines',
      vertices: visibleCameraEdges(origin, volume, terrain),
      color: parseColor(cameraDefaults.wireframeColor, 1),
      size: camera.wireframeWidth ?? cameraDefaults.wireframeWidth,
    });
  return geometry;
}

export type Plane = [number, number, number, number];
export type CameraVolume = { corners: GeoPoint[]; offsets: Vec3[]; cap: Plane };
const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
function cap(a: Vec3,b: Vec3,c: Vec3): Plane {
  const n=cross(minus(b,a),minus(c,a)),length=Math.hypot(...n);
  const sign=dot(n,a)<0?-1:1;
  return [n[0]/length*sign,n[1]/length*sign,n[2]/length*sign,dot(n,a)/length*sign];
}

/** A finite frustum shared by drawing and classification. Terrain clips its visible surface,
 * not its corner directions; stopping the cap at first hits would erase hill shadows. */
export function cameraVolume(origin: GeoPoint,camera: CameraAttachment,terrain: CameraTerrain): CameraVolume {
  const centre=MercatorCoordinate.fromLngLat([origin[0],origin[1]]);
  const offsets=([[-1,-1],[1,-1],[1,1],[-1,1]] as const).map(([x,y]):Vec3=>{
    const ray=cameraRay(camera,x,y);
    return [ray[0]*camera.range,ray[1]*camera.range,ray[2]*camera.range];
  });
  const corners=offsets.map(([x,y,z]):GeoPoint=>{
    const p=new MercatorCoordinate(centre.x+x*terrain.scale,centre.y-y*terrain.scale).toLngLat();
    return [p.lng,p.lat,origin[2]+z];
  });
  return {corners,offsets,cap:cap(offsets[0]!,offsets[1]!,offsets[2]!)};
}

/** Height on the same triangles used by camera visibility, without more DEM requests. */
function meshHeight(terrain: CameraTerrain, east: number, north: number) {
  const cells=Math.sqrt(terrain.vertices.length/3)-1;
  const x=(east/terrain.half+1)*cells/2,y=(north/terrain.half+1)*cells/2;
  if(x<0||y<0||x>cells||y>cells)return null;
  const ix=Math.min(cells-1,Math.floor(x)),iy=Math.min(cells-1,Math.floor(y)),u=x-ix,v=y-iy;
  const z=(dx:number,dy:number)=>terrain.vertices[((iy+dy)*(cells+1)+ix+dx)*3+2]!;
  return u+v<=1 ? z(0,0)*(1-u-v)+z(1,0)*u+z(0,1)*v : z(1,1)*(u+v-1)+z(1,0)*(1-v)+z(0,1)*(1-u);
}

/** Trim display edges at terrain; never reconnect a corner ray after it crosses a hill. */
export function visibleCameraEdges(origin: GeoPoint, volume: CameraVolume, terrain: CameraTerrain): GeoPoint[] {
  const centre=MercatorCoordinate.fromLngLat([origin[0],origin[1]]);
  let dx=centre.x-terrain.centre.x;dx-=Math.round(dx);
  const east=dx/terrain.scale,north=(terrain.centre.y-centre.y)/terrain.scale;
  const step=terrain.half/(Math.sqrt(terrain.vertices.length/3)-1);
  const hit=(offset:Vec3)=>{
    const steps=Math.max(1,Math.ceil(Math.hypot(...offset)/step));
    const clear=(t:number)=>{
      const height=meshHeight(terrain,east+offset[0]*t,north+offset[1]*t);
      return height!==null&&origin[2]+offset[2]*t>height+.2;
    };
    for(let i=1;i<=steps;i++){
      if(clear(i/steps))continue;
      let lo=(i-1)/steps,hi=i/steps;
      for(let j=0;j<10;j++){const mid=(lo+hi)/2;if(clear(mid))lo=mid;else hi=mid;}
      return lo;
    }
    return 1;
  };
  const world=(offset:Vec3,t=1):GeoPoint=>{
    const p=new MercatorCoordinate(centre.x+offset[0]*t*terrain.scale,centre.y-offset[1]*t*terrain.scale).toLngLat();
    return [p.lng,p.lat,origin[2]+offset[2]*t];
  };
  const lines:GeoPoint[]=[];
  volume.offsets.forEach((a,i)=>{
    lines.push(origin,world(a,hit(a)));
    const b=volume.offsets[(i+1)%4]!;
    // Far edges have independent line of sight. Short pieces avoid spanning hidden sections.
    const count=Math.max(1,Math.ceil(Math.hypot(...minus(b,a))/(step*2)));
    const at=(t:number):Vec3=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
    let previous=a,previousHit=hit(a);
    for(let j=1;j<=count;j++){
      const next=at(j/count),nextHit=hit(next);
      const middle=at((j-.5)/count),middleHit=hit(middle);
      if(previousHit===1&&nextHit===1&&middleHit===1)lines.push(world(previous),world(next));
      // Connect actual terrain intersections, never project a ray that misses onto ground.
      if(previousHit<1&&middleHit<1)lines.push(world(previous,previousHit),world(middle,middleHit));
      if(middleHit<1&&nextHit<1)lines.push(world(middle,middleHit),world(next,nextHit));
      previous=next;previousHit=nextHit;
    }
  });
  return lines;
}
