import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
} from "three/webgpu";
import { color } from "three/tsl";

import { createWriter } from "../../threejs-procedural-geometry/examples/semantic-mesh-writer/mesh-writer.js";
import {
  buildingPlanSignature,
  createBuildingPlan,
  validateBuildingPlan,
} from "../../threejs-procedural-buildings-and-cities/examples/webgpu-material-slot-compiler/building-plan.js";
import {
  createProceduralDistrictBuildingFactory,
} from "../../threejs-procedural-buildings-and-cities/examples/webgpu-material-slot-compiler/compiler.js";
import { DISTRICT_FIELD_SCALE, DISTRICT_WORLD_EXTENT } from "./shared-cause-field.js";

const HEIGHT_SCALE = 7;
const BUILDING_FOOTPRINTS = Object.freeze(["single", "L", "T", "U", "courtyard", "twin", "twin-bridge"]);
const SITE_X = Object.freeze([-66, -22, 22, 66]);
const SITE_Z = Object.freeze([-55, 0, 55]);

function normalize3(x, y, z) {
  const magnitude = Math.hypot(x, y, z);
  if (!(magnitude > 0)) return [0, 1, 0];
  return [x / magnitude, y / magnitude, z / magnitude];
}

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function terrainHeightFromSample(sample) {
  return (sample.macroHeight - 0.5) * HEIGHT_SCALE;
}

export function createDistrictTerrainGeometry({ causeField, segments }) {
  if (!causeField || typeof causeField.sampleCPU !== "function") throw new TypeError("Terrain requires the shared district cause field.");
  if (!Number.isInteger(segments) || segments < 2) throw new RangeError("Terrain segments must be an integer >= 2.");
  const side = segments + 1;
  const capacity = {
    vertices: side * side,
    indices: segments * segments * 6,
  };
  const writer = createWriter(capacity, ["terrain"]);
  const ids = new Array(capacity.vertices);
  const spanX = DISTRICT_WORLD_EXTENT.maxX - DISTRICT_WORLD_EXTENT.minX;
  const spanZ = DISTRICT_WORLD_EXTENT.maxZ - DISTRICT_WORLD_EXTENT.minZ;

  for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
    const v = zIndex / segments;
    const z = DISTRICT_WORLD_EXTENT.minZ + spanZ * v;
    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      const u = xIndex / segments;
      const x = DISTRICT_WORLD_EXTENT.minX + spanX * u;
      const field = causeField.sampleCPU(x, z);
      const height = terrainHeightFromSample(field);
      const dhdx = field.macroGradientX * DISTRICT_FIELD_SCALE * HEIGHT_SCALE;
      const dhdz = field.macroGradientZ * DISTRICT_FIELD_SCALE * HEIGHT_SCALE;
      const normal = normalize3(-dhdx, 1, -dhdz);
      const surface = field.placementMask >= 0.5 ? 2 : 1;
      ids[zIndex * side + xIndex] = writer.addVertex({
        position: [x, height, z],
        normal,
        tangent: [1, 0, 0, 1],
        uv: [x / 8, z / 8],
        debug: [field.macroHeight, field.placementMask],
        surface,
        boundary: 0,
      });
    }
  }

  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const a = ids[zIndex * side + xIndex];
      const b = ids[(zIndex + 1) * side + xIndex];
      const c = ids[zIndex * side + xIndex + 1];
      const d = ids[(zIndex + 1) * side + xIndex + 1];
      writer.addQuad(a, b, c, d);
    }
  }
  writer.addGroup(0, capacity.indices, "terrain");
  const geometry = writer.finishGeometry();
  geometry.name = `district-terrain-${segments}`;
  geometry.userData.causeFieldId = causeField.id;
  return geometry;
}

