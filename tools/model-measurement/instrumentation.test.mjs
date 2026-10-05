import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('the built package emits owned disjoint phases only after explicit measurement opt-in', { timeout:180_000 }, async () => {
  const result=spawnSync('node',['scripts/measure-models.mjs','--verify'],{encoding:'utf8',timeout:170_000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(await readFile('.artifacts/model-measurement/verification.json','utf8'));
  assert.equal(report.disabledEntries,0);
  assert.equal(report.retainedEntries,0);
  assert.ok(report.records.some(record=>record.name==='parse' && record.detail.status==='success'));
  assert.ok(report.records.some(record=>record.name==='submit' && record.duration>=0));
  assert.ok(report.records.some(record=>record.name==='frame' && record.detail.drawnModels===2 && record.detail.clippedBoxes===2));
  for(const name of ['decode-wall','texture-upload','geometry-upload','instance-preparation','scene-cpu']) assert.ok(report.records.some(record=>record.name===name),name);
  const cpu=report.records.filter(record=>['parse','texture-upload','geometry-upload','instance-preparation','submit','picking'].includes(record.name)).sort((a,b)=>a.startTime-b.startTime);
  for(let i=1;i<cpu.length;i++) assert.ok(cpu[i].startTime>=cpu[i-1].startTime+cpu[i-1].duration-.001,'CPU phases overlap');
  assert.equal(typeof report.nativeBefore,'string'); assert.equal(report.nativeHeld,report.nativeBefore); assert.equal(report.nativeHeldVisible,false); assert.notEqual(report.nativeAfter,report.nativeBefore);
  const accepted=report.records.filter(record=>record.name==='accepted-update' && record.startTime>=report.reentrantStart);
  assert.equal(accepted.length,2);
  const frames=report.records.filter(record=>record.name==='frame' && record.startTime>=report.reentrantStart);
  assert.ok(frames.length>0 && frames.every(record=>record.detail.updateRevision===accepted[1].detail.revision));
});
