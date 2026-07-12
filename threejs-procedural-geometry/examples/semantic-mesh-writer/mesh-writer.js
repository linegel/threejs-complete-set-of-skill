import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
} from "three/webgpu";

export function selectIndexArrayType(vertexCapacity) {
  if (!Number.isInteger(vertexCapacity) || vertexCapacity <= 0) {
    throw new TypeError("vertexCapacity must be a positive integer");
  }
  return vertexCapacity - 1 > 65535 ? Uint32Array : Uint16Array;
}

export function createWriter(capacity, materialSlots) {
  if (!Number.isInteger(capacity.vertices) || capacity.vertices <= 0) {
    throw new TypeError("capacity.vertices must be a positive integer");
  }
  if (!Number.isInteger(capacity.indices) || capacity.indices <= 0) {
    throw new TypeError("capacity.indices must be a positive integer");
  }
  if (
    !Array.isArray(materialSlots) ||
    materialSlots.length === 0 ||
    materialSlots.some((slot) => typeof slot !== "string" || slot.length === 0) ||
    new Set(materialSlots).size !== materialSlots.length
  ) {
    throw new TypeError("materialSlots must be an array of unique slot names");
  }

  // 65,536 vertices still fit a Uint16 index because the largest index is
  // 65,535. The representation must switch only when the largest referenced
  // vertex no longer fits.
  const indexArrayType = selectIndexArrayType(capacity.vertices);
  const positions = new Float32Array(capacity.vertices * 3);
  const normals = new Float32Array(capacity.vertices * 3);
  const tangents = new Float32Array(capacity.vertices * 4);
  const uvs = new Float32Array(capacity.vertices * 2);
  const debugUv = new Float32Array(capacity.vertices * 2);
  const semanticSurface = new Uint16Array(capacity.vertices);
  const boundaryReason = new Uint16Array(capacity.vertices);
  const smoothingGroup = new Uint16Array(capacity.vertices);
  const uvChart = new Uint16Array(capacity.vertices);
  const topologyVertex = new Uint32Array(capacity.vertices);
  const indices = new indexArrayType(capacity.indices);
  const groups = [];
  const vertexMeta = [];
  const triangleMaterialSlots = [];
  const smoothingGroups = new Map();
  const uvCharts = new Map();
  let vertexCount = 0;
  let indexCount = 0;
  let activeSmoothingGroup = 0;
  let activeUvChart = 0;
  let sealed = false;

  function assertOpen() {
    if (sealed) throw new Error("semantic writer is sealed after finishGeometry()");
  }

  function semanticId(registry, value, label) {
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new RangeError(`${label} numeric id must fit an unsigned 16-bit lane`);
      }
      return value;
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`${label} must be a nonempty string or unsigned 16-bit id`);
    }
    if (!registry.has(value)) {
      if (registry.size > 65535) throw new RangeError(`${label} registry exceeds 16-bit capacity`);
      registry.set(value, registry.size);
    }
    return registry.get(value);
  }

  function startSmoothingGroup(name) {
    assertOpen();
    activeSmoothingGroup = semanticId(smoothingGroups, name, "smoothing group");
    return activeSmoothingGroup;
  }

  function startUvChart(name) {
    assertOpen();
    activeUvChart = semanticId(uvCharts, name, "UV chart");
    return activeUvChart;
  }

  startSmoothingGroup("default");
  startUvChart("default");

  function finiteTuple(value, length, label) {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
      throw new TypeError(`${label} must be an array-like tuple`);
    }
    if (value.length !== length || Array.from(value).some((entry) => !Number.isFinite(entry))) {
      throw new TypeError(`${label} must contain ${length} finite values`);
    }
  }

  function assertCapacity(extraVertices, extraIndices = 0) {
    assertOpen();
    if (vertexCount + extraVertices > capacity.vertices) {
      throw new Error("vertex capacity exceeded");
    }
    if (indexCount + extraIndices > capacity.indices) {
      throw new Error("index capacity exceeded");
    }
  }

  function addVertex({
    position,
    normal = [0, 0, 1],
    tangent = [1, 0, 0, 1],
    uv = [0, 0],
    debug = uv,
    surface = 0,
    boundary = 0,
    smoothing = activeSmoothingGroup,
    chart = activeUvChart,
    topology = vertexCount,
  }) {
    assertCapacity(1);
    finiteTuple(position, 3, "position");
    finiteTuple(normal, 3, "normal");
    finiteTuple(tangent, 4, "tangent");
    finiteTuple(uv, 2, "uv");
    finiteTuple(debug, 2, "debugUv");
    if (!Number.isInteger(surface) || surface < 0 || surface > 65535) {
      throw new RangeError("surface must fit an unsigned 16-bit lane");
    }
    if (!Number.isInteger(boundary) || boundary < 0 || boundary > 65535) {
      throw new RangeError("boundary must fit an unsigned 16-bit lane");
    }
    const smoothingId = semanticId(smoothingGroups, smoothing, "smoothing group");
    const chartId = semanticId(uvCharts, chart, "UV chart");
    if (!Number.isInteger(topology) || topology < 0 || topology > 0xffffffff) {
      throw new RangeError("topology vertex id must fit an unsigned 32-bit lane");
    }
    const id = vertexCount;
    positions.set(position, id * 3);
    normals.set(normal, id * 3);
    tangents.set(tangent, id * 4);
    uvs.set(uv, id * 2);
    debugUv.set(debug, id * 2);
    semanticSurface[id] = surface;
    boundaryReason[id] = boundary;
    smoothingGroup[id] = smoothingId;
    uvChart[id] = chartId;
    topologyVertex[id] = topology;
    vertexMeta[id] = {
      semanticSurface: surface,
      boundaryReason: boundary,
      smoothingGroup: smoothingId,
      uvChart: chartId,
      topologyVertex: topology,
    };
    vertexCount += 1;
    return id;
  }

  function duplicateForBoundary(vertexId, reason, overrides = {}) {
    if (!Number.isInteger(vertexId) || vertexId < 0 || vertexId >= vertexCount) {
      throw new RangeError(`duplicate source ${vertexId} is outside [0, ${vertexCount})`);
    }
    const base = {
      position: Array.from(positions.slice(vertexId * 3, vertexId * 3 + 3)),
      normal: Array.from(normals.slice(vertexId * 3, vertexId * 3 + 3)),
      tangent: Array.from(tangents.slice(vertexId * 4, vertexId * 4 + 4)),
      uv: Array.from(uvs.slice(vertexId * 2, vertexId * 2 + 2)),
      debug: Array.from(debugUv.slice(vertexId * 2, vertexId * 2 + 2)),
      surface: semanticSurface[vertexId],
      boundary: reason,
      smoothing: smoothingGroup[vertexId],
      chart: uvChart[vertexId],
      topology: topologyVertex[vertexId],
      ...overrides,
    };
    return addVertex(base);
  }

  function addTriangle(a, b, c, materialSlot) {
    assertCapacity(0, 3);
    for (const vertex of [a, b, c]) {
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
        throw new RangeError(`triangle index ${vertex} is outside [0, ${vertexCount})`);
      }
    }
    if (a === b || b === c || c === a) {
      throw new RangeError("triangle indices must be distinct");
    }
    if (!materialSlots.includes(materialSlot)) {
      throw new Error(`Unknown material slot "${materialSlot}"`);
    }
    triangleMaterialSlots[indexCount / 3] = materialSlot;
    indices[indexCount] = a;
    indices[indexCount + 1] = b;
    indices[indexCount + 2] = c;
    indexCount += 3;
  }

  function addQuad(a, b, c, d, materialSlot) {
    addTriangle(a, b, c, materialSlot);
    addTriangle(b, d, c, materialSlot);
  }

  function addGroup(startIndex, indexCountForGroup, materialSlot) {
    assertOpen();
    if (!materialSlots.includes(materialSlot)) {
      throw new Error(`Unknown material slot "${materialSlot}"`);
    }
    if (!Number.isInteger(startIndex) || !Number.isInteger(indexCountForGroup)) {
      throw new TypeError("group ranges must be integer index-component offsets");
    }
    if (startIndex % 3 !== 0 || indexCountForGroup % 3 !== 0) {
      throw new RangeError("group ranges must start and end on triangle boundaries");
    }
    if (startIndex < 0 || indexCountForGroup <= 0 || startIndex + indexCountForGroup > indexCount) {
      throw new RangeError("group range is outside emitted indices");
    }
    groups.push({
      start: startIndex,
      count: indexCountForGroup,
      materialIndex: materialSlots.indexOf(materialSlot),
      materialSlot,
    });
  }

  function finishGeometry({ requireExact = true } = {}) {
    assertOpen();
    if (requireExact && vertexCount !== capacity.vertices) {
      throw new Error(`vertex capacity mismatch: planned ${capacity.vertices}, wrote ${vertexCount}`);
    }
    if (requireExact && indexCount !== capacity.indices) {
      throw new Error(`index capacity mismatch: planned ${capacity.indices}, wrote ${indexCount}`);
    }

    const coverage = new Uint8Array(indexCount);
    for (const group of groups) {
      if (group.start % 3 !== 0 || group.count % 3 !== 0) {
        throw new Error("group range is not triangle-aligned");
      }
      for (let component = group.start; component < group.start + group.count; component += 1) {
        coverage[component] += 1;
      }
      for (
        let triangle = group.start / 3;
        triangle < (group.start + group.count) / 3;
        triangle += 1
      ) {
        if (triangleMaterialSlots[triangle] !== group.materialSlot) {
          throw new Error(
            `triangle ${triangle} belongs to ${triangleMaterialSlots[triangle] ?? "no slot"} but group declares ${group.materialSlot}`,
          );
        }
      }
    }
    const uncovered = coverage.reduce((count, value) => count + Number(value === 0), 0);
    const overlaps = coverage.reduce((count, value) => count + Number(value > 1), 0);
    if (uncovered || overlaps) {
      throw new Error(`group coverage invalid: ${uncovered} uncovered, ${overlaps} overlapping indices`);
    }
    if (triangleMaterialSlots.length !== indexCount / 3 || triangleMaterialSlots.some((slot) => slot === undefined)) {
      throw new Error("every triangle must declare a semantic material slot");
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(positions.slice(0, vertexCount * 3), 3),
    );
    geometry.setAttribute(
      "normal",
      new Float32BufferAttribute(normals.slice(0, vertexCount * 3), 3),
    );
    geometry.setAttribute(
      "tangent",
      new Float32BufferAttribute(tangents.slice(0, vertexCount * 4), 4),
    );
    geometry.setAttribute(
      "uv",
      new Float32BufferAttribute(uvs.slice(0, vertexCount * 2), 2),
    );
    geometry.setAttribute(
      "debugUv",
      new Float32BufferAttribute(debugUv.slice(0, vertexCount * 2), 2),
    );
    geometry.setAttribute(
      "semanticSurface",
      new BufferAttribute(semanticSurface.slice(0, vertexCount), 1),
    );
    geometry.setAttribute(
      "boundaryReason",
      new BufferAttribute(boundaryReason.slice(0, vertexCount), 1),
    );
    geometry.setAttribute(
      "smoothingGroup",
      new BufferAttribute(smoothingGroup.slice(0, vertexCount), 1),
    );
    geometry.setAttribute(
      "uvChart",
      new BufferAttribute(uvChart.slice(0, vertexCount), 1),
    );
    geometry.setAttribute(
      "topologyVertex",
      new BufferAttribute(topologyVertex.slice(0, vertexCount), 1),
    );
    const IndexAttribute =
      indexArrayType === Uint32Array ? Uint32BufferAttribute : Uint16BufferAttribute;
    geometry.setIndex(new IndexAttribute(indices.slice(0, indexCount), 1));
    for (const group of groups) {
      geometry.addGroup(group.start, group.count, group.materialIndex);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.writer = {
      vertexCount,
      indexCount,
      capacity: { ...capacity },
      exactCapacity: vertexCount === capacity.vertices && indexCount === capacity.indices,
      indexType: indexArrayType.name,
      materialSlots: [...materialSlots],
      triangleMaterialSlots: [...triangleMaterialSlots],
      smoothingGroups: Object.fromEntries(smoothingGroups),
      uvCharts: Object.fromEntries(uvCharts),
      groups,
      vertexMeta,
      bytes:
        vertexCount * (3 + 3 + 4 + 2 + 2) * 4 +
        vertexCount * 4 * 2 +
        vertexCount * 4 +
        indexCount * indexArrayType.BYTES_PER_ELEMENT,
    };
    sealed = true;
    return geometry;
  }

  return {
    addVertex,
    startSmoothingGroup,
    startUvChart,
    duplicateForBoundary,
    addTriangle,
    addQuad,
    addGroup,
    finishGeometry,
    capacity: Object.freeze({ ...capacity }),
    get vertexCount() {
      return vertexCount;
    },
    get indexCount() {
      return indexCount;
    },
  };
}