export function selectDistrictBuildingSites({ causeField, count, seed }) {
  const candidates = [];
  let index = 0;
  for (const z of SITE_Z) {
    for (const x of SITE_X) {
      const field = causeField.sampleCPU(x, z);
      candidates.push({
        id: `site-${index}`,
        index,
        x,
        z,
        y: terrainHeightFromSample(field),
        placementMask: field.placementMask,
        biome: field.biome,
        ridge: field.ridge,
        score: field.placementMask * 0.72 + field.biome * 0.21 + field.ridge * 0.07,
        seed: (seed + Math.imul(index + 1, 0x9e37)) >>> 0,
      });
      index += 1;
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates.slice(0, count);
}

function ownershipKey(buildingId, rectangle) {
  return [
    buildingId,
    rectangle.edgeId,
    rectangle.horizontal.join(":"),
    rectangle.vertical.join(":"),
    rectangle.normalDepth,
  ].join("|");
}

function appendSegment(positions, a, b) {
  positions.push(...a, ...b);
}

function appendFacadeEdge(positions, edge, tier, offset) {
  const bottom = tier.y0 + offset.y + 0.04;
  const top = tier.y0 + tier.height + offset.y + 0.04;
  const edgeStart = edge.side === "front" || edge.side === "back"
    ? [edge.start + offset.x, bottom, edge.z + offset.z]
    : [edge.x + offset.x, bottom, edge.start + offset.z];
  const edgeEnd = edge.side === "front" || edge.side === "back"
    ? [edge.end + offset.x, bottom, edge.z + offset.z]
    : [edge.x + offset.x, bottom, edge.end + offset.z];
  const topStart = [edgeStart[0], top, edgeStart[2]];
  const topEnd = [edgeEnd[0], top, edgeEnd[2]];
  appendSegment(positions, edgeStart, edgeEnd);
  appendSegment(positions, topStart, topEnd);
  appendSegment(positions, edgeStart, topStart);
  appendSegment(positions, edgeEnd, topEnd);
}

function createFacadeOwnershipOverlay(entries) {
  const positions = [];
  for (const entry of entries) {
    const tiers = new Map(entry.plan.tiers.map((tier) => [tier.id, tier]));
    for (const edge of entry.plan.exposedEdges) {
      const tier = tiers.get(edge.tierId);
      if (tier) appendFacadeEdge(positions, edge, tier, entry.site);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new LineBasicNodeMaterial();
  material.name = "facade-ownership-diagnostic";
  material.colorNode = color(0x43f6cb);
  material.depthTest = true;
  material.depthWrite = false;
  const lines = new LineSegments(geometry, material);
  lines.name = "facade-ownership-overlay";
  lines.renderOrder = 2;
  lines.visible = false;
  return lines;
}

function setShadowFlags(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

export function createDistrictStaticGeometry({ tier, seed, causeField, materials }) {
  if (!tier || !materials || !causeField) throw new TypeError("District static geometry requires tier, materials, and cause field.");
  const root = new Group();
  root.name = "procedural-district-static-world";
  const terrainGeometry = createDistrictTerrainGeometry({ causeField, segments: tier.terrainSegments });
  const terrain = new Mesh(terrainGeometry, materials.terrain);
  terrain.name = "district-semantic-terrain";
  terrain.receiveShadow = true;
  root.add(terrain);

  const factory = createProceduralDistrictBuildingFactory({ materials: materials.slots, representation: "merged" });
  const sites = selectDistrictBuildingSites({ causeField, count: tier.buildingCount, seed });
  const entries = [];
  const facadeOwnershipKeys = [];
  const planSignatures = [];
  const resourceRecords = [{
    id: "district-semantic-terrain",
    owner: "threejs-procedural-geometry",
    kind: "indexed-buffer-geometry",
    bytes: terrainGeometry.userData.writer.bytes,
    source: "exact semantic mesh-writer attribute and index byte count",
  }];

  for (const [siteIndex, site] of sites.entries()) {
    const footprint = BUILDING_FOOTPRINTS[(siteIndex + Math.floor(site.biome * 11)) % BUILDING_FOOTPRINTS.length];
    const plan = createBuildingPlan({
      name: `district-${site.id}`,
      footprint,
      seed: site.seed,
      widthBays: footprint.startsWith("twin") ? 12 : 8,
      depthBays: 6,
      floors: tier.buildingTier === "hero" ? 14 : tier.buildingTier === "city" ? 10 : 8,
      podiumFloors: 2,
      ornamentDensity: tier.buildingTier === "hero" ? 0.62 : tier.buildingTier === "city" ? 0.34 : 0.08,
      qualityTier: tier.buildingTier,
    });
    const validation = validateBuildingPlan(plan);
    if (!validation.ok) throw new Error(`Invalid district building ${site.id}: ${validation.errors.join(", ")}`);
    const compiled = factory.compile(plan, { qualityTier: tier.buildingTier, preferBatchedMesh: false });
    compiled.root.position.set(site.x, site.y + 0.08, site.z);
    compiled.root.name = `district-building-${site.id}`;
    setShadowFlags(compiled.root);
    root.add(compiled.root);
    const buildingId = compiled.root.name;
    for (const rectangle of plan.diagnostics.ownershipRectangles) {
      facadeOwnershipKeys.push(ownershipKey(buildingId, rectangle));
    }
    planSignatures.push(`${site.x},${site.y},${site.z}:${buildingPlanSignature(plan)}`);
    for (const resource of compiled.resourceDescription.resources) {
      resourceRecords.push({
        id: `${buildingId}:${resource.id}`,
        owner: "threejs-procedural-buildings-and-cities",
        kind: `merged-material-slot:${resource.materialSlot}`,
        bytes: resource.bytes,
        source: "compiled material-slot BufferGeometry typed-array byte count",
      });
    }
    entries.push({ site, plan, compiled });
  }

  const ownershipOverlay = createFacadeOwnershipOverlay(entries);
  root.add(ownershipOverlay);
  root.updateMatrixWorld(true);
  const geometryIds = [terrainGeometry.uuid];
  for (const entry of entries) {
    for (const mesh of entry.compiled.slotMeshes) geometryIds.push(mesh.geometry?.uuid ?? mesh.uuid);
  }
  const digest = `fnv32:${hashText(JSON.stringify({
    causeField: causeField.id,
    tier: tier.id,
    seed,
    terrainSegments: tier.terrainSegments,
    plans: planSignatures,
    geometryIds,
  }))}`;
  let disposed = false;

  return {
    root,
    terrain,
    buildings: entries,
    ownershipOverlay,
    facadeOwnershipKeys,
    planSignatures,
    geometryIds,
    digest,
    resourceRecords,
    causeFieldId: causeField.id,
    setDiagnosticVisibility(mode) {
      ownershipOverlay.visible = mode === "facade-ownership" || mode === "owner-graph";
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.remove(ownershipOverlay, terrain);
      ownershipOverlay.geometry.dispose();
      ownershipOverlay.material.dispose();
      terrainGeometry.dispose();
      for (const entry of entries) factory.dispose(entry.compiled);
      root.clear();
    },
  };
}
