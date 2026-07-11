import { DynamicDrawUsage } from "three/webgpu";

export const MAX_DYNAMIC_UPDATE_LEDGER = 64;
export const DYNAMIC_BOUNDS_BLOCK_SIZE = 128;
const IDENTITY_3X3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const EPSILON = 1e-10;

function finiteTuple(value, length, label) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== length) {
    throw new TypeError(`${label} must contain ${length} finite values`);
  }
  if (Array.from(value).some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${label} must contain ${length} finite values`);
  }
}

function transform3(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function determinant3(matrix) {
  return (
    matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
    matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
    matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
  );
}

function inverseTranspose3(matrix, determinant) {
  return [
    (matrix[4] * matrix[8] - matrix[5] * matrix[7]) / determinant,
    (matrix[5] * matrix[6] - matrix[3] * matrix[8]) / determinant,
    (matrix[3] * matrix[7] - matrix[4] * matrix[6]) / determinant,
    (matrix[2] * matrix[7] - matrix[1] * matrix[8]) / determinant,
    (matrix[0] * matrix[8] - matrix[2] * matrix[6]) / determinant,
    (matrix[1] * matrix[6] - matrix[0] * matrix[7]) / determinant,
    (matrix[1] * matrix[5] - matrix[2] * matrix[4]) / determinant,
    (matrix[2] * matrix[3] - matrix[0] * matrix[5]) / determinant,
    (matrix[0] * matrix[4] - matrix[1] * matrix[3]) / determinant,
  ];
}

function normalize3(vector, label) {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(magnitude > EPSILON)) throw new Error(`${label} became degenerate`);
  return vector.map((value) => value / magnitude);
}

function orthogonalizeTangent(tangent, normal) {
  const projection = tangent[0] * normal[0] + tangent[1] * normal[1] + tangent[2] * normal[2];
  return normalize3([
    tangent[0] - projection * normal[0],
    tangent[1] - projection * normal[1],
    tangent[2] - projection * normal[2],
  ], "dynamic tangent");
}

function computeBoundsBlock(position, startVertex, endVertex) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let vertex = startVertex; vertex < endVertex; vertex += 1) {
    const point = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
  }
  return { startVertex, endVertex, minimum, maximum };
}

function initializeBoundsBlocks(geometry, blockSize = DYNAMIC_BOUNDS_BLOCK_SIZE) {
  const position = geometry.getAttribute("position");
  const blocks = [];
  for (let startVertex = 0; startVertex < position.count; startVertex += blockSize) {
    blocks.push(computeBoundsBlock(position, startVertex, Math.min(position.count, startVertex + blockSize)));
  }
  geometry.userData.dynamicBounds = {
    blockSize,
    blocks,
    dirtyBlocks: new Set(),
    recomputeCount: 0,
  };
}

function reduceBoundsBlocks(geometry) {
  const state = geometry.userData.dynamicBounds;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const block of state.blocks) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], block.minimum[axis]);
      maximum[axis] = Math.max(maximum[axis], block.maximum[axis]);
    }
  }
  geometry.boundingBox.min.set(...minimum);
  geometry.boundingBox.max.set(...maximum);
  const center = minimum.map((value, axis) => (value + maximum[axis]) * 0.5);
  geometry.boundingSphere.center.set(...center);
  geometry.boundingSphere.radius = Math.hypot(
    maximum[0] - minimum[0],
    maximum[1] - minimum[1],
    maximum[2] - minimum[2],
  ) * 0.5;
}

export function configureDynamicGeometry(geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  for (const name of ["position", "normal", "tangent"]) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) throw new Error(`geometry has no ${name} attribute`);
    attribute.setUsage(DynamicDrawUsage);
    attribute.clearUpdateRanges();
  }
  geometry.userData.dynamicUpdateLedger = [];
  initializeBoundsBlocks(geometry);
  return geometry;
}

export function beginDynamicUpdateFrame(geometry) {
  for (const name of ["position", "normal", "tangent"]) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) throw new Error(`geometry has no ${name} attribute`);
    attribute.clearUpdateRanges();
  }
  geometry.userData.dynamicBounds?.dirtyBlocks.clear();
}

export function endDynamicUpdateFrame(geometry) {
  const position = geometry.getAttribute("position");
  const state = geometry.userData.dynamicBounds;
  if (!position || !state) throw new Error("configureDynamicGeometry() must run before bounds finalization");
  let verticesScanned = 0;
  for (const blockIndex of state.dirtyBlocks) {
    const startVertex = blockIndex * state.blockSize;
    const endVertex = Math.min(position.count, startVertex + state.blockSize);
    state.blocks[blockIndex] = computeBoundsBlock(position, startVertex, endVertex);
    verticesScanned += endVertex - startVertex;
  }
  reduceBoundsBlocks(geometry);
  const telemetry = {
    strategy: "dirty-block-reduction",
    dirtyBlockCount: state.dirtyBlocks.size,
    verticesScanned,
    blocksReduced: state.blocks.length,
    recomputeCount: ++state.recomputeCount,
  };
  state.dirtyBlocks.clear();
  state.lastTelemetry = telemetry;
  return telemetry;
}

export function updateVertexRange(geometry, {
  startVertex,
  vertexCount,
  positionDelta = [0, 0, 0],
  linearTransform = IDENTITY_3X3,
  allowFullBuffer = false,
  deferBounds = false,
} = {}) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const tangent = geometry.getAttribute("tangent");
  if (!position || !normal || !tangent) {
    throw new Error("dynamic geometry requires position, normal, and tangent attributes");
  }
  if (
    !Number.isInteger(startVertex) ||
    !Number.isInteger(vertexCount) ||
    startVertex < 0 ||
    vertexCount <= 0 ||
    startVertex + vertexCount > position.count
  ) {
    throw new RangeError("dynamic vertex range is outside the geometry attributes");
  }
  if (vertexCount === position.count && allowFullBuffer !== true) {
    throw new RangeError("full-buffer interaction updates require explicit allowFullBuffer classification");
  }
  finiteTuple(positionDelta, 3, "positionDelta");
  finiteTuple(linearTransform, 9, "linearTransform");
  const basisUpdated = linearTransform.some((value, index) => Math.abs(value - IDENTITY_3X3[index]) > EPSILON);
  const determinant = determinant3(linearTransform);
  if (!(determinant > EPSILON)) {
    throw new RangeError("linearTransform must be finite, nonsingular, and orientation preserving");
  }
  const normalTransform = basisUpdated ? inverseTranspose3(linearTransform, determinant) : null;

  for (let vertex = startVertex; vertex < startVertex + vertexCount; vertex += 1) {
    const transformedPosition = transform3(linearTransform, [
      position.getX(vertex),
      position.getY(vertex),
      position.getZ(vertex),
    ]);
    position.setXYZ(
      vertex,
      transformedPosition[0] + positionDelta[0],
      transformedPosition[1] + positionDelta[1],
      transformedPosition[2] + positionDelta[2],
    );

    if (basisUpdated) {
      const transformedNormal = normalize3(transform3(normalTransform, [
        normal.getX(vertex),
        normal.getY(vertex),
        normal.getZ(vertex),
      ]), "dynamic normal");
      normal.setXYZ(vertex, ...transformedNormal);

      const transformedTangent = orthogonalizeTangent(transform3(linearTransform, [
        tangent.getX(vertex),
        tangent.getY(vertex),
        tangent.getZ(vertex),
      ]), transformedNormal);
      tangent.setXYZW(vertex, ...transformedTangent, tangent.getW(vertex));
    }
  }

  const ranges = {};
  let bytes = 0;
  const updatedAttributes = basisUpdated
    ? [["position", position], ["normal", normal], ["tangent", tangent]]
    : [["position", position]];
  for (const [name, attribute] of updatedAttributes) {
    const start = startVertex * attribute.itemSize;
    const count = vertexCount * attribute.itemSize;
    attribute.addUpdateRange(start, count);
    attribute.needsUpdate = true;
    const attributeBytes = count * attribute.array.BYTES_PER_ELEMENT;
    ranges[name] = { start, count, bytes: attributeBytes };
    bytes += attributeBytes;
  }

  const boundsState = geometry.userData.dynamicBounds;
  if (!boundsState) throw new Error("configureDynamicGeometry() must run before dynamic updates");
  const firstBlock = Math.floor(startVertex / boundsState.blockSize);
  const lastBlock = Math.floor((startVertex + vertexCount - 1) / boundsState.blockSize);
  for (let block = firstBlock; block <= lastBlock; block += 1) boundsState.dirtyBlocks.add(block);
  const boundsTelemetry = deferBounds ? null : endDynamicUpdateFrame(geometry);
  const record = {
    startVertex,
    vertexCount,
    ranges,
    bytes,
    fullBufferUpload: vertexCount === position.count,
    updatedVertexFraction: vertexCount / position.count,
    boundsDeferred: deferBounds,
    boundsTelemetry,
    basisUpdated,
    updatedAttributes: updatedAttributes.map(([name]) => name),
  };
  geometry.userData.dynamicUpdateLedger ??= [];
  geometry.userData.dynamicUpdateLedger.push(record);
  if (geometry.userData.dynamicUpdateLedger.length > MAX_DYNAMIC_UPDATE_LEDGER) {
    geometry.userData.dynamicUpdateLedger.splice(
      0,
      geometry.userData.dynamicUpdateLedger.length - MAX_DYNAMIC_UPDATE_LEDGER,
    );
  }
  return record;
}

export function validateDynamicUpdateRecord(geometry, record) {
  return validateDynamicUpdateBatch(geometry, [record]);
}

export function validateDynamicUpdateBatch(geometry, records) {
  const errors = [];
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, errors: ["at least one dynamic update record is required"] };
  }
  for (const name of ["position", "normal", "tangent"]) {
    const attribute = geometry.getAttribute(name);
    const recordsForAttribute = records.filter((record) => record.updatedAttributes?.includes(name));
    const expectedRanges = recordsForAttribute.map((record) => ({
      start: record.startVertex * attribute.itemSize,
      count: record.vertexCount * attribute.itemSize,
    }));
    for (let index = 0; index < recordsForAttribute.length; index += 1) {
      const expected = expectedRanges[index];
      const declared = recordsForAttribute[index].ranges?.[name];
      if (!declared || declared.start !== expected.start || declared.count !== expected.count) {
        errors.push(`${name} range does not match the edited vertex interval`);
      }
    }
    for (const record of records) {
      if (!record.updatedAttributes?.includes(name) && record.ranges?.[name]) {
        errors.push(`${name} range declared without an attribute update`);
      }
    }
    if (
      attribute.updateRanges.length !== expectedRanges.length ||
      expectedRanges.some((expected, index) => {
        const actual = attribute.updateRanges[index];
        return !actual || actual.start !== expected.start || actual.count !== expected.count;
      })
    ) {
      errors.push(`${name} attribute update ranges do not exactly match the declared batch`);
    }
  }
  for (const record of records) {
    const declaredBytes = Object.values(record.ranges ?? {}).reduce((sum, range) => sum + (range.bytes ?? 0), 0);
    if (declaredBytes !== record.bytes) errors.push("dynamic update byte total does not reconcile");
  }
  if (geometry.userData.dynamicUpdateLedger.length > MAX_DYNAMIC_UPDATE_LEDGER) {
    errors.push("dynamic update telemetry is unbounded");
  }
  return { ok: errors.length === 0, errors };
}
