import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, DynamicDrawUsage, IntType, Vector3 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { computeMikkTSpaceTangents, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import WebGPUAttributeUtils from 'three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js';
import Attributes from 'three/src/renderers/common/Attributes.js';
import { AttributeType } from 'three/src/renderers/common/Constants.js';

const reference = () => readFileSync(new URL('../../skills/threejs-procedural-geometry/references/profile-sweeps-and-mesh-writers.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');

// CPU transport fixture: it executes the installed adapter, not a GPU device.
function attributeFixture() {
  const resources = new Map(), writes = [];
  const backend = {
    get(key) { if (!resources.has(key)) resources.set(key, {}); return resources.get(key); },
    device: {
      createBuffer({size}) {
        const bytes = new ArrayBuffer(size);
        return {size, bytes, getMappedRange: () => bytes, unmap() {}, destroy() {}};
      },
      queue: {writeBuffer(buffer, offset, array, first = 0, count = array.length - first) {
        const start = first * array.BYTES_PER_ELEMENT, length = count * array.BYTES_PER_ELEMENT;
        assert.equal(offset % 4, 0, 'write destination alignment');
        assert.equal(length % 4, 0, 'write byte length alignment');
        new Uint8Array(buffer.bytes, offset, length).set(new Uint8Array(array.buffer, array.byteOffset + start, length));
        writes.push({offset, length});
      }},
    },
  };
  const utility = new WebGPUAttributeUtils(backend);
  return {backend, utility, writes, resources};
}

function withBufferUsage(callback) {
  const previous = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = {INDEX:16, VERTEX:32, STORAGE:128};
  try { return callback(); }
  finally { if (previous === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previous; }
}

test('r185 widens uint16 indices and remaps 65535; explicit uint32 retains the vertex', () => withBufferUsage(() => {
  const {utility, backend} = attributeFixture();
  const small = new Uint16BufferAttribute([0, 1, 65535], 1);
  utility.createAttribute(small, GPUBufferUsage.INDEX);
  assert.ok(small.array instanceof Uint32Array);
  assert.deepEqual([...small.array], [0, 1, 0xffffffff]);
  assert.equal(backend.get(small).buffer.size, 12);
  const exact = new Uint32BufferAttribute([0, 1, 65535], 1);
  utility.createAttribute(exact, GPUBufferUsage.INDEX);
  assert.equal(exact.array[2], 65535);
  assert.ok(reference().includes('65534'));
}));

test('explicit vec4 storage avoids r185 repeated vec3 padding corruption', () => withBufferUsage(() => {
  const {utility, backend} = attributeFixture();
  const packed = new StorageBufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6]), 3);
  utility.createAttribute(packed, GPUBufferUsage.STORAGE);
  assert.equal(packed.itemSize, 4);
  assert.deepEqual([...packed.array], [1, 2, 3, 0, 4, 5, 6, 0]);
  utility.updateAttribute(packed);
  assert.deepEqual([...packed.array], [1, 2, 3, 0, 0, 4, 5, 0]);
  const aligned = new StorageBufferAttribute(new Float32Array([1, 2, 3, 0, 4, 5, 6, 0]), 4);
  utility.createAttribute(aligned, GPUBufferUsage.STORAGE);
  aligned.setXYZ(1, 7, 8, 9);
  aligned.addUpdateRange(4, 4);
  utility.updateAttribute(aligned);
  assert.deepEqual([...new Float32Array(backend.get(aligned).buffer.bytes)], [1, 2, 3, 0, 7, 8, 9, 0]);
  assert.ok(reference().includes('explicit four-lane storage'));
}));

test('DynamicDrawUsage triggers idle uploads while default usage is version driven', () => {
  let uploads = 0;
  const attributes = new Attributes({createAttribute() {}, updateAttribute() {uploads++;}}, {createAttribute() {}});
  const sporadic = new Float32BufferAttribute([1, 2, 3], 3);
  attributes.update(sporadic, AttributeType.VERTEX);
  attributes.update(sporadic, AttributeType.VERTEX); assert.equal(uploads, 0);
  sporadic.needsUpdate = true;
  attributes.update(sporadic, AttributeType.VERTEX); assert.equal(uploads, 1);
  const continuous = new Float32BufferAttribute([1, 2, 3], 3).setUsage(DynamicDrawUsage);
  attributes.update(continuous, AttributeType.VERTEX);
  attributes.update(continuous, AttributeType.VERTEX); assert.equal(uploads, 2);
});

test('unconsumed component ranges survive skipped renders and clear on upload', () => withBufferUsage(() => {
  const {utility, backend, writes} = attributeFixture();
  const attribute = new Float32BufferAttribute([0, 0, 0, 0], 1);
  utility.createAttribute(attribute, GPUBufferUsage.VERTEX);
  attribute.setX(0, 5); attribute.addUpdateRange(0, 1);
  // Culled frame: no upload was performed. A second edit must retain the first.
  attribute.setX(3, 8); attribute.addUpdateRange(3, 1);
  utility.updateAttribute(attribute);
  assert.deepEqual([...new Float32Array(backend.get(attribute).buffer.bytes)], [5, 0, 0, 8]);
  assert.deepEqual(writes, [{offset:0, length:4}, {offset:12, length:4}]);
  assert.deepEqual(attribute.updateRanges, []);
}));

