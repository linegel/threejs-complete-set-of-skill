import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Sphere,
  Vector3,
} from "three";

import { MODULE_REGISTRY, MATERIAL_SLOTS, validateModuleRegistry } from "./modules.js";
import { validateDiagnosticsSchema } from "./diagnostics.js";
import { validateUvDensity } from "./uv-debug.js";

function pushFace(writer, corners, normal, uSpan = 1, vSpan = 1) {
  const start = writer.positions.length / 3;
  for (const corner of corners) {
    writer.positions.push(corner[0], corner[1], corner[2]);
    writer.normals.push(normal[0], normal[1], normal[2]);
  }
  writer.uvs.push(0, 0, uSpan, 0, uSpan, vSpan, 0, vSpan);
  writer.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function appendBox(writer, placement) {
  const [cx, cy, cz] = placement.position;
  const { width, height, depth } = placement.dimensions;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const z0 = cz - depth / 2;
  const z1 = cz + depth / 2;
  const uSpan = Math.min(1, width / placement.uvMetersPerRepeat);
  const vSpan = Math.min(1, height / placement.uvMetersPerRepeat);
  pushFace(writer, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], uSpan, vSpan);
  pushFace(writer, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], uSpan, vSpan);
  pushFace(writer, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], uSpan, vSpan);
  pushFace(writer, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], uSpan, vSpan);
  pushFace(writer, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], uSpan, vSpan);
  pushFace(writer, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], uSpan, vSpan);
  writer.moduleIds.push(placement.id);
}

function createWriter() {
  return { positions: [], normals: [], uvs: [], indices: [], moduleIds: [] };
}

function writerToGeometry(writer) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(writer.positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(writer.normals), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(writer.uvs), 2));
  geometry.setIndex(writer.indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.moduleIds = writer.moduleIds;
  return geometry;
}

export function compileBuilding(plan, materials = {}, options = {}) {
  const diagnosticsSchema = validateDiagnosticsSchema(plan.diagnostics);
  if (!diagnosticsSchema.ok) {
    throw new Error(`BuildingDiagnostics missing fields: ${diagnosticsSchema.missing.join(", ")}`);
  }
  const registry = validateModuleRegistry(plan);
  if (!registry.ok) throw new Error(`Missing module builders: ${registry.missingModuleIds.join(", ")}`);

  const writers = Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, createWriter()]));
  for (const placement of plan.placements) {
    const module = MODULE_REGISTRY[placement.moduleId];
    module.build({ bounds: placement.dimensions, placement });
    appendBox(writers[placement.slot], placement);
  }

  const root = new Group();
  root.name = `compiled-${plan.settings.name}`;
  const slotMeshes = [];
  const slotGeometries = {};
  const bounds = new Box3();
  bounds.makeEmpty();
  const uv = validateUvDensity(plan.placements);

  for (const slot of MATERIAL_SLOTS) {
    const writer = writers[slot];
    if (writer.positions.length === 0) continue;
    const geometry = writerToGeometry(writer);
    slotGeometries[slot] = geometry;
    const mesh = new Mesh(geometry, materials[slot] ?? null);
    mesh.name = `${slot}-slot`;
    mesh.userData.materialSlot = slot;
    mesh.userData.route = options.preferBatchedMesh ? "BatchedMesh-compatible-slot" : "merged BufferGeometry";
    root.add(mesh);
    slotMeshes.push(mesh);
    bounds.union(geometry.boundingBox);
    plan.diagnostics.triangles[slot] = geometry.index.count / 3;
  }

  const sphere = new Sphere();
  bounds.getBoundingSphere(sphere);
  plan.diagnostics.drawCalls = slotMeshes.length;
  plan.diagnostics.bounds = {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    sphere: { center: sphere.center.toArray(), radius: sphere.radius },
  };
  plan.diagnostics.cullingState = "bounds computed";
  plan.diagnostics.uvDensity = uv;
  root.userData.diagnostics = plan.diagnostics;
  root.userData.compilerRoute = "material-slot merged BufferGeometry";

  return {
    root,
    slotMeshes,
    slotGeometries,
    diagnostics: plan.diagnostics,
    resourceLedger: {
      geometries: slotMeshes.length,
      meshes: slotMeshes.length,
      debugMaterials: 0,
      textures: 0,
    },
  };
}

export function disposeCompiledBuilding(compiled) {
  for (const mesh of compiled.slotMeshes ?? []) {
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material?.dispose?.();
    } else {
      mesh.material?.dispose?.();
    }
  }
  compiled.disposed = true;
  return {
    geometries: 0,
    meshes: 0,
    debugMaterials: 0,
    textures: 0,
  };
}

export function computeCompiledBounds(compiled) {
  const bounds = new Box3();
  bounds.makeEmpty();
  for (const mesh of compiled.slotMeshes) {
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    bounds.union(mesh.geometry.boundingBox);
  }
  return bounds;
}

export function boundsContainOrigin(compiled) {
  const bounds = computeCompiledBounds(compiled);
  return bounds.containsPoint(new Vector3(0, 0, 0));
}
