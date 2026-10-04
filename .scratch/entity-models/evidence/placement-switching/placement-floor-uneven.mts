import {readFileSync,writeFileSync} from 'node:fs';
import {MercatorCoordinate} from '/tmp/ridgeline-model-placement/node_modules/maplibre-gl/dist/maplibre-gl.mjs';
import {modelPlacement} from '/tmp/ridgeline-model-placement/src/model-placement.ts';
import {modelFloorScale,modelScreenBox} from '/tmp/ridgeline-model-placement/src/model-frame.ts';
import {EntityProjection} from '/tmp/ridgeline-model-placement/src/entity-projection.ts';
const frames=JSON.parse(readFileSync('/tmp/ridgeline-model-context/model-placement-probe-frames.json','utf8')).frames;
const frame=frames[0],location=frame.anchor.slice(0,2), m=MercatorCoordinate.fromLngLat(location),origin=[m.x,m.y],units=m.meterInMercatorCoordinateUnits();
const projection=new EntityProjection(frame.input,frame.center,640,360),results=[];
for(const curvature of [-.005,-.01,-.02,-.05,-.1,-.2,-.5,-1]){
 const height=(lng,lat)=>{const p=MercatorCoordinate.fromLngLat([lng,lat]),e=(p.x-m.x)/units,n=(m.y-p.y)/units;return curvature*(e*e+n*n)};
 const input={bounds:{min:[-2,0,-2],max:[2,2,2]},location,placement:'ground',heading:37,metersPerUnit:1,headingOffset:0,terrain:true,exaggeration:1};
 let placement=modelPlacement(input,height),history=[];
 for(let step=0;step<4 && placement.status==='ready';step++){
  const factor=modelFloorScale(projection,placement,origin,40);history.push({scale:placement.displayScale,height:placement.position[2],size:modelScreenBox(projection,placement,origin)?.extent,factor});
  if(factor<=1)break;placement=modelPlacement({...input,displayScale:placement.displayScale*factor},height);
 }
 results.push({curvature,history,final:placement.status==='ready'?{scale:placement.displayScale,height:placement.position[2],size:modelScreenBox(projection,placement,origin)?.extent}:placement.status});
}
writeFileSync('/tmp/ridgeline-model-context/placement-floor-uneven.json',JSON.stringify(results,null,2));console.log(results.map(r=>({curvature:r.curvature,final:r.final})));