test('packed updates must expand to aligned bytes without losing neighbors', () => withBufferUsage(() => {
  const {utility, backend} = attributeFixture();
  const attribute = new BufferAttribute(new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]), 4, true);
  utility.createAttribute(attribute, GPUBufferUsage.VERTEX);
  attribute.array[1] = 99; attribute.addUpdateRange(1, 1);
  assert.throws(() => utility.updateAttribute(attribute), /alignment/);
  assert.equal(attribute.updateRanges.length, 1, 'failed update retains its pending range');
  attribute.clearUpdateRanges(); attribute.addUpdateRange(0, 4);
  utility.updateAttribute(attribute);
  assert.deepEqual([...new Uint8Array(backend.get(attribute).buffer.bytes)], [10, 99, 30, 40, 50, 60, 70, 80]);
}));

function quad() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0,0,0, 1,0,0, 1,1,0, 0,1,0], 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1, 0,0,1], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0,0, 1,0, 1,1, 0,1], 2));
  geometry.setIndex([0,1,2, 0,2,3]);
  geometry.addGroup(0, 3, 2); geometry.addGroup(3, 3, 5);
  return geometry;
}

test('Mikk conversion preserves triangle groups but resets external identity and ranges', () => {
  const geometry = quad();
  geometry.name = 'semantic-quad'; geometry.userData.anchor = 'top-left';
  geometry.setDrawRange(3, 3);
  geometry.setAttribute('semanticId', new Uint32BufferAttribute([10,11,12,13], 1));
  geometry.attributes.semanticId.gpuType = IntType;
  const retained = {name:geometry.name, userData:structuredClone(geometry.userData), drawRange:{...geometry.drawRange}};
  // Stub only the external tangent solver; exercise Three's real conversion path.
  const mikk = {isReady:true, generateTangents: p => new Float32Array(p.length / 3 * 4)};
  assert.equal(computeMikkTSpaceTangents(geometry, mikk), geometry);
  assert.equal(geometry.index, null); assert.equal(geometry.attributes.position.count, 6);
  assert.equal(geometry.name, ''); assert.deepEqual(geometry.userData, {});
  assert.equal(geometry.drawRange.count, Infinity);
  assert.notEqual(geometry.attributes.semanticId.gpuType, IntType);
  Object.assign(geometry, retained); geometry.attributes.semanticId.gpuType = IntType;
  assert.equal(geometry.userData.anchor, 'top-left'); assert.equal(geometry.drawRange.count, 3);
  assert.deepEqual(geometry.groups.map(x => x.materialIndex), [2, 5]);
  geometry.dispose();
});

test('merge groups belong to input ordinal unless semantic groups are remapped', () => {
  const first = quad(), second = quad();
  first.setDrawRange(0, 3);
  const merged = mergeGeometries([first, second], true);
  assert.equal(merged.index.count, 12, 'input drawRange did not filter triangles');
  assert.deepEqual(merged.groups, [{start:0,count:6,materialIndex:0}, {start:6,count:6,materialIndex:1}]);
  const semanticGroups = [first, second].flatMap((g, input) => g.groups.map(group => ({...group, start:group.start + input * 6})));
  merged.clearGroups(); semanticGroups.forEach(g => merged.addGroup(g.start, g.count, g.materialIndex));
  assert.deepEqual(merged.groups.map(g => g.materialIndex), [2,5,2,5]);
  first.dispose(); second.dispose(); merged.dispose();
});

test('topology must be checked again after world positions are quantized to f32', () => {
  const a = [1e8, 0, 0], b = [1e8 + 1, 0, 0], c = [1e8, 1, 0];
  const area2 = (a,b,c) => new Vector3().subVectors(new Vector3(...b), new Vector3(...a)).cross(new Vector3().subVectors(new Vector3(...c), new Vector3(...a))).length();
  assert.equal(area2(a,b,c), 1);
  assert.equal(area2(a.map(Math.fround), b.map(Math.fround), c.map(Math.fround)), 0);
  const local = p => [Math.fround(p[0] - 1e8), Math.fround(p[1]), Math.fround(p[2])];
  assert.equal(area2(local(a),local(b),local(c)), 1);
});

test('a parallel initial normal requires a nonparallel seed before normalization', () => {
  const tangent = new Vector3(0,1,0), initial = tangent.clone();
  const projected = initial.clone().addScaledVector(tangent, -initial.dot(tangent)).normalize();
  assert.equal(projected.length(), 0);
  const replacement = new Vector3(1,0,0).addScaledVector(tangent, 0).normalize();
  assert.equal(replacement.length(), 1); assert.equal(replacement.dot(tangent), 0);
});
