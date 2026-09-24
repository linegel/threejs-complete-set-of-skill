import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { Timer, AnimationMixer, AnimationClip, NumberKeyframeTrack, Object3D, LoopOnce, Quaternion, Vector3 } from 'three';

const reference = () => readFileSync(new URL('../../skills/threejs-procedural-motion-systems/references/procedural-motion-and-docking-systems.md', import.meta.url), 'utf8').replace(/\s+/g,' ');
const close = (a,b,e=1e-10) => assert.ok(Math.abs(a-b)<e, `${a} versus ${b}`);
function clipFixture() {
  const object = new Object3D(), mixer = new AnimationMixer(object);
  const clip = new AnimationClip('x',1,[new NumberKeyframeTrack('.position[x]',[0,1],[0,10])]);
  const action = mixer.clipAction(clip).setLoop(LoopOnce,1); action.clampWhenFinished=true; action.play();
  return {object,mixer,action,close() {mixer.stopAllAction();mixer.uncacheRoot(object);}};
}

test('Timer reset keeps elapsed/delta and visibility suppresses hidden time', () => {
  let now=1000, listener;
  const clock = mock.method(performance,'now',()=>now);
  const doc = {hidden:false,addEventListener:(_name,fn)=>{listener=fn;},removeEventListener:()=>{listener=null;}};
  const timer = new Timer(); timer.connect(doc); timer.setTimescale(2);
  try {
    now=2000; timer.update(now); assert.equal(timer.getElapsed(),2);
    timer.reset(); assert.equal(timer.getElapsed(),2); assert.equal(timer.getDelta(),2);
    doc.hidden=true; now=9000; timer.update(now); assert.equal(timer.getDelta(),0); assert.equal(timer.getElapsed(),2);
    doc.hidden=false; listener(); now+=16; timer.update(now); close(timer.getDelta(),0.032); close(timer.getElapsed(),2.032);
    assert.ok(reference().includes('reset() does not zero elapsed'));
  } finally {timer.dispose();clock.mock.restore();}
  assert.equal(listener,null);
});

test('mixer setTime does not revive a finished action or reconstruct its schedules', () => {
  const f=clipFixture();
  try {
    f.mixer.setTime(2); assert.equal(f.action.paused,true); assert.equal(f.object.position.x,10);
    f.mixer.setTime(0.5); assert.notEqual(f.object.position.x,5);
    f.action.reset().play(); f.mixer.setTime(0.5); close(f.object.position.x,5);
    f.action.stop(); f.mixer.setTime(0.5); assert.equal(f.action.isScheduled(),false);
    assert.ok(reference().includes('setTime() is not a complete replay'));
  } finally {f.close();}
});

test('mixer seek input is scaled by mixer timeScale', () => {
  const f=clipFixture();
  try {
    f.mixer.timeScale=0.5; f.mixer.setTime(0.5);
    close(f.mixer.time,0.25); close(f.object.position.x,2.5);
    f.mixer.timeScale=0; f.action.reset().play(); f.mixer.setTime(0.5);
    close(f.object.position.x,0);
  } finally {f.close();}
});

test('quaternion endpoint interpolation cannot represent a complete authored revolution', () => {
  const axis=new Vector3(0,0,1), start=new Quaternion(), end=new Quaternion().setFromAxisAngle(axis,2*Math.PI);
  const point=new Vector3(1,0,0);
  close(point.clone().applyQuaternion(start.slerp(end,0.5)).x,1);
  close(point.clone().applyQuaternion(new Quaternion().setFromAxisAngle(axis,Math.PI)).x,-1);
  assert.ok(reference().includes('unwrapped angle'));
});

test('release differentiates parent transport and local displacement once', () => {
  const point=t=>new Vector3(2+t,0,0).applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),t));
  const h=1e-6, velocity=point(h).sub(point(-h)).multiplyScalar(1/(2*h));
  close(velocity.x,1); close(velocity.y,2);
  assert.ok(reference().includes('R_parent * v_local'));
});

test('locked docking has zero relative velocity but inherits a moving port', () => {
  const r=new Vector3(3,0,0), omega=new Vector3(0,0,2), originVelocity=new Vector3(1,0,0);
  const portVelocity=originVelocity.clone().add(omega.clone().cross(r));
  assert.deepEqual(portVelocity.toArray(),[1,6,0]);
  assert.ok(reference().includes('zero relative velocity'));
});

test('motion vector history uses last presented pose rather than the prior simulation tick', () => {
  const previousTick=0,currentTick=10, priorPresented=4, currentPresented=7;
  assert.equal(currentPresented-priorPresented,3);
  assert.notEqual(currentTick-previousTick,currentPresented-priorPresented);
  assert.ok(reference().includes('previous presented pose'));
});

test('small exponential follow increments survive cancellation', () => {
  const rate=1e-18,dt=1;
  assert.equal(1-Math.exp(-rate*dt),0);
  assert.equal(-Math.expm1(-rate*dt),1e-18);
  assert.ok(reference().includes('expm1'));
});
