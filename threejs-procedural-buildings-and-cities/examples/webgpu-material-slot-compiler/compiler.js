import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Sphere,
  Vector3,
} from "three";

import { MODULE_REGISTRY, MATERIAL_SLOTS, validateModuleRegistry } from "./modules.js";
import { validateDiagnosticsSchema } from "./diagnostics.js";
import {
  validateGeometryTangentFrames,
  validateGeometryUvJacobians,
  validateUvDensity,
} from "./uv-debug.js";
import { validateBuildingPlan } from "./building-plan.js";

const EPSILON = 1e-10;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (value) => {
  const magnitude = Math.hypot(...value);
  if (!(magnitude > EPSILON)) throw new Error("degenerate module face");
  return value.map((entry) => entry / magnitude);
};

function createSlotWriter(slot) {
  return {
    slot,
    positions: [],
    normals: [],
    tangents: [],
    uvs: [],
    indices: [],
    moduleRanges: [],
    closureRanges: [],
    get triangleCount() {
      return this.indices.length / 3;
    },
  };
}

function pushVertex(writer, position, normal, tangent, uv) {
  if ([...position, ...normal, ...tangent, ...uv].some((value) => !Number.isFinite(value))) {
    throw new Error(`non-finite ${writer.slot} module vertex`);
  }
  const index = writer.positions.length / 3;
  writer.positions.push(...position);
  writer.normals.push(...normal);
  writer.tangents.push(...tangent);
  writer.uvs.push(...uv);
  return index;
}

function pushTriangle(writer, points, normal, _authoredTangent, uvMeters, metersPerRepeat, reverse = false) {
  const edge1 = sub(points[1], points[0]);
  const edge2 = sub(points[2], points[0]);
  const du1 = uvMeters[1][0] - uvMeters[0][0];
  const dv1 = uvMeters[1][1] - uvMeters[0][1];
  const du2 = uvMeters[2][0] - uvMeters[0][0];
  const dv2 = uvMeters[2][1] - uvMeters[0][1];
  const determinant = du1 * dv2 - dv1 * du2;
  if (Math.abs(determinant) <= EPSILON) throw new Error(`degenerate ${writer.slot} triangle UV Jacobian`);
  const inverse = 1 / determinant;
  const dPdu = [0, 1, 2].map((axis) => (edge1[axis] * dv2 - edge2[axis] * dv1) * inverse);
  const dPdv = [0, 1, 2].map((axis) => (-edge1[axis] * du2 + edge2[axis] * du1) * inverse);
  const projected = dPdu.map((value, axis) => value - normal[axis] * dot(normal, dPdu));
  const tangent = normalize(projected);
  const handedness = dot(cross(normal, tangent), dPdv) < 0 ? -1 : 1;
  const indices = points.map((point, index) => pushVertex(
    writer,
    point,
    normal,
    [...tangent, handedness],
    uvMeters[index].map((value) => value / metersPerRepeat),
  ));
  if (reverse) writer.indices.push(indices[0], indices[2], indices[1]);
  else writer.indices.push(...indices);
}

function pushFace(writer, corners, normal, tangent, uMeters, vMeters, metersPerRepeat, reverse = false) {
  const uv = [[0, 0], [uMeters, 0], [uMeters, vMeters], [0, vMeters]];
  const indices = corners.map((corner, index) => pushVertex(
    writer,
    corner,
    normal,
    [...tangent, reverse ? -1 : 1],
    uv[index].map((value) => value / metersPerRepeat),
  ));
  if (reverse) writer.indices.push(indices[0], indices[2], indices[1], indices[0], indices[3], indices[2]);
  else writer.indices.push(indices[0], indices[1], indices[2], indices[0], indices[2], indices[3]);
}

