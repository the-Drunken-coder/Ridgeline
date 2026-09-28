import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraVolume, visibleCameraEdges } from '../src/camera-volume';
import { cameraRay } from '../src/entity-geometry';
import { cameraTerrain } from '../src/gpu-camera-terrain';
import type { CameraAttachment } from '../src/types';
const camera:CameraAttachment={id:'camera',type:'camera',bearing:105,elevation:-10,fovX:60,fovY:40,range:6001};
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i]!,0);
const pointKey=(point:number[])=>point.map(value=>value.toFixed(8)).join(',');

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
  const rays: typeof lines = [], outline: typeof lines = [];
  for(let i=0;i<lines.length;i+=2){
    const a=lines[i]!,b=lines[i+1]!;
    const fromOrigin=a.every((value,index)=>value===origin[index]);
    (fromOrigin?rays:outline).push(a,b);
    if(!fromOrigin)assert.ok(a[1]*111195<300,'Wireframe resumed on the far side of the hill');
    assert.ok(b[1]*111195<300,'Wireframe resumed on the far side of the hill');
  }
  assert.equal(rays.length,8,'Each camera corner needs a visible ray');
  assert.ok(outline.length>0,'Terrain intersection outline missing');
  const neighbors=new Map<string,string[]>();
  for(let i=0;i<outline.length;i+=2){
    const a=outline[i]!,b=outline[i+1]!;
    assert.ok(a[1]*111195>100&&b[1]*111195>100,'Outline was removed before reaching terrain');
    for(const [from,to] of [[pointKey(a),pointKey(b)],[pointKey(b),pointKey(a)]] as const)
      neighbors.set(from,[...(neighbors.get(from)??[]),to]);
  }
  assert.ok(neighbors.size>0);
  assert.ok([...neighbors.values()].every(ends=>ends.length===2),'Terrain outline has a gap or branch');
  for(let i=1;i<rays.length;i+=2)
    assert.ok(neighbors.has(pointKey(rays[i]!)),'A corner ray stopped without joining the terrain outline');
  const visited=new Set<string>(),pending=[neighbors.keys().next().value!];
  while(pending.length){
    const point=pending.pop()!;
    if(visited.has(point))continue;
    visited.add(point);
    pending.push(...neighbors.get(point)!);
  }
  assert.equal(visited.size,neighbors.size,'Terrain outline split into disconnected pieces');
});


test('ground wireframe connects terrain hits and leaves skyward misses open',()=>{
  const terrain=cameraTerrain(0,0,6001,()=>0);
  const origin:[number,number,number]=[0,0,2000];
  const lines=visibleCameraEdges(origin,cameraVolume(origin,camera,terrain),terrain);
  const neighbors=new Map<string,string[]>();
  for(let i=0;i<lines.length;i+=2){
    const a=lines[i]!,b=lines[i+1]!;
    if(a[2]<1&&b[2]<1){
      assert.ok(a[2]>=0&&b[2]>=0,'Outline sank below terrain');
      for(const [from,to] of [[pointKey(a),pointKey(b)],[pointKey(b),pointKey(a)]] as const)
        neighbors.set(from,[...(neighbors.get(from)??[]),to]);
    }
  }
  assert.ok(neighbors.size>0,'Perimeter terrain hits were not joined');
  const ends=[...neighbors].filter(([,adjacent])=>adjacent.length===1).map(([point])=>point);
  assert.equal(ends.length,2,'The ground outline should remain open between two terrain hits');
  assert.ok([...neighbors.values()].every(adjacent=>adjacent.length<=2),'Ground outline branched');
  const visited=new Set<string>(),pending=[ends[0]!];
  while(pending.length){
    const point=pending.pop()!;
    if(visited.has(point))continue;
    visited.add(point);
    pending.push(...neighbors.get(point)!);
  }
  assert.equal(visited.size,neighbors.size,'Ground outline has disconnected pieces');
  const sky={...camera,elevation:90};
  const skyLines=visibleCameraEdges(origin,cameraVolume(origin,sky,terrain),terrain);
  assert.ok(skyLines.every(point=>point[2]>=origin[2]),'Skyward rays invented a ground outline');
});
