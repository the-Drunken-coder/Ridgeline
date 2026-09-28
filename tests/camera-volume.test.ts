import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraVolume, plainCameraPrimitives, terrainCameraPrimitives, visibleCameraEdges } from '../src/camera-volume';
import { cameraFootprint, cameraRay } from '../src/entity-geometry';
import { cameraTerrain } from '../src/gpu-camera-terrain';
import type { CameraAttachment } from '../src/types';

Object.defineProperty(globalThis, 'OffscreenCanvas', {
  configurable: true,
  value: class {
    getContext() {
      return {
        set fillStyle(value: string) { this.color = value; },
        fillRect() {},
        getImageData() {
          const hex = this.color.slice(1);
          return { data: new Uint8ClampedArray([
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            255,
          ]) };
        },
        color: '#000000',
      };
    }
  },
});
const camera:CameraAttachment={id:'camera',type:'camera',bearing:105,elevation:-10,fovX:60,fovY:40,range:6001};
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i]!,0);

test('plain camera corners share the flat-ground range rule and keep raw heights', () => {
  const origin: [number, number, number] = [0, 0, 300];
  const pose = { ...camera, elevation: -90, range: 2000, volumeOpacity: 0.3, wireframe: true };
  const { geometry, footprintTriangles } = plainCameraPrimitives('entity', origin, 0, pose);
  const footprint = cameraFootprint(origin, pose, 0);
  assert.equal(footprintTriangles, 2);
  const face = geometry.find(part => part.mode === 'triangles')!;
  const wireframe = geometry.find(part => part.mode === 'lines' && !part.surface)!;
  const overlay = geometry.find(part => part.mode === 'polygon')!;
  assert.deepEqual(overlay.vertices, footprint);
  for (let i = 0; i < 4; i++) {
    const corner = face.vertices[i * 3 + 1]!;
    const edge = wireframe.vertices[i * 4 + 1]!;
    assert.deepEqual(corner, edge);
    assert.ok(Math.abs(corner[2]) < 0.01);
    assert.ok(Math.abs(corner[0] - footprint[i]![0]) < 1e-10);
    assert.ok(Math.abs(corner[1] - footprint[i]![1]) < 1e-10);
    assert.equal(face.vertices[i * 3]![2], 300);
  }
});

test('plain camera uses the existing appearance defaults and omits skyward coverage', () => {
  const origin: [number, number, number] = [0, 0, 300];
  const pose = { ...camera, elevation: -90, wireframe: true };
  const { geometry, footprintTriangles } = plainCameraPrimitives('entity', origin, 0, pose);
  assert.equal(footprintTriangles, 2);
  const fill = geometry.find(part => part.mode === 'polygon')!;
  const outline = geometry.find(part => part.mode === 'lines' && part.surface)!;
  const wireframe = geometry.find(part => part.mode === 'lines' && !part.surface)!;
  assert.deepEqual(fill.color, [40 / 255, 139 / 255, 89 / 255, 0.25]);
  assert.deepEqual(outline.color, [40 / 255, 139 / 255, 89 / 255, 0.95]);
  assert.equal(outline.size, 3);
  assert.deepEqual(wireframe.color, [139 / 255, 171 / 255, 151 / 255, 1]);
  assert.equal(wireframe.size, 3);
  assert.deepEqual(plainCameraPrimitives('entity', origin, 0, { ...pose, elevation: 90, volumeOpacity: 0.5 }),
    { geometry: [], footprintTriangles: 0 });
});

test('terrain-visibility volume vertices remain in raw meters', () => {
  const origin: [number, number, number] = [0, 0, 300];
  const terrain = cameraTerrain(0, 0, 1000, () => 0);
  const pose = { ...camera, range: 1000, volumeOpacity: 0.3, wireframe: true };
  const volume = cameraVolume(origin, pose, terrain);
  const geometry = terrainCameraPrimitives('entity', origin, pose, volume, terrain);
  const faces = geometry.find(part => part.mode === 'triangles')!;
  assert.deepEqual(faces.vertices.slice(0, 3), [origin, volume.corners[0], volume.corners[1]]);
  assert.ok(geometry.find(part => part.mode === 'lines')!.vertices.some(point => point[2] === 300));
});

