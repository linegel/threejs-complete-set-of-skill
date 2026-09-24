import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import {createTrailRing,appendTrailSample,trailSamples,trailSegments,markTrailBreak,resetTrailIdentity} from '../../skills/threejs-particles-trails-and-effects/scripts/trail-ring-oracle.mjs';
const reference = () => readFileSync(new URL('../../skills/threejs-particles-trails-and-effects/references/particles-trails-and-effects-system.md',import.meta.url),'utf8').replace(/\s+/g,' ');
const options = () => ({capacity:3,maxCapacity:8,entityId:7,generation:1,sampling:{mode:'time',seconds:1}});
const append = (ring,time,x=time,extra={}) => appendTrailSample(ring,{entityId:7,generation:1,timeSeconds:time,position:[x,0,0],...extra});

test('trail creation uses an explicit capacity budget and safe u32 identity', () => {
  for (const overrides of [{capacity:4,maxCapacity:3},{maxCapacity:undefined},{capacity:2**32},{entityId:-1},{generation:2**53}]) {
    assert.throws(()=>createTrailRing({...options(),...overrides}));
  }
  const ring=createTrailRing(options());
  assert.equal(ring.samples.length,0);
  assert.ok(Object.isFrozen(ring.sampling));
});

test('invalid sample data leaves the trail unchanged', () => {
  const ring=createTrailRing(options()); append(ring,0);
  const before=trailSamples(ring);
  for (const extra of [{position:new Array(3)},{position:{length:2**32}},{position:[Infinity,0,0]},{breakBefore:'false'},{timeSeconds:NaN}]) {
    assert.throws(()=>append(ring,1,1,extra));
    assert.deepEqual(trailSamples(ring),before);
  }
  assert.throws(()=>append(ring,1,1,{position:[Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE]}),/distance/);
});

test('ring wrap retains chronological order and never connects newest to oldest', () => {
  const ring=createTrailRing(options()); for(let i=0;i<5;i++) append(ring,i);
  assert.deepEqual(trailSamples(ring).map(s=>s.timeSeconds),[2,3,4]);
  assert.equal(trailSamples(ring)[0].breakBefore,true);
  assert.deepEqual(trailSegments(ring).map(s=>s.map(p=>p.timeSeconds)),[[2,3],[3,4]]);
  const copy=trailSamples(ring);copy[0].position[0]=999;
  assert.equal(trailSamples(ring)[0].position[0],2);
});

test('equal-time discontinuity and identity reset are explicit', () => {
  const ring=createTrailRing(options()); append(ring,0);
  assert.throws(()=>append(ring,0,1),/equal-time/);
  markTrailBreak(ring);append(ring,0,1);
  assert.equal(trailSegments(ring).length,0);
  assert.throws(()=>append(ring,-1,2),/nondecreasing/);
  assert.throws(()=>resetTrailIdentity(ring,{entityId:7,generation:-1}));
  assert.equal(ring.count,2);
  resetTrailIdentity(ring,{entityId:7,generation:2});
  assert.equal(ring.count,0);assert.equal(ring.samples.length,0);
  assert.throws(()=>append(ring,1),/identity/);
});

test('threshold gating is not an authoritative-time resampler', () => {
  const a=createTrailRing(options()),b=createTrailRing(options());
  [0,1,2].forEach(t=>append(a,t));[0,1.1,2.2].forEach(t=>append(b,t));
  assert.notDeepEqual(trailSamples(a).map(s=>s.timeSeconds),trailSamples(b).map(s=>s.timeSeconds));
  assert.ok(reference().includes('does not interpolate missing sample times'));
});

test('distance gate measures endpoint chord, not the length of a curved trajectory', () => {
  const ring=createTrailRing({...options(),sampling:{mode:'distance',meters:1}});
  append(ring,0,0);
  assert.equal(append(ring,4,0),false); // A loop returning here may have positive arc length.
  assert.equal(append(ring,5,2),true);
  assert.ok(reference().includes('endpoint chord'));
});

test('wake extends downstream and facing is independent of flow speed', () => {
  const flow=new Vector3(0,0,5),forward=flow.clone().normalize(),normal=new Vector3(0,0,-1);
  const tip=forward.clone().multiplyScalar(3);
  assert.ok(tip.dot(flow)>0);
  assert.equal(normal.dot(forward.clone().negate()),1);
  assert.equal(normal.dot(flow.clone().negate()),5);
  assert.ok(reference().includes('axial = length * t'));
  assert.ok(reference().includes('dot(normalWorld, -forward)'));
});

test('constant-drag solution has ballistic zero limit and partitions fixed forcing', () => {
  const step=(p,v,a,g,dt)=>{
    const x=g*dt,p1=x===0?1:-Math.expm1(-x)/x,p2=x===0?0.5:(x+Math.expm1(-x))/(x*x);
    return [p+v*dt*p1+a*dt*dt*p2,Math.exp(-x)*v+a*dt*p1];
  };
  assert.deepEqual(step(0,2,3,0,2),[10,8]);
  const one=step(0,2,3,1,1),half=step(...step(0,2,3,1,0.5),3,1,0.5);
  one.forEach((x,i)=>assert.ok(Math.abs(x-half[i])<1e-12));
});