function facadeBasis(side) {
  if (side === "front") return { u: [1, 0, 0], v: [0, 1, 0], out: [0, 0, 1] };
  if (side === "back") return { u: [-1, 0, 0], v: [0, 1, 0], out: [0, 0, -1] };
  if (side === "right") return { u: [0, 0, -1], v: [0, 1, 0], out: [1, 0, 0] };
  if (side === "left") return { u: [0, 0, 1], v: [0, 1, 0], out: [-1, 0, 0] };
  return { u: [1, 0, 0], v: [0, 1, 0], out: [0, 0, 1] };
}

function createTransform(placement) {
  const basis = placement.side === "top"
    ? { u: [1, 0, 0], v: [0, 1, 0], out: [0, 0, 1] }
    : facadeBasis(placement.side);
  const origin = placement.position;
  return {
    point(local) {
      return [0, 1, 2].map((axis) =>
        origin[axis] + basis.u[axis] * local[0] + basis.v[axis] * local[1] + basis.out[axis] * local[2]);
    },
    normal(local) {
      return normalize([0, 1, 2].map((axis) =>
        basis.u[axis] * local[0] + basis.v[axis] * local[1] + basis.out[axis] * local[2]));
    },
  };
}

function createModuleContext(writer, placement, qualityTier) {
  const transform = createTransform(placement);
  const metersPerRepeat = placement.uvMetersPerRepeat;
  const transformPoints = (points) => points.map(transform.point);

  function emitBox({ width, height, depth, center = [0, 0, 0] }) {
    const [cx, cy, cz] = center;
    const x0 = cx - width / 2;
    const x1 = cx + width / 2;
    const y0 = cy - height / 2;
    const y1 = cy + height / 2;
    const z0 = cz - depth / 2;
    const z1 = cz + depth / 2;
    const faces = [
      { p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], n: [0, 0, 1], t: [1, 0, 0], u: width, v: height },
      { p: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], n: [0, 0, -1], t: [-1, 0, 0], u: width, v: height },
      { p: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], n: [1, 0, 0], t: [0, 0, -1], u: depth, v: height },
      { p: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], n: [-1, 0, 0], t: [0, 0, 1], u: depth, v: height },
      { p: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], n: [0, 1, 0], t: [1, 0, 0], u: width, v: depth },
      { p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], n: [0, -1, 0], t: [1, 0, 0], u: width, v: depth },
    ];
    for (const face of faces) pushFace(writer, transformPoints(face.p), transform.normal(face.n), transform.normal(face.t), face.u, face.v, metersPerRepeat);
  }

  function emitPyramid({
    width = placement.dimensions.width,
    height = placement.dimensions.height,
    depth = placement.dimensions.depth,
    center = [0, 0, 0],
  } = {}) {
    const [cx, cy, cz] = center;
    const base = [[cx - width / 2, cy - height / 2, cz - depth / 2], [cx + width / 2, cy - height / 2, cz - depth / 2], [cx + width / 2, cy - height / 2, cz + depth / 2], [cx - width / 2, cy - height / 2, cz + depth / 2]];
    const apex = [cx, cy + height / 2, cz];
    for (let side = 0; side < 4; side += 1) {
      const local = [base[side], base[(side + 1) % 4], apex];
      const normal = normalize(cross(sub(local[1], local[0]), sub(local[2], local[0])));
      pushTriangle(writer, transformPoints(local), transform.normal(normal), transform.normal(normalize(sub(local[1], local[0]))), [[0, 0], [width, 0], [width / 2, height]], metersPerRepeat);
    }
    pushFace(writer, transformPoints([base[0], base[1], base[2], base[3]]), transform.normal([0, -1, 0]), transform.normal([1, 0, 0]), width, depth, metersPerRepeat);
  }

  function emitRoof({ variant = placement.moduleVariant } = {}) {
    const { width, height, depth } = placement.dimensions;
    if (variant === "flat-service") {
      emitBox({ width, height: Math.min(0.5, height), depth, center: [0, -height / 2 + Math.min(0.25, height / 2), 0] });
      return;
    }
    if (variant === "statue-tower") {
      const baseHeight = Math.min(0.5, height * 0.25);
      emitBox({ width, height: baseHeight, depth, center: [0, -height / 2 + baseHeight / 2, 0] });
      emitPyramid({
        width: width * 0.72,
        height: height - baseHeight,
        depth: depth * 0.72,
        center: [0, baseHeight / 2, 0],
      });
      return;
    }
    emitPyramid();
  }

  function emitTriangularPrism() {
    const { width, height, depth } = placement.dimensions;
    const front = [[-width / 2, -height / 2, depth / 2], [width / 2, -height / 2, depth / 2], [0, height / 2, depth / 2]];
    const back = front.map(([x, y]) => [x, y, -depth / 2]);
    pushTriangle(writer, transformPoints(front), transform.normal([0, 0, 1]), transform.normal([1, 0, 0]), [[0, 0], [width, 0], [width / 2, height]], metersPerRepeat);
    pushTriangle(writer, transformPoints(back), transform.normal([0, 0, -1]), transform.normal([-1, 0, 0]), [[0, 0], [width, 0], [width / 2, height]], metersPerRepeat, true);
    for (let edge = 0; edge < 3; edge += 1) {
      const a = front[edge];
      const b = front[(edge + 1) % 3];
      const c = back[(edge + 1) % 3];
      const d = back[edge];
      const normal = normalize(cross(sub(b, a), sub(d, a)));
      pushFace(writer, transformPoints([a, b, c, d]), transform.normal(normal), transform.normal(normalize(sub(b, a))), Math.hypot(...sub(b, a)), depth, metersPerRepeat);
    }
  }

  function emitPrism({ radialSegments }) {
    const { width, height } = placement.dimensions;
    const radius = width / 2;
    const bottom = -height / 2;
    const top = height / 2;
    const bottomCenter = transform.point([0, bottom, 0]);
    const topCenter = transform.point([0, top, 0]);
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const a0 = radial / radialSegments * Math.PI * 2;
      const a1 = (radial + 1) / radialSegments * Math.PI * 2;
      const p0 = [Math.cos(a0) * radius, bottom, Math.sin(a0) * radius];
      const p1 = [Math.cos(a1) * radius, bottom, Math.sin(a1) * radius];
      const p2 = [Math.cos(a1) * radius, top, Math.sin(a1) * radius];
      const p3 = [Math.cos(a0) * radius, top, Math.sin(a0) * radius];
      const normal = normalize([Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
      // The ring parameter increases counter-clockwise in XZ.  Reverse the
      // side quad relative to that parameter so its geometric cross product
      // points radially outward; cap orders similarly match their declared
      // -Y/+Y normals.
      pushFace(writer, transformPoints([p1, p0, p3, p2]), transform.normal(normal), transform.normal(normalize(sub(p0, p1))), radius * (a1 - a0), height, metersPerRepeat);
      pushTriangle(writer, [bottomCenter, transform.point(p0), transform.point(p1)], transform.normal([0, -1, 0]), transform.normal([1, 0, 0]), [[0, 0], [radius, 0], [0, radius]], metersPerRepeat);
      pushTriangle(writer, [topCenter, transform.point(p2), transform.point(p3)], transform.normal([0, 1, 0]), transform.normal([1, 0, 0]), [[0, 0], [radius, 0], [0, radius]], metersPerRepeat);
    }
  }

  function emitArch({ radialSegments }) {
    const { width, height, depth } = placement.dimensions;
    const radius = Math.min(width / 2, height * 0.42);
    const springY = height / 2 - radius;
    const polygon = [[-width / 2, -height / 2]];
    polygon.push([width / 2, -height / 2]);
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const angle = segment / radialSegments * Math.PI;
      polygon.push([Math.cos(angle) * radius, springY + Math.sin(angle) * radius]);
    }
    const front = polygon.map(([x, y]) => [x, y, depth / 2]);
    const back = polygon.map(([x, y]) => [x, y, -depth / 2]);
    for (let index = 1; index < front.length - 1; index += 1) {
      pushTriangle(writer, transformPoints([front[0], front[index], front[index + 1]]), transform.normal([0, 0, 1]), transform.normal([1, 0, 0]), [[0, 0], [width, 0], [width, height]], metersPerRepeat);
      pushTriangle(writer, transformPoints([back[0], back[index + 1], back[index]]), transform.normal([0, 0, -1]), transform.normal([-1, 0, 0]), [[0, 0], [width, height], [width, 0]], metersPerRepeat);
    }
    for (let edge = 0; edge < polygon.length; edge += 1) {
      const next = (edge + 1) % polygon.length;
      const a = front[edge];
      const b = front[next];
      const c = back[next];
      const d = back[edge];
      const normal = normalize(cross(sub(b, a), sub(d, a)));
      pushFace(writer, transformPoints([a, b, c, d]), transform.normal(normal), transform.normal(normalize(sub(b, a))), Math.hypot(...sub(b, a)), depth, metersPerRepeat);
    }
  }

  return {
    writer,
    placement,
    qualityTier,
    width: placement.dimensions.width,
    height: placement.dimensions.height,
    depth: placement.dimensions.depth,
    emitBox,
    emitPyramid,
    emitRoof,
    emitTriangularPrism,
    emitPrism,
    emitArch,
  };
}

