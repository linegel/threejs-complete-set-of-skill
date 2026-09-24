import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { integratePhysicalAreaFlux, partitionExtensiveTransfer, closeReceiverMassLedger } from '../../skills/threejs-rain-snow-and-wet-surfaces/examples/physical-area-deposition.mjs';
const root = new URL('../../skills/threejs-rain-snow-and-wet-surfaces/references/', import.meta.url);
const motion = readFileSync(new URL('precipitation-motion.md', root), 'utf8');
const receiver = readFileSync(new URL('receiver-weathering.md', root), 'utf8');
const limits = { absoluteKg: 1e-12, relative: 1e-12 };

test('physical area and disjoint time partitions preserve one transfer', () => {
  const input = { fluxKgPerM2S: [0.2, 0.4], areaM2BySample: [2, 3], dtSeconds: 5 };
  const whole = integratePhysicalAreaFlux(input);
  assert.equal(whole.representedAreaM2, 5);
  assert.equal(whole.transferredMassKg, 8);
  const part = integratePhysicalAreaFlux({ ...input, dtSeconds: 2.5 });
  assert.equal(2 * part.transferredMassKg, whole.transferredMassKg);
});

test('overflowed impact fractions cannot pass as a zero-mass partition', () => {
  assert.throws(() => partitionExtensiveTransfer({ parentMassKg: 0,
    fractions: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
    limits, fractionTolerance: 0 }), /finite/);
});

test('partitions reject malformed numeric views and close without normalization', () => {
  assert.throws(() => partitionExtensiveTransfer({ parentMassKg: 3,
    fractions: new DataView(new ArrayBuffer(8)), limits, fractionTolerance: 0 }), TypeError);
  assert.throws(() => partitionExtensiveTransfer({ parentMassKg: 3,
    fractions: [0.2, 0.2], limits, fractionTolerance: 1e-12 }), /no normalization/);
  const result = partitionExtensiveTransfer({ parentMassKg: 8,
    fractions: [0.25, 0.75], limits, fractionTolerance: 0 });
  assert.deepEqual(result.childMassKg, [2, 6]);
  assert.equal(result.residualKg, 0);
});

test('refreeze is one equal and opposite transfer between liquid and snow', () => {
  const liquid = 3, snow = 2, freeze = 1, melt = 0.25;
  const finalLiquid = liquid - freeze + melt, finalSnow = snow + freeze - melt;
  assert.equal(closeReceiverMassLedger({ priorMassKg: liquid + snow,
    incomingMassKg: 0, outgoingMassKg: 0, finalMassKg: finalLiquid + finalSnow, limits }).residualKg, 0);
  assert.match(receiver, /- refreeze - drainage/);
});

test('nonuniform object scale needs inverse-linear displacement, not a local normal scalar', () => {
  const linear = new Matrix3().setFromMatrix4(new Matrix4().makeScale(3, 1, 0.5));
  const localNormal = new Vector3(1, 1, 0).normalize();
  const worldNormal = localNormal.clone().applyMatrix3(linear.clone().invert().transpose()).normalize();
  const wanted = worldNormal.clone().multiplyScalar(0.1);
  const localOffset = wanted.clone().applyMatrix3(linear.clone().invert());
  assert.ok(localOffset.clone().applyMatrix3(linear).distanceTo(wanted) < 1e-12);
  assert.ok(localNormal.clone().multiplyScalar(0.1).applyMatrix3(linear).distanceTo(wanted) > 0.1);
  assert.match(receiver, /inverse linear\s+transform/);
});

test('receiver arrival flux uses relative velocity and the actual surface normal', () => {
  const rho = 0.2, particle = new Vector3(0, -4, 0), receiverVelocity = new Vector3(0, -1, 0);
  const normal = new Vector3(0, 1, 0), tilted = new Vector3(0, 0.5, Math.sqrt(0.75));
  const relative = particle.sub(receiverVelocity);
  assert.ok(Math.abs(rho * Math.max(0, -relative.dot(normal)) - 0.6) < 1e-12);
  assert.ok(Math.abs(rho * Math.max(0, -relative.dot(tilted)) - 0.3) < 1e-12);
  assert.ok(motion.includes('v_particle - v_receiver'));
});

test('stationary seed trajectories integrate wind from their own birth instant', () => {
  const displacement = t => t * t / 2, birth = 3, time = 5;
  assert.equal(displacement(time) - displacement(birth), 8);
  assert.notEqual(displacement(time), 8);
  assert.ok(motion.includes('integral_tBirth^t'));
});