test('preset upper corners remain on upward rays and within range',()=>{
  const terrain=cameraTerrain(0,0,camera.range,()=>0);
  const volume=cameraVolume([0,0,2000],camera,terrain);
  volume.offsets.forEach((p,i)=>{
    const [x,y]=[[-1,-1],[1,-1],[1,1],[-1,1]][i]!;
    const ray=cameraRay(camera,x!,y!),length=Math.hypot(...p);
    assert.ok(length<=camera.range+1e-6);
    assert.ok(Math.abs(dot(p,ray)/length-1)<1e-12,'Wire corner left the FOV ray');
    if(i<2)assert.ok(volume.corners[i]![2]<0,'Downward ray was bent onto ground');
    else assert.ok(volume.corners[i]![2]>2900);
    assert.ok(Math.abs(length-camera.range)<1e-6);
  });
  for(const offset of volume.offsets)assert.ok(Math.abs(dot(volume.cap.slice(0,3),offset)-volume.cap[3])<1e-6);

});

test('terrain cannot warp the side planes or cut away hill-shadow receivers',()=>{
  const flat=cameraTerrain(0,0,2000,()=>0);
  const hill=cameraTerrain(0,0,2000,(_lng,lat)=>150*Math.exp(-(((lat*111195-300)/40)**2)));
  const pose={...camera,bearing:0,elevation:-15,range:2000};
  const a=cameraVolume([0,0,100],pose,flat),b=cameraVolume([0,0,100],pose,hill);
  assert.deepEqual(a,b);
  for(const north of [210,750]){
    const p=[0,north,-100];
    const cap=a.cap;
    assert.ok(dot(cap.slice(0,3),p)<cap[3],'Volume cap excluded ground before range');
  }
});


test('wireframe rays stop at the first hill and never reappear beyond it',()=>{
  const pose={...camera,bearing:0,elevation:0,fovX:40,fovY:30,range:2000};
  const terrain=cameraTerrain(0,0,pose.range,(_lng,lat)=>500*Math.exp(-(((lat*111195-300)/50)**2)));
  const origin:[number,number,number]=[0,0,100];
  const volume=cameraVolume(origin,pose,terrain);
  const lines=visibleCameraEdges(origin,volume,terrain);
  // The ridge spans every ray, including both upward corners. No far-cap edges survive.
  assert.ok(lines.length>8,'Terrain intersection outline missing');
  for(let i=1;i<lines.length;i+=2){
    assert.ok(lines[i]![1]*111195<300,'Wireframe resumed on the far side of the hill');
    assert.ok(lines[i]![1]*111195>100,'Wireframe was removed before reaching terrain');
  }
});


test('ground wireframe connects terrain hits and leaves skyward misses open',()=>{
  const terrain=cameraTerrain(0,0,6001,()=>0);
  const origin:[number,number,number]=[0,0,2000];
  const lines=visibleCameraEdges(origin,cameraVolume(origin,camera,terrain),terrain);
  let groundEdges=0;
  for(let i=0;i<lines.length;i+=2){
    const a=lines[i]!,b=lines[i+1]!;
    if(a[2]<1&&b[2]<1){groundEdges++;assert.ok(a[2]>=0&&b[2]>=0,'Outline sank below terrain');}
  }
  assert.ok(groundEdges>10,'Perimeter terrain hits were not joined');
  const sky={...camera,elevation:90};
  const skyLines=visibleCameraEdges(origin,cameraVolume(origin,sky,terrain),terrain);
  assert.ok(skyLines.every(point=>point[2]>=origin[2]),'Skyward rays invented a ground outline');
});