function appendWorldFace(writer, corners, normal, tangent, uMeters, vMeters, metersPerRepeat = 1.45) {
  pushFace(writer, corners, normal, tangent, uMeters, vMeters, metersPerRepeat);
}

export function validateCompiledGeometryOrientation(geometry, { minimumCornerDot = 0.999 } = {}) {
  const position = geometry?.attributes?.position;
  const normal = geometry?.attributes?.normal;
  const index = geometry?.index;
  const errors = [];
  if (!position || !normal || !index) return { ok: false, errors: ["missing indexed position/normal geometry"] };
  for (let component = 0; component < index.count; component += 3) {
    const [ia, ib, ic] = [index.getX(component), index.getX(component + 1), index.getX(component + 2)];
    const edge1 = [position.getX(ib) - position.getX(ia), position.getY(ib) - position.getY(ia), position.getZ(ib) - position.getZ(ia)];
    const edge2 = [position.getX(ic) - position.getX(ia), position.getY(ic) - position.getY(ia), position.getZ(ic) - position.getZ(ia)];
    let face;
    try {
      face = normalize(cross(edge1, edge2));
    } catch {
      errors.push(`triangle ${component / 3} is degenerate`);
      continue;
    }
    for (const vertex of [ia, ib, ic]) {
      const authored = [normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)];
      const agreement = dot(face, authored) / Math.max(Math.hypot(...authored), EPSILON);
      if (!(agreement >= minimumCornerDot)) {
        errors.push(`triangle ${component / 3} vertex ${vertex} normal/winding agreement ${agreement}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function emitStructuralClosures(plan, writer) {
  const ranges = [];
  for (const closure of plan.structuralClosures) {
    const tier = plan.tiers.find((entry) => entry.id === closure.tierId);
    if (!tier) throw new Error(`Structural closure ${closure.id} references missing tier ${closure.tierId}`);
    if (closure.kind === "connector") {
      // The connected footprint pieces form one solid mass. Their common
      // interior plane intentionally emits no visible triangles, but the IR
      // record is consumed and reconciled explicitly.
      ranges.push({ closureId: closure.id, kind: closure.kind, startIndex: writer.indices.length, indexCount: 0, disposition: "interior-union-no-surface" });
      continue;
    }
    const piece = tier.footprintPieces.find((entry) => entry.id === closure.pieceId);
    if (!piece) throw new Error(`Structural closure ${closure.id} references missing piece ${closure.pieceId}`);
    const start = writer.indices.length;
    const width = piece.x1 - piece.x0;
    const depth = piece.z1 - piece.z0;
    if (closure.kind === "deck") {
      appendWorldFace(writer, [[piece.x0, closure.y, piece.z1], [piece.x1, closure.y, piece.z1], [piece.x1, closure.y, piece.z0], [piece.x0, closure.y, piece.z0]], [0, 1, 0], [1, 0, 0], width, depth);
    } else if (closure.kind === "soffit") {
      appendWorldFace(writer, [[piece.x0, closure.y, piece.z0], [piece.x1, closure.y, piece.z0], [piece.x1, closure.y, piece.z1], [piece.x0, closure.y, piece.z1]], [0, -1, 0], [1, 0, 0], width, depth);
    } else {
      throw new Error(`Unsupported structural closure kind ${closure.kind}`);
    }
    const range = { closureId: closure.id, kind: closure.kind, startIndex: start, indexCount: writer.indices.length - start, disposition: "emitted" };
    ranges.push(range);
    writer.moduleRanges.push({ moduleId: closure.id, ...range });
  }
  for (const tier of plan.tiers) {
    for (const edge of plan.exposedEdges.filter((candidate) => candidate.tierId === tier.id)) {
      const start = writer.indices.length;
      const y0 = tier.y0;
      const y1 = tier.y0 + tier.height;
      if (edge.side === "front") appendWorldFace(writer, [[edge.start, y0, edge.z], [edge.end, y0, edge.z], [edge.end, y1, edge.z], [edge.start, y1, edge.z]], [0, 0, 1], [1, 0, 0], edge.length, tier.height);
      else if (edge.side === "back") appendWorldFace(writer, [[edge.end, y0, edge.z], [edge.start, y0, edge.z], [edge.start, y1, edge.z], [edge.end, y1, edge.z]], [0, 0, -1], [-1, 0, 0], edge.length, tier.height);
      else if (edge.side === "right") appendWorldFace(writer, [[edge.x, y0, edge.end], [edge.x, y0, edge.start], [edge.x, y1, edge.start], [edge.x, y1, edge.end]], [1, 0, 0], [0, 0, -1], edge.length, tier.height);
      else appendWorldFace(writer, [[edge.x, y0, edge.start], [edge.x, y0, edge.end], [edge.x, y1, edge.end], [edge.x, y1, edge.start]], [-1, 0, 0], [0, 0, 1], edge.length, tier.height);
      writer.moduleRanges.push({ moduleId: `${tier.id}:${edge.id}:wall`, startIndex: start, indexCount: writer.indices.length - start });
    }
  }
  writer.closureRanges.push(...ranges);
  return ranges;
}

function writerToGeometry(writer) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(writer.positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(writer.normals), 3));
  geometry.setAttribute("tangent", new BufferAttribute(new Float32Array(writer.tangents), 4));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(writer.uvs), 2));
  const vertexCount = writer.positions.length / 3;
  const IndexArray = vertexCount > 65536 ? Uint32Array : Uint16Array;
  geometry.setIndex(new BufferAttribute(new IndexArray(writer.indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.moduleRanges = writer.moduleRanges;
  geometry.userData.closureRanges = writer.closureRanges;
  geometry.userData.materialSlot = writer.slot;
  geometry.userData.bytes = Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0) + geometry.index.array.byteLength;
  const uvJacobians = validateGeometryUvJacobians(geometry);
  if (!uvJacobians.ok) {
    geometry.dispose();
    throw new Error(`Invalid compiled UV Jacobians for ${writer.slot}: ${uvJacobians.errors.slice(0, 8).join(", ")}`);
  }
  const tangentFrames = validateGeometryTangentFrames(geometry);
  if (!tangentFrames.ok) {
    geometry.dispose();
    throw new Error(`Invalid compiled tangent frames for ${writer.slot}: ${tangentFrames.errors.slice(0, 8).join(", ")}`);
  }
  const orientation = validateCompiledGeometryOrientation(geometry);
  if (!orientation.ok) {
    geometry.dispose();
    throw new Error(`Invalid compiled face orientation for ${writer.slot}: ${orientation.errors.slice(0, 8).join(", ")}`);
  }
  geometry.userData.uvJacobianRange = uvJacobians.range;
  return geometry;
}

function emitPlacement(writer, placement, qualityTier) {
  const module = MODULE_REGISTRY[placement.moduleId];
  const startIndex = writer.indices.length;
  const report = module.build(createModuleContext(writer, placement, qualityTier));
  writer.moduleRanges.push({
    placementId: placement.id,
    moduleId: placement.moduleId,
    startIndex,
    indexCount: writer.indices.length - startIndex,
    triangles: report.triangles,
  });
  return report;
}

function compileMergedSlots(plan, materials, qualityTier) {
  const writers = Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, createSlotWriter(slot)]));
  emitStructuralClosures(plan, writers.limestone);
  for (const placement of plan.placements) emitPlacement(writers[placement.slot], placement, qualityTier);
  const root = new Group();
  const slotMeshes = [];
  for (const slot of MATERIAL_SLOTS) {
    const writer = writers[slot];
    if (writer.indices.length === 0) continue;
    const geometry = writerToGeometry(writer);
    const mesh = new Mesh(geometry, materials[slot] ?? null);
    mesh.name = `${slot}-merged-slot`;
    mesh.userData.materialSlot = slot;
    mesh.userData.route = "merged BufferGeometry";
    root.add(mesh);
    slotMeshes.push(mesh);
  }
  return {
    root,
    slotMeshes,
    backendDrawItems: slotMeshes.length,
    sceneObjects: slotMeshes.length,
    closureRanges: writers.limestone.closureRanges.map((entry) => ({ ...entry })),
  };
}

function compileBatchedSlots(plan, materials, qualityTier) {
  const structural = createSlotWriter("limestone");
  emitStructuralClosures(plan, structural);
  const geometryBuckets = Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, []]));
  if (structural.indices.length) geometryBuckets.limestone.push(writerToGeometry(structural));
  for (const placement of plan.placements) {
    const writer = createSlotWriter(placement.slot);
    emitPlacement(writer, placement, qualityTier);
    geometryBuckets[placement.slot].push(writerToGeometry(writer));
  }
  const root = new Group();
  const slotMeshes = [];
  let backendDrawItems = 0;
  for (const slot of MATERIAL_SLOTS) {
    const geometries = geometryBuckets[slot];
    if (!geometries.length) continue;
    const maxVertices = geometries.reduce((sum, geometry) => sum + geometry.attributes.position.count, 0);
    const maxIndices = geometries.reduce((sum, geometry) => sum + geometry.index.count, 0);
    const batched = new BatchedMesh(geometries.length, maxVertices, maxIndices, materials[slot] ?? null);
    batched.name = `${slot}-batched-slot`;
    for (const geometry of geometries) {
      const geometryId = batched.addGeometry(geometry);
      const instanceId = batched.addInstance(geometryId);
      batched.setMatrixAt(instanceId, new Matrix4());
      geometry.dispose();
    }
    batched.computeBoundingBox();
    batched.computeBoundingSphere();
    batched.userData.materialSlot = slot;
    batched.userData.route = "BatchedMesh";
    batched.userData.capacity = {
      maxVertices,
      maxIndices,
      usedVertices: maxVertices - batched.unusedVertexCount,
      usedIndices: maxIndices - batched.unusedIndexCount,
      unusedVertices: batched.unusedVertexCount,
      unusedIndices: batched.unusedIndexCount,
    };
    root.add(batched);
    slotMeshes.push(batched);
    backendDrawItems += batched.instanceCount;
  }
  return {
    root,
    slotMeshes,
    backendDrawItems,
    sceneObjects: slotMeshes.length,
    closureRanges: structural.closureRanges.map((entry) => ({ ...entry })),
  };
}

export function describeCompiledBuildingResources(compiled) {
  return {
    schemaVersion: 1,
    representation: compiled.representation,
    qualityTier: compiled.qualityTier,
    sceneObjects: compiled.slotMeshes.length,
    backendDrawItems: compiled.diagnostics.backendDrawItems,
    resources: compiled.slotMeshes.map((mesh) => ({
      id: mesh.name,
      kind: mesh.isBatchedMesh ? "BatchedMesh" : "BufferGeometry",
      materialSlot: mesh.userData.materialSlot,
      vertices: mesh.isBatchedMesh ? mesh.userData.capacity.usedVertices : mesh.geometry.attributes.position.count,
      indices: mesh.isBatchedMesh ? mesh.userData.capacity.usedIndices : mesh.geometry.index.count,
      bytes: mesh.isBatchedMesh
        ? Object.values(mesh.geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0) + (mesh.geometry.index?.array.byteLength ?? 0)
        : mesh.geometry.userData.bytes,
    })),
  };
}

export function compileBuilding(plan, materials = {}, options = {}) {
  const planValidation = validateBuildingPlan(plan);
  if (!planValidation.ok) {
    throw new Error(`Invalid building plan: ${planValidation.errors.join(", ")}`);
  }
  // Replace any stale attached snapshot with the authoritative recomputation
  // that passed immediately before geometry emission.
  plan.diagnostics = planValidation.diagnostics;
  const diagnosticsSchema = validateDiagnosticsSchema(plan.diagnostics);
  if (!diagnosticsSchema.ok) throw new Error(`BuildingDiagnostics missing fields: ${diagnosticsSchema.missing.join(", ")}`);
  const registry = validateModuleRegistry(plan);
  if (!registry.ok) throw new Error(`Missing/invalid module builders: ${[...registry.missingModuleIds, ...registry.invalidBuilders].join(", ")}`);
  const qualityTier = options.qualityTier ?? plan.settings.qualityTier ?? "hero";
  if (!["hero", "city", "distant"].includes(qualityTier)) throw new RangeError(`Unknown quality tier "${qualityTier}"`);
  const packageResult = options.preferBatchedMesh
    ? compileBatchedSlots(plan, materials, qualityTier)
    : compileMergedSlots(plan, materials, qualityTier);
  const { root, slotMeshes } = packageResult;
  root.name = `compiled-${plan.settings.name}`;
  const bounds = new Box3().setFromObject(root);
  const sphere = new Sphere();
  bounds.getBoundingSphere(sphere);
  const uv = validateUvDensity(plan.placements);
  const triangles = {};
  for (const slot of MATERIAL_SLOTS) triangles[slot] = 0;
  for (const mesh of slotMeshes) {
    const slot = mesh.userData.materialSlot;
    triangles[slot] += mesh.isBatchedMesh ? mesh.userData.capacity.usedIndices / 3 : mesh.geometry.index.count / 3;
  }
  plan.diagnostics.triangles = triangles;
  plan.diagnostics.drawCalls = packageResult.sceneObjects;
  plan.diagnostics.backendDrawItems = packageResult.backendDrawItems;
  plan.diagnostics.bounds = { min: bounds.min.toArray(), max: bounds.max.toArray(), sphere: { center: sphere.center.toArray(), radius: sphere.radius } };
  plan.diagnostics.cullingState = "compiled world bounds computed";
  plan.diagnostics.uvDensity = uv;
  plan.diagnostics.representation = options.preferBatchedMesh ? "BatchedMesh per material slot" : "merged BufferGeometry per material slot";
  plan.diagnostics.structuralClosureCompilation = packageResult.closureRanges;
  if (packageResult.closureRanges.length !== plan.structuralClosures.length) {
    throw new Error(`Structural closure compilation mismatch: ${packageResult.closureRanges.length}/${plan.structuralClosures.length}`);
  }
  root.userData.diagnostics = plan.diagnostics;
  root.userData.compilerRoute = plan.diagnostics.representation;

  const compiled = {
    root,
    slotMeshes,
    slotGeometries: Object.fromEntries(slotMeshes.filter((mesh) => !mesh.isBatchedMesh).map((mesh) => [mesh.userData.materialSlot, mesh.geometry])),
    diagnostics: plan.diagnostics,
    representation: plan.diagnostics.representation,
    qualityTier,
    resourceLedger: { geometries: slotMeshes.length, meshes: slotMeshes.length, materialsOwned: 0, texturesOwned: 0 },
  };
  compiled.resourceDescription = describeCompiledBuildingResources(compiled);
  return compiled;
}

export function disposeCompiledBuilding(compiled) {
  if (compiled.disposed) {
    return { ...compiled.disposalLedger, alreadyDisposed: true };
  }
  const before = {
    sceneChildren: compiled.root?.children?.length ?? 0,
    geometries: (compiled.slotMeshes ?? []).filter((mesh) => !mesh.isBatchedMesh).length,
    batchedMeshes: (compiled.slotMeshes ?? []).filter((mesh) => mesh.isBatchedMesh).length,
  };
  let geometryDisposeEvents = 0;
  let batchedDisposeCalls = 0;
  for (const mesh of compiled.slotMeshes ?? []) {
    if (mesh.isBatchedMesh) {
      mesh.dispose();
      batchedDisposeCalls += 1;
    } else if (mesh.geometry) {
      mesh.geometry.addEventListener("dispose", () => {
        geometryDisposeEvents += 1;
      }, { once: true });
      mesh.geometry.dispose();
    }
  }
  compiled.root?.clear?.();
  compiled.disposed = true;
  compiled.resourceLedger = { geometries: 0, meshes: 0, materialsOwned: 0, texturesOwned: 0 };
  compiled.disposalLedger = {
    before,
    geometryDisposeEvents,
    batchedDisposeCalls,
    remainingSceneChildren: compiled.root?.children?.length ?? 0,
    remainingOwnedResources: Object.values(compiled.resourceLedger).reduce((sum, value) => sum + value, 0),
    alreadyDisposed: false,
  };
  return { ...compiled.disposalLedger };
}

export function validateDisposalLedger(ledger) {
  const errors = [];
  if (!ledger?.before) errors.push("missing pre-disposal inventory");
  if (ledger?.geometryDisposeEvents !== ledger?.before?.geometries) errors.push("geometry dispose-event mismatch");
  if (ledger?.batchedDisposeCalls !== ledger?.before?.batchedMeshes) errors.push("BatchedMesh dispose-call mismatch");
  if (ledger?.remainingSceneChildren !== 0) errors.push("scene children remain attached");
  if (ledger?.remainingOwnedResources !== 0) errors.push("owned resource ledger is nonzero");
  return { ok: errors.length === 0, errors };
}

export function computeCompiledBounds(compiled) {
  compiled.root.updateMatrixWorld(true);
  return new Box3().setFromObject(compiled.root);
}

export function boundsContainOrigin(compiled) {
  return computeCompiledBounds(compiled).containsPoint(new Vector3(0, 0, 0));
}

export function createProceduralDistrictBuildingFactory({ materials = {}, representation = "merged" } = {}) {
  return {
    ownership: {
      renderer: null,
      renderPipeline: null,
      output: null,
      geometry: "threejs-procedural-geometry",
      grammar: "threejs-procedural-buildings-and-cities",
      materials: "host semantic material slots",
    },
    compile(plan, options = {}) {
      return compileBuilding(plan, materials, {
        ...options,
        preferBatchedMesh: options.preferBatchedMesh ?? representation === "batched",
      });
    },
    describe(compiled) {
      return describeCompiledBuildingResources(compiled);
    },
    dispose: disposeCompiledBuilding,
  };
}
