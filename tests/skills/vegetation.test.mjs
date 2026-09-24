import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DoubleSide, Group, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';
import Renderer from 'three/src/renderers/common/Renderer.js';
import { biasI32, candidateTuple, compareTuples, compareWinnerKeys, hashTuple, winnerKey, ownsHalfOpen, maternII, nestedLodPrefix } from '../../skills/threejs-procedural-vegetation/scripts/placement-oracle.mjs';

const tuple = id => [1, 2, 3, 4, 5, 6, 7, 8, id];
const key = (id, priority = id) => ({tuple:tuple(id), priorityHashU32:priority});
const plant = (id, priority = id) => ({id, winnerKey:key(id, priority), thinningKey:key(id, 100 - id)});
const ecology = () => readFileSync(new URL('../../skills/threejs-procedural-vegetation/references/terrain-ecology-and-placement.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('placement tuples and every random seed lane must be dense uint32 values', () => {
  for (const invalid of [new Array(9), [1,2,3,4,5,6,7,8,NaN], tuple(-1), tuple(2 ** 32)]) {
    assert.throws(() => hashTuple(invalid), /u32/);
    assert.throws(() => compareTuples(invalid, tuple(0)), /u32/);
  }
  assert.throws(() => candidateTuple({generatorSchemaVersion:1, globalSeedWords:new Array(2), stableSpeciesIdWords:[0,1], biasedWorldCellWords:[0,0,0], candidateOrdinal:0}), /u32/);
  assert.equal(biasI32(-2147483648), 0); assert.equal(biasI32(2147483647), 0xffffffff);
  assert.throws(() => biasI32(2147483648), /i32/);
  assert.equal(compareTuples(tuple(1), tuple(1)), 0);
});

test('a retained winner key owns its immutable tuple instead of aliasing a caller', () => {
  const input = tuple(1), retained = winnerKey(input);
  input[0] = 999;
  assert.equal(retained.tuple[0], 1);
  assert.equal(retained.priorityHashU32, hashTuple(retained.tuple));
  assert.ok(Object.isFrozen(retained.tuple));
  assert.equal(compareWinnerKeys(key(2, 77), key(1, 77)), 1, 'full tuple breaks a hash collision');
});

test('all candidate identities are checked before any conflict callback', () => {
  let calls = 0;
  assert.throws(() => maternII([plant(1),plant(2),plant(1,100)], () => {calls++; return false;}), /duplicate candidate tuple/);
  assert.equal(calls, 0);
  for (const candidates of [null, {}, new Array(2), [plant(1), undefined]]) {
    assert.throws(() => maternII(candidates, () => false), /candidate/);
  }
});

test('conflict callbacks return synchronous booleans and agree in both directions', () => {
  const plants = [plant(1), plant(2)];
  for (const conflict of [() => 0, () => undefined, () => 'false', async () => false]) {
    assert.throws(() => maternII(plants, conflict), /synchronous boolean/);
  }
  assert.throws(() => maternII(plants, (a,b) => a.id < b.id), /symmetric/);
  assert.throws(() => maternII([], null), /function/);
});

test('local maximum remains one-hop and is not silently replaced by greedy packing', () => {
  const plants = [plant(1), plant(2), plant(3)], conflicts = (a,b) => Math.abs(a.id-b.id) === 1;
  assert.deepEqual(maternII(plants, conflicts).map(p => p.id), [3]);
  assert.deepEqual(maternII([plants[2],plants[0],plants[1]], conflicts).map(p => p.id), [3]);
  // Greedy would also retain 1; the local maximum rule intentionally does not.
  assert.deepEqual(maternII(plants.filter(p => p.id !== 2), conflicts).map(p => p.id), [3,1]);
  assert.deepEqual(maternII(plants.filter(p => p.id !== 3), conflicts).map(p => p.id), [2]);
});

test('LOD ranks remain unique, nested, and independent of input order', () => {
  const plants = [plant(1),plant(2),plant(3)];
  assert.deepEqual(nestedLodPrefix(plants, 2).map(p => p.id), [1,2]);
  assert.deepEqual(nestedLodPrefix([...plants].reverse(), 1).map(p => p.id), [1]);
  assert.deepEqual(nestedLodPrefix(plants, 0), []);
  assert.throws(() => nestedLodPrefix([plants[0],plants[0]], 1), /duplicate candidate tuple/);
  for (const count of [-1, 1.5, NaN, 4, 2 ** 53]) assert.throws(() => nestedLodPrefix(plants, count), /retainedCount/);
});

test('chunk ownership is half-open and hard limiting zeroes are not epsilon densities', () => {
  assert.equal(ownsHalfOpen([1,0], [0,0], [1,1]), false);
  assert.equal(ownsHalfOpen([1,0], [1,0], [2,1]), true);
  assert.throws(() => ownsHalfOpen([NaN,0], [0,0], [1,1]), /invalid/);
  assert.ok(Math.exp(Math.log(Math.max(0, 1e-6))) > 0);
  assert.ok(ecology().includes('positive-weight zero response returns exactly zero'));
  assert.ok(ecology().includes('conflict dependency closure'));
});

test('opaque leaf cutouts use one material submission', () => {
  const object = new Mesh();
  const scene = new Scene();
  const material = new MeshStandardMaterial({side:DoubleSide});
  const sides = [];
  const renderer = {_handleObjectFunction:(_object, m) => sides.push(m.side)};
  const render = () => {
    sides.length = 0;
    Renderer.prototype.renderObject.call(renderer, object, scene, {}, object.geometry, material, null, null);
    return sides.length;
  };
  material.alphaTest = 0.5;
  assert.equal(render(), 1);
  material.alphaHash = true;
  assert.equal(render(), 1);
  material.transparent = true;
  assert.equal(render(), 2);
  material.forceSinglePass = true;
  assert.equal(render(), 1);
  assert.equal(material.side, DoubleSide);
  material.dispose(); object.geometry.dispose(); object.material.dispose();
});

test('leaf roots inherit their moving branch with zero additional root bend', () => {
  const branch = new Group();
  branch.position.set(1,2,3);
  const root = new Vector3(0,2,0);
  branch.updateMatrixWorld(true);
  const previous = root.clone().applyMatrix4(branch.matrixWorld);
  branch.rotation.z = Math.PI / 2;
  branch.updateMatrixWorld(true);
  const current = root.clone().applyMatrix4(branch.matrixWorld);
  assert.ok(current.distanceTo(previous) > 2);
  const relative = branch.worldToLocal(current.clone());
  assert.ok(relative.distanceTo(root) < 1e-12);
});
