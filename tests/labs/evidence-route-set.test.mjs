import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalSha256,
  routeSetDigest,
  routeStateDigest,
} from '../../scripts/lib/evidence-manifest-contract.mjs';
import { validateEvidenceBundle } from '../../scripts/lib/evidence-v2.mjs';
import {
  createUnifiedReleaseBundleFixture,
  readFixtureManifest,
  rebindFixturePromotion,
  writeFixtureManifest,
} from './unified-release-fixture.mjs';

function physicalRoute() {
  const route = {
    path: '/demos/webgpu-validation-harness/mechanism/resource-ledger/',
    scenario: 'browser-capture',
    mechanism: 'resource-ledger',
    mode: 'resources',
    tier: 'release',
    camera: 'design',
    seed: '0x00000001',
    timeSeconds: {
      value: 2,
      unit: 'seconds',
      label: 'Authored',
      source: 'fixed resource-ledger review route',
    },
  };
  route.stateDigest = routeStateDigest(route);
  return route;
}

function createMultiRouteFixture() {
  const directory = createUnifiedReleaseBundleFixture();
  const manifest = readFixtureManifest(directory);
  const reviewedRoute = physicalRoute();
  manifest.routeSet = [structuredClone(manifest.route), reviewedRoute];
  const physical = manifest.captureSessions.find((session) => session.profile === 'physical-route');
  physical.routePath = reviewedRoute.path;
  physical.routeDigest = canonicalSha256(reviewedRoute);
  physical.stateDigest = reviewedRoute.stateDigest;
  physical.routeSetPaths = manifest.routeSet.map((route) => route.path);
  physical.routeSetDigest = routeSetDigest(manifest.routeSet);
  rebindFixturePromotion(manifest);
  writeFixtureManifest(directory, manifest);
  return { directory, manifest, reviewedRoute };
}

test('release route sets bind each capture lane to the exact route it executed', () => {
  const { directory } = createMultiRouteFixture();
  const result = validateEvidenceBundle(directory);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('one capture session can bind every route it executed without fabricating duplicate sessions', () => {
  const { directory, manifest } = createMultiRouteFixture();
  const physical = manifest.captureSessions.find((session) => session.profile === 'physical-route');
  assert.deepEqual(physical.routeSetPaths, manifest.routeSet.map((route) => route.path));
  assert.equal(physical.routeSetDigest, routeSetDigest(manifest.routeSet));
  const result = validateEvidenceBundle(directory);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('canonical scenario query routes bind the query to the locked scenario state', () => {
  const { directory, manifest } = createMultiRouteFixture();
  const queryRoute = manifest.routeSet[1];
  queryRoute.path = '/demos/webgpu-validation-harness/?scenario=visual-error-metrics';
  queryRoute.scenario = 'visual-error-metrics';
  queryRoute.stateDigest = routeStateDigest(queryRoute);
  const physical = manifest.captureSessions.find((session) => session.profile === 'physical-route');
  physical.routePath = queryRoute.path;
  physical.routeDigest = canonicalSha256(queryRoute);
  physical.stateDigest = queryRoute.stateDigest;
  physical.routeSetPaths = manifest.routeSet.map((route) => route.path);
  physical.routeSetDigest = routeSetDigest(manifest.routeSet);
  rebindFixturePromotion(manifest);
  writeFixtureManifest(directory, manifest);
  const result = validateEvidenceBundle(directory);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('scenario query routes reject state mismatches and noncanonical query syntax', () => {
  for (const path of [
    '/demos/webgpu-validation-harness/?scenario=visual-error-metrics',
    '/demos/webgpu-validation-harness/?scenario=visual-error-metrics&mode=final',
    '/demos/webgpu-validation-harness/?mode=final',
    '/demos/webgpu-validation-harness/?scenario=Visual-Error',
    '/demos/webgpu-validation-harness/#visual-error-metrics',
  ]) {
    const { directory, manifest } = createMultiRouteFixture();
    const queryRoute = manifest.routeSet[1];
    queryRoute.path = path;
    queryRoute.scenario = 'browser-capture';
    queryRoute.stateDigest = routeStateDigest(queryRoute);
    const physical = manifest.captureSessions.find((session) => session.profile === 'physical-route');
    physical.routePath = queryRoute.path;
    physical.routeDigest = canonicalSha256(queryRoute);
    physical.stateDigest = queryRoute.stateDigest;
    physical.routeSetPaths = manifest.routeSet.map((route) => route.path);
    physical.routeSetDigest = routeSetDigest(manifest.routeSet);
    rebindFixturePromotion(manifest);
    writeFixtureManifest(directory, manifest);
    const result = validateEvidenceBundle(directory);
    assert.equal(result.valid, false, `noncanonical or mismatched route unexpectedly validated: ${path}`);
  }
});

test('route-set membership, canonical inclusion, route digests, and unique paths are enforced', () => {
  for (const mutate of [
    (manifest) => { manifest.routeSet = [manifest.route]; },
    (manifest) => { manifest.captureSessions.find((session) => session.profile === 'physical-route').routeDigest = canonicalSha256('forged'); },
    (manifest) => { manifest.routeSet[0] = structuredClone(manifest.routeSet[1]); },
    (manifest) => { manifest.routeSet[1].path = manifest.routeSet[0].path; },
    (manifest) => {
      const physical = manifest.captureSessions.find((session) => session.profile === 'physical-route');
      physical.routeSetPaths = [manifest.route.path];
      physical.routeSetDigest = routeSetDigest([manifest.route]);
    },
    (manifest) => { manifest.captureSessions.find((session) => session.profile === 'physical-route').routeSetDigest = canonicalSha256('forged route set'); },
    (manifest) => { delete manifest.captureSessions.find((session) => session.profile === 'physical-route').routeSetDigest; },
    (manifest) => { delete manifest.captureSessions.find((session) => session.profile === 'physical-route').routeSetPaths; },
  ]) {
    const { directory, manifest } = createMultiRouteFixture();
    mutate(manifest);
    rebindFixturePromotion(manifest);
    writeFixtureManifest(directory, manifest);
    const result = validateEvidenceBundle(directory);
    assert.equal(result.valid, false, 'route-set mutation unexpectedly validated');
  }
});
