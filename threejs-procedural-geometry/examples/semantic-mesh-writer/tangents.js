import { computeMikkTSpaceTangents } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as MikkTSpace from "three/examples/jsm/libs/mikktspace.module.js";

function rawAttributeArray(attribute) {
  return attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
}

function expandAttributeByIndex(attribute, indices) {
  const source = rawAttributeArray(attribute);
  const output = new source.constructor(indices.length * attribute.itemSize);
  for (let destination = 0; destination < indices.length; destination += 1) {
    const sourceVertex = indices[destination];
    const sourceOffset = attribute.isInterleavedBufferAttribute
      ? sourceVertex * attribute.data.stride + attribute.offset
      : sourceVertex * attribute.itemSize;
    for (let lane = 0; lane < attribute.itemSize; lane += 1) {
      output[destination * attribute.itemSize + lane] = source[sourceOffset + lane];
    }
  }
  return output;
}

function typedArrayBytesEqual(actual, expected) {
  if (!actual || !expected || actual.byteLength !== expected.byteLength) return false;
  const actualBytes = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
  const expectedBytes = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
  for (let index = 0; index < actualBytes.length; index += 1) {
    if (actualBytes[index] !== expectedBytes[index]) return false;
  }
  return true;
}

export function geometryRepresentationByteLedger(geometry) {
  const attributeBytes = Object.fromEntries(Object.entries(geometry.attributes ?? {}).map(([name, attribute]) => [
    name,
    rawAttributeArray(attribute).byteLength,
  ]));
  const indexBytes = geometry.index?.array?.byteLength ?? 0;
  return Object.freeze({
    attributeBytes: Object.freeze(attributeBytes),
    indexBytes,
    totalBytes: Object.values(attributeBytes).reduce((sum, bytes) => sum + bytes, indexBytes),
  });
}

