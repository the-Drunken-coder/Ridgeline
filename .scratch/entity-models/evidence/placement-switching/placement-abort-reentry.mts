import {Elevation,modelAreaKey} from '/tmp/ridgeline-model-placement/src/elevation.ts';
const key=modelAreaKey('removed'),calls=[];
let removeOnAbort=false;
const elevation=new Elevation({provider:{tiles:[],encoding:'terrarium'},sampler:{sample:()=>null,prepare(positions,signal){calls.push({positions,signal});signal.addEventListener('abort',()=>{if(removeOnAbort)elevation.release(key)});return new Promise(()=>{})}},changed:()=>{},diagnostic:()=>{}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
elevation.requestBatch([{key,center:[0,0],radiusMeters:1,requiredPositions:[[0,0]]}]);await tick();
removeOnAbort=true;elevation.requestBatch([{key,center:[0,0],radiusMeters:2,requiredPositions:[[.0001,0]]}],{deferProbe:true});
const retainedRevision=elevation.revision(key),beforeReset=calls.length;elevation.reset({tiles:[],encoding:'terrarium'});await tick();
console.log(JSON.stringify({retainedRevision,beforeReset,afterReset:calls.length,newPreparationAfterCallbackRelease:calls.length>beforeReset}));elevation.destroy();
