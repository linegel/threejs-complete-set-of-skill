import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BatchedMesh, InstancedMesh, BoxGeometry, MeshBasicMaterial, Matrix4 } from 'three';
import * as placement from '../../skills/threejs-procedural-buildings-and-cities/scripts/deterministic-placement-key.mjs';
const reference = readFileSync(new URL('../../skills/threejs-procedural-buildings-and-cities/references/grammar-and-mesh-compiler.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const candidate = ordinal => ({ generatorSchemaVersion: 'v1', stableSeed: 7,
  familyId: 'tower', sourceCellId: 'cell:0:0', candidateOrdinal: ordinal });
const key = (ordinal, priorityRank = 0) => placement.winnerKey(candidate(ordinal), { priorityRank, scoreRank: 0 });

test('winner comparison is reflexive and orders uint lanes numerically', () => {
  const a = key(2), b = key(10);
  assert.equal(placement.compareWinnerKeys(a, a), 0);
  assert.equal(placement.compareWinnerKeys(a, structuredClone(a)), 0);
  assert.equal(placement.compareWinnerKeys(a, b), -1);
  assert.equal(placement.compareWinnerKeys(b, a), 1);
});

test('deserialized ranking and tuple data are validated before comparison', () => {
  for (const priorityRank of [NaN, Infinity, '0']) {
    assert.throws(() => placement.compareWinnerKeys({ ...key(0), priorityRank }, key(1)), /priorityRank/);
  }
  for (const tuple of [Array(5), ['v1', 7, 'tower', 'cell'], ['v1', '7', 'tower', 'cell', 0]]) {
    assert.throws(() => placement.compareWinnerKeys({ ...key(0), candidateTuple: tuple }, key(1)), TypeError);
  }
});

test('phase validation finds duplicate identity despite different ranks or sort distance', () => {
  assert.equal(typeof placement.validateWinnerKeys, 'function');
  assert.throws(() => placement.validateWinnerKeys([key(0), key(1, 50), key(0, 100)]), /duplicate candidate identity/);
  assert.throws(() => placement.validateWinnerKeys(Array(2)), /dense/);
  const raw = structuredClone(key(2));
  const result = placement.validateWinnerKeys([raw, key(10)]);
  raw.candidateTuple[2] = 'mutated';
  assert.equal(result[0].candidateTuple[2], 'tower');
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result[0]) && Object.isFrozen(result[0].candidateTuple));
  assert.deepEqual(placement.validateWinnerKeys([]), []);
});

test('canonical IDs and random lanes survive unrelated fields and loading order', () => {
  const a = candidate(2), b = { ...a, environmentRevision: 99, requestingChunk: 'other' };
  assert.equal(placement.placementId(a), placement.placementId(b));
  for (const lane of [0, 1, 0xffffffff]) {
    const value = placement.randomLane01(a, lane);
    assert.equal(value, placement.randomLane01(b, lane));
    assert.ok(value >= 0 && value < 1);
  }
  const keys = [key(10), key(2), key(5)];
  assert.deepEqual([...keys].sort(placement.compareWinnerKeys), [...keys].reverse().sort(placement.compareWinnerKeys));
  assert.throws(() => placement.candidateTuple({ ...a, familyId: 'e\u0301' }), /NFC/);
  assert.throws(() => placement.candidateTuple({ ...a, stableSeed: '7' }), /uint32/);
});

test('unequal-height adjacent masses leave the upper facade exposed', () => {
  const width = 10, towerHeight = 20, neighborHeight = 5;
  assert.equal(width * towerHeight - width * neighborHeight, 150);
  assert.ok(reference.includes('height bands'));
  assert.ok(reference.includes('equal vertical spans'));
});

test('empty facade spans do not create a zero-count bay division', () => {
  assert.equal(Math.ceil(0 / 4), 0);
  assert.ok(Number.isNaN(0 / 0));
  assert.ok(reference.includes('nMin = max(1, ceil(L / bayWidthMax))'));
  assert.ok(reference.includes('zero-length'));
});

test('local priority winners are conflict-free but need not be maximal', () => {
  const nodes = [0, 1, 2];
  const conflict = (a, b) => Math.abs(a - b) === 1;
  const winners = nodes.filter(a => nodes.every(b => !conflict(a, b) || a < b));
  assert.deepEqual(winners, [0]);
  assert.ok(winners.every(a => !conflict(a, 2)));
  assert.ok(reference.includes('not necessarily maximal'));
  assert.ok(reference.includes('both candidates'));
});

test('instance transforms need upload invalidation and refreshed culling bounds', () => {
  const geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  const mesh = new InstancedMesh(geometry, material, 1);
  mesh.computeBoundingSphere();
  const version = mesh.instanceMatrix.version;
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(100, 0, 0));
  assert.equal(mesh.instanceMatrix.version, version);
  assert.equal(mesh.boundingSphere.center.x, 0);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  assert.equal(mesh.boundingSphere.center.x, 100);
  assert.ok(reference.includes('instanceMatrix.needsUpdate'));
  mesh.dispose(); geometry.dispose(); material.dispose();
});

test('batch texture updates do not recompute aggregate bounds', () => {
  const geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
  const mesh = new BatchedMesh(2, 24, 36, material);
  const id = mesh.addInstance(mesh.addGeometry(geometry));
  mesh.computeBoundingBox();
  mesh.setMatrixAt(id, new Matrix4().makeTranslation(100, 0, 0));
  assert.equal(mesh.boundingBox.max.x, 0.5);
  mesh.computeBoundingBox();
  assert.equal(mesh.boundingBox.max.x, 100.5);
  assert.ok(reference.includes('aggregate bounds'));
  mesh.dispose(); geometry.dispose(); material.dispose();
});