export function validateTangents(geometry) {
  const tangent = geometry.attributes.tangent;
  if (!tangent) return { ok: true, errors: [], generatedBy: "not required" };
  const errors = [];
  for (let index = 0; index < tangent.count; index += 1) {
    const w = tangent.getW(index);
    if (!(w === 1 || w === -1)) {
      errors.push(`tangent.w invalid at ${index}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    generatedBy: "analytic-generator",
  };
}

export async function createTexturedMikkTangentFixture(sourceGeometry, { negateSign = false } = {}) {
  if (!sourceGeometry?.index) {
    throw new TypeError("the textured MikkTSpace fixture requires indexed semantic source geometry");
  }
  for (const name of ["position", "normal", "uv"]) {
    if (!sourceGeometry.getAttribute(name)) {
      throw new TypeError(`the textured MikkTSpace fixture requires ${name}`);
    }
  }
  const source = {
    indexedVertexCount: sourceGeometry.getAttribute("position").count,
    indexCount: sourceGeometry.index.count,
    triangleCount: sourceGeometry.index.count / 3,
    groups: sourceGeometry.groups.map((group) => ({ ...group })),
    writerGroups: sourceGeometry.userData.writer.groups.map((group) => ({ ...group })),
    materialSlots: [...sourceGeometry.userData.writer.materialSlots],
    triangleMaterialSlots: [...sourceGeometry.userData.writer.triangleMaterialSlots],
    representationBytes: geometryRepresentationByteLedger(sourceGeometry),
  };
  const indices = sourceGeometry.index.array;
  const preservedAttributes = Object.fromEntries(
    Object.entries(sourceGeometry.attributes)
      .filter(([name]) => name !== "tangent")
      .map(([name, attribute]) => {
        const expectedDeindexed = expandAttributeByIndex(attribute, indices);
        return [name, {
          arrayType: expectedDeindexed.constructor.name,
          itemSize: attribute.itemSize,
          normalized: attribute.normalized === true,
          sourceBytes: rawAttributeArray(attribute).byteLength,
          expectedDeindexedBytes: expectedDeindexed.byteLength,
          expectedDeindexed,
        }];
      }),
  );
  await MikkTSpace.ready;
  const geometry = sourceGeometry.clone();
  computeMikkTSpaceTangents(geometry, MikkTSpace, negateSign);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const representationBytes = geometryRepresentationByteLedger(geometry);
  geometry.userData.tangentFixture = {
    generator: "MikkTSpace",
    negateSign,
    source,
    representation: "deindexed-textured-normal-map-fixture",
    vertexCount: geometry.getAttribute("position").count,
    tangentBytes: geometry.getAttribute("tangent").array.byteLength,
    preservedAttributes,
    representationBytes,
  };
  return geometry;
}

export function validateTexturedMikkTangentFixture(geometry, tolerance = 1e-5) {
  const errors = [];
  const fixture = geometry?.userData?.tangentFixture;
  const position = geometry?.getAttribute?.("position");
  const normal = geometry?.getAttribute?.("normal");
  const tangent = geometry?.getAttribute?.("tangent");
  if (!fixture || fixture.generator !== "MikkTSpace") errors.push("fixture is not bound to MikkTSpace");
  if (geometry?.index !== null) errors.push("MikkTSpace fixture must record its deindexed representation cost");
  if (!position || !normal || !tangent || tangent.count !== position?.count) {
    errors.push("MikkTSpace tangent count must match the deindexed position count");
  } else {
    for (let vertex = 0; vertex < tangent.count; vertex += 1) {
      const tx = tangent.getX(vertex);
      const ty = tangent.getY(vertex);
      const tz = tangent.getZ(vertex);
      const w = tangent.getW(vertex);
      const nx = normal.getX(vertex);
      const ny = normal.getY(vertex);
      const nz = normal.getZ(vertex);
      if (![tx, ty, tz, w].every(Number.isFinite)) errors.push(`Mikk tangent ${vertex} is non-finite`);
      if (!(w === 1 || w === -1)) errors.push(`Mikk tangent ${vertex} has invalid handedness`);
      if (Math.abs(Math.hypot(tx, ty, tz) - 1) > tolerance) errors.push(`Mikk tangent ${vertex} is not unit length`);
      if (Math.abs(tx * nx + ty * ny + tz * nz) > tolerance) errors.push(`Mikk tangent ${vertex} is not orthogonal`);
    }
  }
  if (fixture && position && fixture.source.indexCount !== position.count) {
    errors.push("deindexed Mikk vertex count does not reconcile with the source index count");
  }
  if (fixture) {
    const actualGroups = geometry.groups.map((group) => ({
      start: group.start,
      count: group.count,
      materialIndex: group.materialIndex,
    }));
    const expectedGroups = fixture.source.groups.map((group) => ({
      start: group.start,
      count: group.count,
      materialIndex: group.materialIndex,
    }));
    if (JSON.stringify(actualGroups) !== JSON.stringify(expectedGroups)) {
      errors.push("deindexed Mikk groups did not preserve exact start/count/materialIndex values");
    }
    if (
      fixture.source.writerGroups.length !== fixture.source.groups.length ||
      fixture.source.writerGroups.some((group, index) => (
        group.start !== fixture.source.groups[index].start ||
        group.count !== fixture.source.groups[index].count ||
        group.materialIndex !== fixture.source.groups[index].materialIndex ||
        group.materialSlot !== fixture.source.materialSlots[group.materialIndex]
      ))
    ) {
      errors.push("source Mikk material-group metadata is internally inconsistent");
    }
    for (const group of fixture.source.groups) {
      const expectedSlot = fixture.source.materialSlots[group.materialIndex];
      for (let triangle = group.start / 3; triangle < (group.start + group.count) / 3; triangle += 1) {
        if (fixture.source.triangleMaterialSlots[triangle] !== expectedSlot) {
          errors.push(`deindexed Mikk triangle ${triangle} lost its semantic material slot`);
          break;
        }
      }
    }
    for (const [name, preserved] of Object.entries(fixture.preservedAttributes ?? {})) {
      const actual = geometry.getAttribute(name);
      const actualArray = actual ? rawAttributeArray(actual) : null;
      if (!actual) {
        errors.push(`deindexed Mikk representation lost the ${name} attribute`);
        continue;
      }
      if (
        actualArray.constructor.name !== preserved.arrayType ||
        actual.itemSize !== preserved.itemSize ||
        (actual.normalized === true) !== preserved.normalized
      ) {
        errors.push(`deindexed Mikk ${name} representation metadata changed`);
      }
      if (!typedArrayBytesEqual(actualArray, preserved.expectedDeindexed)) {
        errors.push(`deindexed Mikk ${name} bytes differ from exact indexed expansion`);
      }
    }
    const actualLedger = geometryRepresentationByteLedger(geometry);
    if (
      JSON.stringify(actualLedger.attributeBytes) !==
        JSON.stringify(fixture.representationBytes.attributeBytes) ||
      actualLedger.indexBytes !== fixture.representationBytes.indexBytes ||
      actualLedger.totalBytes !== fixture.representationBytes.totalBytes
    ) {
      errors.push("deindexed Mikk full representation byte ledger does not reconcile");
    }
  }
  const coverage = new Uint8Array(position?.count ?? 0);
  for (const group of geometry?.groups ?? []) {
    for (let component = group.start; component < group.start + group.count; component += 1) {
      if (component < coverage.length) coverage[component] += 1;
    }
  }
  const groupHoles = coverage.reduce((total, value) => total + Number(value === 0), 0);
  const groupOverlaps = coverage.reduce((total, value) => total + Number(value > 1), 0);
  if (groupHoles || groupOverlaps) errors.push("deindexed Mikk groups do not cover every vertex exactly once");
  return {
    ok: errors.length === 0,
    errors,
    generator: fixture?.generator ?? null,
    indexedSourceVertices: fixture?.source?.indexedVertexCount ?? null,
    sourceIndexCount: fixture?.source?.indexCount ?? null,
    deindexedVertices: position?.count ?? null,
    groups: geometry?.groups?.length ?? 0,
    groupHoles,
    groupOverlaps,
    tangentBytes: tangent?.array?.byteLength ?? 0,
    materialSlots: fixture?.source?.materialSlots?.length ?? 0,
    triangleMaterialSlots: fixture?.source?.triangleMaterialSlots?.length ?? 0,
    representationBytes: geometry ? geometryRepresentationByteLedger(geometry) : null,
  };
}

export { computeMikkTSpaceTangents };
