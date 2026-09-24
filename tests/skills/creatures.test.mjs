import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';

const body = () => readFileSync(new URL('../../skills/threejs-procedural-creatures/references/creature-body-systems.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual-expected) <= tolerance, `${actual} versus ${expected}`);

test('skinning is pose times inverse bind, followed by one instance root', () => {
  const bind = new Matrix4().makeTranslation(0,2,0);
  const pose = new Matrix4().makeTranslation(0,3,0);
  const root = new Matrix4().makeTranslation(10,0,0);
  const restPoint = new Vector3(0,2,0);
  const deformed = restPoint.clone().applyMatrix4(bind.clone().invert()).applyMatrix4(pose).applyMatrix4(root);
  assert.deepEqual(deformed.toArray(), [10,3,0]);
  assert.deepEqual(restPoint.clone().applyMatrix4(pose).applyMatrix4(root).toArray(), [10,5,0]);
  assert.ok(body().includes('poseLocal * inverse(bindLocal)'));
});

test('tapered primitive raw derivative includes radius slope', () => {
  const value = (x,y) => Math.abs(x) - (0.2 + 0.3 * y / 2);
  const h = 1e-6, dx = (value(1+h,1)-value(1-h,1))/(2*h), dy = (value(1,1+h)-value(1,1-h))/(2*h);
  close(dx, 1, 1e-9); close(dy, -0.15, 1e-9);
  assert.ok(Math.hypot(dx,dy) > 1);
  assert.ok(body().includes('degenerate segment'));
});

test('spatially varying smooth-min width contributes its own derivative', () => {
  const d = x => - (1 + 2*x) / 4; // both primitive distances zero, h = 1/2
  const finiteDifference = (d(1e-6)-d(-1e-6))/2e-6;
  close(finiteDifference, -0.5, 1e-9);
  assert.ok(body().includes('- h*(1-h)*grad(k)'));
});

test('small omitted value does not bound normal direction near a cancelled gradient', () => {
  const scale = 1e-8;
  const full = new Vector3(scale,0,0), approximate = new Vector3(0,scale,0);
  assert.ok(full.clone().sub(approximate).length() < 2e-8);
  close(full.angleTo(approximate), Math.PI/2);
  assert.ok(body().includes('gradient-error bound and a positive gradient norm floor'));
});

function scaledReach(l1, l2, targetDistance) {
  if (![l1,l2,targetDistance].every(Number.isFinite) || l1 <= 0 || l2 <= 0 || targetDistance < 0) throw new RangeError('invalid limb inputs');
  const scale = Math.max(l1,l2), a1 = l1/scale, a2 = l2/scale;
  const margin = Math.min(a1,a2) * 1e-6;
  const d = Math.max(Math.abs(a1-a2)+margin, Math.min(targetDistance/scale, a1+a2-margin));
  const along = (a1*a1-a2*a2+d*d)/(2*d);
  return {knee:[along*scale, Math.sqrt(Math.max(0,a1*a1-along*along))*scale], end:d*scale};
}

test('IK clamps the endpoint with a relative margin over different limb scales', () => {
  for (const scale of [1e-9,1,1e9]) {
    const l1=scale, l2=0.7*scale, result=scaledReach(l1,l2,10*scale);
    close(Math.hypot(...result.knee)/l1, 1, 1e-9);
    close(Math.hypot(result.end-result.knee[0],result.knee[1])/l2, 1, 1e-9);
    assert.ok(result.end < l1+l2);
  }
  assert.ok(1e-4 > 2e-8, 'a fixed reach floor exceeds the complete tiny limb');
  assert.ok(body().includes('resolvedTarget = hip + direction*d'));
});

test('support point velocity includes angular motion at the planted point', () => {
  const centerVelocity = new Vector3(0,0,0), angular = new Vector3(0,0,2), radius = new Vector3(3,0,0);
  const pointVelocity = centerVelocity.clone().add(angular.clone().cross(radius));
  assert.deepEqual(pointVelocity.toArray(), [0,6,0]);
  assert.equal(pointVelocity.clone().sub(pointVelocity).length(), 0, 'co-moving body has zero relative velocity');
  assert.ok(body().includes('v_linear + cross(omega, point - origin)'));
});

test('quaternion interpolation preserves a rigid limb that endpoint lerp shortens', () => {
  const start = new Quaternion(), finish = new Quaternion().setFromAxisAngle(new Vector3(0,0,1), Math.PI/2);
  const point = new Vector3(1,0,0);
  close(point.clone().lerp(point.clone().applyQuaternion(finish), 0.5).length(), Math.SQRT1_2);
  close(point.clone().applyQuaternion(start.slerp(finish,0.5)).length(), 1);
});

function damped(e,v,w,dt) {
  const q = Math.exp(-w*dt), a = v+w*e;
  return [(e+a*dt)*q, (v-w*a*dt)*q];
}

test('closed-form damping uses relative velocity for a linearly moving goal', () => {
  const one = damped(1,0.2,3,1);
  let partitioned = [1,0.2];
  for (let i=0;i<10;i++) partitioned = damped(...partitioned,3,0.1);
  close(partitioned[0],one[0]); close(partitioned[1],one[1]);
  assert.deepEqual(damped(0,0,3,1), [0,0]);
  assert.notEqual(damped(0,2,3,1)[0], 0, 'world velocity two is not error velocity for a goal moving at two');
  assert.ok(body().includes('v = velocity - goalVelocity'));
  assert.ok(Number.isNaN(damped(1,1,1e200,1e200)[0]));
  assert.ok(body().includes('settled exponential limit'));
});

test('a later unconstrained pose edit can break a previously exact planted contact', () => {
  const solved = new Vector3(0,0,0), planted = solved.clone();
  solved.y += 0.2;
  assert.equal(solved.distanceTo(planted), 0.2);
  assert.ok(body().includes('recheck contacts and limits after all writers'));
});
