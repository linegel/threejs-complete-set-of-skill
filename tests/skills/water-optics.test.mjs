import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { boundedHeightfieldDispersion } from '../../skills/threejs-water-optics/scripts/bounded-heightfield-dispersion.mjs';
const root = new URL('../../skills/threejs-water-optics/references/', import.meta.url);
const surface = readFileSync(new URL('water-surface-system.md', root), 'utf8');
const coastal = readFileSync(new URL('coastal-water-system.md', root), 'utf8');
const ordinary = { c: 1, dt: 0.1, dx: 1, dz: 1, kx: 0.2, kz: 0.3 };

test('the Nyquist corner at the CFL boundary is marginal, not admitted stable work', () => {
  const result = boundedHeightfieldDispersion({ c: 1, dt: 1, dx: 1.25, dz: 5 / 3, kx: Math.PI / 1.25, kz: Math.PI / (5 / 3) });
  assert.equal(result.cflSum, 1);
  assert.equal(result.stable, false);
  let height = 1, velocity = 0;
  for (let i = 0; i < 10; i++) { velocity -= 4 * height; height += velocity; }
  assert.equal(height, 21);
});

test('the reported discrete phase agrees with the update matrix', () => {
  const r = boundedHeightfieldDispersion(ordinary);
  const laplacianMagnitude = 4 * (Math.sin(ordinary.kx / 2) ** 2 + Math.sin(ordinary.kz / 2) ** 2);
  const trace = 2 - ordinary.dt ** 2 * laplacianMagnitude;
  assert.ok(Math.abs(Math.cos(r.omegaDiscrete * ordinary.dt) - trace / 2) < 1e-12);
  assert.equal(r.admissible, true);
});

test('DC has no phase speed and aliases are not admitted physical modes', () => {
  const dc = boundedHeightfieldDispersion({ ...ordinary, kx: 0, kz: 0 });
  assert.equal(dc.omegaDiscrete, 0);
  assert.equal(dc.phaseSpeedDiscrete, null);
  assert.equal(dc.relativePhaseError, null);
  const alias = boundedHeightfieldDispersion({ ...ordinary, kx: 2 * Math.PI });
  assert.equal(alias.represented, false);
  assert.equal(alias.admissible, false);
});

test('nonfinite derived arithmetic cannot become a dispersion report', () => {
  assert.throws(() => boundedHeightfieldDispersion({ ...ordinary, c: 1e308 }), /finite/);
  assert.throws(() => boundedHeightfieldDispersion({ ...ordinary, dx: 1e308, kx: 1e308 }), /finite/);
  assert.throws(() => boundedHeightfieldDispersion({ ...ordinary, c: 1e-308, kx: 1e-308, kz: 0 }), /representable/);
});

test('a tiny positive extinction can still have unit scattering albedo', () => {
  const scattering = 1e-12, absorption = 0, length = 1e12;
  const albedo = scattering / (scattering + absorption);
  assert.equal(albedo, 1);
  assert.equal(scattering / Math.max(scattering, 1e-6), 1e-6);
  assert.ok(1 - Math.exp(-(scattering + absorption) * length) > 0.6);
  assert.ok(surface.includes('omega_0 = sigma_s/sigma_t'));
});

test('normal-incidence flux and physical radiance use different refractive factors', () => {
  const cameraIndex = 1, pathIndex = 4 / 3;
  const F = ((cameraIndex - pathIndex) / (cameraIndex + pathIndex)) ** 2;
  assert.ok(Math.abs(F + (1 - F) - 1) < 1e-12);
  assert.notEqual((cameraIndex / pathIndex) ** 2 * (1 - F), 1 - F);
  assert.ok(surface.includes('(n_camera/n_path)^2'));
});

test('shoreward phase from a coast arrival-time field moves toward decreasing distance', () => {
  const speed = 2, omega = 1, initial = 10, elapsed = 1;
  const phase = (r, t) => -omega * (r / speed + t);
  assert.equal(phase(initial, 0), phase(initial - speed * elapsed, elapsed));
  assert.ok(coastal.includes('T_toCoast+t'));
});

test('a varying current conserves action flux, not the current-free energy flux', () => {
  const actionFlux = 4, sigmaA = 2, sigmaB = 1, speedA = 4, speedB = 2;
  const energyA = actionFlux * sigmaA / speedA;
  const energyB = actionFlux * sigmaB / speedB;
  assert.equal(energyA / sigmaA * speedA, energyB / sigmaB * speedB);
  assert.notEqual(energyA * speedA, energyB * speedB);
  assert.ok(coastal.includes('(E_b/sigma_i) V_tube b = constant'));
});

test('canonical outgoing face limiting preserves water across neighboring cells', () => {
  const left = 1, right = 0, proposed = 2, limited = Math.min(left, proposed);
  assert.equal((left - limited) + (right + limited), left + right);
  assert.notEqual(Math.max(0, left - proposed) + (right + proposed), left + right);
  assert.ok(coastal.includes('same limited canonical face flux'));
});

test('zero-mean forcing alone does not preserve a heightfields initial mean', () => {
  let meanHeight = 0, meanVelocity = 1;
  for (let step = 0; step < 10; step++) meanHeight += 0.1 * meanVelocity;
  assert.ok(Math.abs(meanHeight - 1) < 1e-12);
  assert.ok(surface.includes('initial mean velocity'));
});

test('caustic power must not be added on top of its unmodified receiver light', () => {
  const incident = 10, reflection = 1, absorbed = 3, deposited = 6;
  assert.equal(reflection + absorbed + deposited, incident);
  assert.ok(reflection + absorbed + deposited + deposited > incident);
  assert.ok(surface.includes('replace the corresponding receiver direct-light term'));
});
