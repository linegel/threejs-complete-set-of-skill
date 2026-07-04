import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
} from "three/webgpu";

export function createWriter(capacity, materialSlots) {
  const indexArrayType = capacity.vertices > 65535 ? Uint32Array : Uint16Array;
  const positions = new Float32Array(capacity.vertices * 3);
  const normals = new Float32Array(capacity.vertices * 3);
  const tangents = new Float32Array(capacity.vertices * 4);
  const uvs = new Float32Array(capacity.vertices * 2);
  const debugUv = new Float32Array(capacity.vertices * 2);
  const semanticSurface = new Uint16Array(capacity.vertices);
  const boundaryReason = new Uint16Array(capacity.vertices);
  const indices = new indexArrayType(capacity.indices);
  const groups = [];
  const vertexMeta = [];
  let vertexCount = 0;
  let indexCount = 0;

  function assertCapacity(extraVertices, extraIndices = 0) {
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
  }) {
    assertCapacity(1);
    const id = vertexCount;
    positions.set(position, id * 3);
    normals.set(normal, id * 3);
    tangents.set(tangent, id * 4);
    uvs.set(uv, id * 2);
    debugUv.set(debug, id * 2);
    semanticSurface[id] = surface;
    boundaryReason[id] = boundary;
    vertexMeta[id] = { semanticSurface: surface, boundaryReason: boundary };
    vertexCount += 1;
    return id;
  }

  function duplicateForBoundary(vertexId, reason, overrides = {}) {
    const base = {
      position: Array.from(positions.slice(vertexId * 3, vertexId * 3 + 3)),
      normal: Array.from(normals.slice(vertexId * 3, vertexId * 3 + 3)),
      tangent: Array.from(tangents.slice(vertexId * 4, vertexId * 4 + 4)),
      uv: Array.from(uvs.slice(vertexId * 2, vertexId * 2 + 2)),
      debug: Array.from(debugUv.slice(vertexId * 2, vertexId * 2 + 2)),
      surface: semanticSurface[vertexId],
      boundary: reason,
      ...overrides,
    };
    return addVertex(base);
  }

  function addTriangle(a, b, c) {
    assertCapacity(0, 3);
    indices[indexCount] = a;
    indices[indexCount + 1] = b;
    indices[indexCount + 2] = c;
    indexCount += 3;
  }

  function addQuad(a, b, c, d) {
    addTriangle(a, b, c);
    addTriangle(b, d, c);
  }

  function addGroup(startIndex, indexCountForGroup, materialSlot) {
    if (!materialSlots.includes(materialSlot)) {
      throw new Error(`Unknown material slot "${materialSlot}"`);
    }
    groups.push({
      start: startIndex,
      count: indexCountForGroup,
      materialIndex: materialSlots.indexOf(materialSlot),
      materialSlot,
    });
  }

  function finishGeometry() {
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
      indexType: indexArrayType.name,
      groups,
      vertexMeta,
      bytes:
        vertexCount * (3 + 3 + 4 + 2 + 2) * 4 +
        vertexCount * 2 * 2 +
        indexCount * indexArrayType.BYTES_PER_ELEMENT,
    };
    return geometry;
  }

  return {
    addVertex,
    duplicateForBoundary,
    addTriangle,
    addQuad,
    addGroup,
    finishGeometry,
    get vertexCount() {
      return vertexCount;
    },
    get indexCount() {
      return indexCount;
    },
  };
}
