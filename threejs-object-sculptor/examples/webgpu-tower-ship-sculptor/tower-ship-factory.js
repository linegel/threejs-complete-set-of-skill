import * as THREE from "three/webgpu";
import { color } from "three/tsl";

export const TOWER_SHIP_MODES = Object.freeze([
  "final",
  "blockout",
  "hierarchy",
  "materials",
  "interaction",
]);
export const TOWER_SHIP_TIERS = Object.freeze(["full", "budgeted", "minimum"]);

const TIER_LIMITS = Object.freeze({
  full: { hullStations: 17, hullRadial: 12, cylinder: 12, roofX: 18, roofZ: 8, grids: true, ornaments: true },
  budgeted: { hullStations: 13, hullRadial: 10, cylinder: 8, roofX: 12, roofZ: 6, grids: true, ornaments: true },
  minimum: { hullStations: 9, hullRadial: 8, cylinder: 6, roofX: 8, roofZ: 4, grids: false, ornaments: false },
});

const PALETTE = Object.freeze({
  warmWood: 0x9a552d,
  warmWoodLight: 0xc47b42,
  darkWood: 0x241716,
  darkWoodEdge: 0x3a2420,
  paper: 0xe8d9b7,
  sail: 0xc9a85f,
  sailDark: 0x94733e,
  metal: 0x55575a,
  rope: 0x1b1514,
  lantern: 0xff9f32,
  blockout: 0xb9c2c8,
});

function nodeMaterial(hex, { roughness = 0.72, metalness = 0, emissive = null, side = THREE.FrontSide } = {}) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = color(hex);
  material.roughness = roughness;
  material.metalness = metalness;
  material.side = side;
  if (emissive !== null) {
    material.emissiveNode = color(emissive);
    material.emissiveIntensity = 1.8;
  }
  return material;
}

function makeMaterials() {
  return {
    warmWood: nodeMaterial(PALETTE.warmWood, { roughness: 0.76 }),
    warmWoodLight: nodeMaterial(PALETTE.warmWoodLight, { roughness: 0.68 }),
    darkWood: nodeMaterial(PALETTE.darkWood, { roughness: 0.64 }),
    darkWoodEdge: nodeMaterial(PALETTE.darkWoodEdge, { roughness: 0.58 }),
    paper: nodeMaterial(PALETTE.paper, { roughness: 0.88, side: THREE.DoubleSide }),
    sail: nodeMaterial(PALETTE.sail, { roughness: 0.82, side: THREE.DoubleSide }),
    sailDark: nodeMaterial(PALETTE.sailDark, { roughness: 0.76, side: THREE.DoubleSide }),
    metal: nodeMaterial(PALETTE.metal, { roughness: 0.48, metalness: 0.72 }),
    rope: nodeMaterial(PALETTE.rope, { roughness: 0.92 }),
    lantern: nodeMaterial(PALETTE.lantern, { roughness: 0.42, emissive: 0xff6b18 }),
    blockout: nodeMaterial(PALETTE.blockout, { roughness: 0.84 }),
    hierarchyHull: nodeMaterial(0x3da9d8, { roughness: 0.7 }),
    hierarchyTower: nodeMaterial(0xd45c78, { roughness: 0.7 }),
    hierarchyRig: nodeMaterial(0xf0b34c, { roughness: 0.7 }),
    hierarchyOars: nodeMaterial(0x65c18c, { roughness: 0.7 }),
    hierarchyDetail: nodeMaterial(0x8b78d2, { roughness: 0.7 }),
  };
}

function register(runtime, object, { id, kind = "node", collider = null, destructionGroup = null } = {}) {
  object.name = id;
  object.userData.sculptId = id;
  runtime.nodes.set(id, object);
  if (object.isMesh) runtime.meshes.set(id, object);
  if (kind === "socket") runtime.sockets.set(id, object);
  if (collider) runtime.colliders.set(id, collider);
  if (destructionGroup) {
    if (!runtime.destructionGroups.has(destructionGroup)) runtime.destructionGroups.set(destructionGroup, []);
    runtime.destructionGroups.get(destructionGroup).push(id);
  }
  return object;
}

function mesh(runtime, id, geometry, material, { parent, group = "detail", destructionGroup = null } = {}) {
  const value = new THREE.Mesh(geometry, material);
  value.castShadow = true;
  value.receiveShadow = true;
  value.userData.originalMaterial = material;
  value.userData.semanticGroup = group;
  register(runtime, value, { id, destructionGroup });
  parent?.add(value);
  return value;
}

function pivot(runtime, id, parent, { destructionGroup = null } = {}) {
  const value = new THREE.Group();
  register(runtime, value, { id, destructionGroup });
  parent?.add(value);
  return value;
}

function socket(runtime, id, parent, position) {
  const value = new THREE.Object3D();
  value.position.fromArray(position);
  register(runtime, value, { id, kind: "socket" });
  parent.add(value);
  return value;
}

function cylinderBetween(runtime, id, start, end, radius, material, segments, parent, group = "detail") {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const delta = b.clone().sub(a);
  const value = mesh(runtime, id, new THREE.CylinderGeometry(radius, radius, delta.length(), segments, 1), material, { parent, group });
  value.position.copy(a).addScaledVector(delta, 0.5);
  value.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return value;
}

function buildHullGeometry(stations, radial) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < stations; i += 1) {
    const u = i / (stations - 1);
    const x = THREE.MathUtils.lerp(-10, 10, u);
    const edge = Math.pow(Math.abs(u * 2 - 1), 2.4);
    const beam = 0.55 + 1.82 * Math.pow(Math.sin(Math.PI * u), 0.55);
    const centerY = 0.72 + 1.4 * edge;
    for (let j = 0; j < radial; j += 1) {
      const v = j / radial;
      const angle = v * Math.PI * 2;
      const z = Math.cos(angle) * beam;
      const vertical = Math.sin(angle);
      const y = centerY + (vertical > 0 ? vertical * 1.28 : vertical * 1.9);
      positions.push(x, y, z);
      uvs.push(u * 4, v);
    }
  }
  for (let i = 0; i < stations - 1; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const next = (j + 1) % radial;
      const a = i * radial + j;
      const b = (i + 1) * radial + j;
      const c = (i + 1) * radial + next;
      const d = i * radial + next;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildRoofGeometry(width, depth, xSegments, zSegments, lift = 0.34) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let ix = 0; ix <= xSegments; ix += 1) {
    const u = ix / xSegments;
    const x = (u - 0.5) * width;
    const xEdge = Math.pow(Math.abs(u * 2 - 1), 5);
    for (let iz = 0; iz <= zSegments; iz += 1) {
      const v = iz / zSegments;
      const z = (v - 0.5) * depth;
      const zNorm = Math.abs(v * 2 - 1);
      const y = (1 - zNorm) * 0.62 + xEdge * lift + Math.pow(zNorm, 5) * 0.13;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }
  const stride = zSegments + 1;
  for (let ix = 0; ix < xSegments; ix += 1) {
    for (let iz = 0; iz < zSegments; iz += 1) {
      const a = ix * stride + iz;
      const b = (ix + 1) * stride + iz;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildSailGeometry() {
  const rows = 7;
  const columns = 5;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iy = 0; iy <= rows; iy += 1) {
    const v = iy / rows;
    const y = v * 6.4;
    const width = 5.25 * (0.92 - v * 0.32);
    for (let ix = 0; ix <= columns; ix += 1) {
      const u = ix / columns;
      const x = u * width;
      const z = Math.sin(u * Math.PI) * (0.34 + 0.12 * Math.sin(v * Math.PI));
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }
  const stride = columns + 1;
  for (let iy = 0; iy < rows; iy += 1) {
    for (let ix = 0; ix < columns; ix += 1) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addShojiFace(runtime, id, parent, materials, width, height, z, y, limits) {
  const panel = mesh(runtime, `${id}-panel`, new THREE.BoxGeometry(width, height, 0.09), materials.paper, { parent, group: "tower" });
  panel.position.set(0, y, z);
  const frame = limits.grids ? 6 : 3;
  for (let i = 0; i <= frame; i += 1) {
    const bar = mesh(runtime, `${id}-vertical-${i}`, new THREE.BoxGeometry(0.065, height + 0.1, 0.08), materials.darkWood, { parent, group: "tower" });
    bar.position.set(THREE.MathUtils.lerp(-width / 2, width / 2, i / frame), y, z + Math.sign(z) * 0.075);
  }
  const rows = limits.grids ? 3 : 1;
  for (let i = 0; i <= rows; i += 1) {
    const bar = mesh(runtime, `${id}-horizontal-${i}`, new THREE.BoxGeometry(width + 0.1, 0.065, 0.08), materials.darkWood, { parent, group: "tower" });
    bar.position.set(0, THREE.MathUtils.lerp(y - height / 2, y + height / 2, i / rows), z + Math.sign(z) * 0.075);
  }
}

function addCabinTier(runtime, id, parent, materials, width, height, depth, y, limits) {
  const tier = pivot(runtime, id, parent, { destructionGroup: id });
  const floor = mesh(runtime, `${id}-floor`, new THREE.BoxGeometry(width + 0.25, 0.14, depth + 0.25), materials.darkWood, { parent: tier, group: "tower", destructionGroup: id });
  floor.position.y = y - height / 2;
  addShojiFace(runtime, `${id}-front`, tier, materials, width, height, depth / 2, y, limits);
  addShojiFace(runtime, `${id}-back`, tier, materials, width, height, -depth / 2, y, limits);
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) {
      const post = mesh(runtime, `${id}-post-${x}-${z}`, new THREE.BoxGeometry(0.16, height + 0.35, 0.16), materials.darkWood, { parent: tier, group: "tower", destructionGroup: id });
      post.position.set(x, y, z);
    }
  }
  return tier;
}

function addRoof(runtime, id, parent, materials, width, depth, y, limits) {
  const roofPivot = pivot(runtime, id, parent, { destructionGroup: id });
  const roof = mesh(runtime, `${id}-surface`, buildRoofGeometry(width, depth, limits.roofX, limits.roofZ), materials.darkWood, { parent: roofPivot, group: "tower", destructionGroup: id });
  roof.position.y = y;
  const ridge = mesh(runtime, `${id}-ridge`, new THREE.CylinderGeometry(0.12, 0.12, width * 0.78, limits.cylinder, 1), materials.darkWoodEdge, { parent: roofPivot, group: "tower" });
  ridge.rotation.z = Math.PI / 2;
  ridge.position.y = y + 0.68;
  if (limits.ornaments) {
    for (const side of [-1, 1]) {
      const finial = mesh(runtime, `${id}-finial-${side}`, new THREE.ConeGeometry(0.18, 0.75, limits.cylinder), materials.metal, { parent: roofPivot, group: "detail" });
      finial.rotation.z = side * Math.PI / 2;
      finial.position.set(side * width * 0.43, y + 0.78, 0);
    }
  }
  return roofPivot;
}

function addOar(runtime, parent, materials, limits, side, index) {
  const label = side > 0 ? "starboard" : "port";
  const id = `oar-${label}-${String(index).padStart(2, "0")}`;
  const u = index / 11;
  const x = THREE.MathUtils.lerp(-7.2, 7.2, u);
  const edge = Math.pow(Math.abs(u * 2 - 1), 2.4);
  const z = side * (1.88 - edge * 0.28);
  const y = 2.15 + edge * 0.62;
  const oar = pivot(runtime, id, parent, { destructionGroup: "oar-bank" });
  oar.position.set(x, y, z);
  oar.userData.baseRotationX = side * 0.12;
  oar.rotation.x = oar.userData.baseRotationX;
  socket(runtime, `${id}-socket`, oar, [0, 0, 0]);
  const end = [side * -0.12, -2.35, side * 3.1];
  cylinderBetween(runtime, `${id}-shaft`, [0, 0, 0], end, 0.055, materials.warmWoodLight, limits.cylinder, oar, "oars");
  const blade = mesh(runtime, `${id}-blade`, new THREE.SphereGeometry(0.42, limits.cylinder, Math.max(4, limits.cylinder / 2)), materials.warmWoodLight, { parent: oar, group: "oars", destructionGroup: "oar-bank" });
  blade.position.fromArray(end);
  blade.scale.set(0.24, 1.05, 0.42);
  blade.rotation.x = side * 0.55;
  const collar = mesh(runtime, `${id}-collar`, new THREE.TorusGeometry(0.11, 0.025, 5, limits.cylinder), materials.metal, { parent: oar, group: "oars" });
  collar.rotation.x = Math.PI / 2;
  return oar;
}

function addDeckDetails(runtime, root, materials, limits) {
  const details = pivot(runtime, "deck-details", root, { destructionGroup: "deck-props" });
  const railXs = limits.ornaments ? [-7.6, -6, -4.4, 4.4, 6, 7.6] : [-6.5, 6.5];
  for (const side of [-1, 1]) {
    for (let i = 0; i < railXs.length; i += 1) {
      const x = railXs[i];
      const post = mesh(runtime, `rail-post-${side}-${i}`, new THREE.CylinderGeometry(0.07, 0.08, 1.1, limits.cylinder), materials.darkWood, { parent: details, group: "detail" });
      post.position.set(x, 3.05, side * 1.78);
      if (limits.ornaments && side > 0 && i > 0 && i < railXs.length - 1) {
        const shield = mesh(runtime, `shield-${i}`, new THREE.CylinderGeometry(0.54, 0.54, 0.12, limits.cylinder), materials.metal, { parent: details, group: "detail" });
        shield.rotation.x = Math.PI / 2;
        shield.position.set(x, 3.25, side * 1.88);
        const boss = mesh(runtime, `shield-boss-${i}`, new THREE.SphereGeometry(0.16, limits.cylinder, Math.max(4, limits.cylinder / 2)), materials.warmWoodLight, { parent: details, group: "detail" });
        boss.position.set(x, 3.25, side * 1.97);
      }
    }
    cylinderBetween(runtime, `rail-top-${side}`, [-7.8, 3.58, side * 1.78], [7.8, 3.58, side * 1.78], 0.055, materials.darkWood, limits.cylinder, details, "detail");
  }
  for (const [index, x] of [-3.3, 2.9].entries()) {
    for (const side of [-1, 1]) {
      const lanternPivot = pivot(runtime, `lantern-${index}-${side}`, details, { destructionGroup: "deck-props" });
      lanternPivot.position.set(x, 5.2, side * 2.02);
      lanternPivot.userData.swayPhase = index + side * 0.3;
      cylinderBetween(runtime, `lantern-chain-${index}-${side}`, [0, 0, 0], [0, -0.45, 0], 0.018, materials.rope, 5, lanternPivot);
      const lantern = mesh(runtime, `lantern-body-${index}-${side}`, new THREE.CylinderGeometry(0.22, 0.18, 0.48, limits.cylinder), materials.lantern, { parent: lanternPivot, group: "detail" });
      lantern.position.y = -0.68;
    }
  }
  if (limits.ornaments) {
    const stairs = pivot(runtime, "stern-stairs", details, { destructionGroup: "deck-props" });
    for (let i = 0; i < 5; i += 1) {
      const step = mesh(runtime, `stern-step-${i}`, new THREE.BoxGeometry(1.1, 0.16, 0.42), materials.warmWoodLight, { parent: stairs, group: "detail" });
      step.position.set(7.5 + i * 0.28, 2.65 + i * 0.28, 0);
    }
    for (const side of [-1, 1]) {
      cylinderBetween(runtime, `prow-fork-${side}`, [-9.5, 2.3, 0], [-10.3, 4.35, side * 0.42], 0.12, materials.darkWood, limits.cylinder, details, "detail");
    }
  }
  return details;
}

function applySemanticMaterial(runtime, mode, materials) {
  for (const value of runtime.meshes.values()) {
    if (mode === "blockout") value.material = materials.blockout;
    else if (mode === "hierarchy") {
      const group = value.userData.semanticGroup;
      value.material = group === "hull" ? materials.hierarchyHull
        : group === "tower" ? materials.hierarchyTower
          : group === "rig" ? materials.hierarchyRig
            : group === "oars" ? materials.hierarchyOars
              : materials.hierarchyDetail;
    } else value.material = value.userData.originalMaterial;
  }
}

export function createTowerShip({ tier = "full", seed = 1 } = {}) {
  if (!TOWER_SHIP_TIERS.includes(tier)) throw new RangeError(`Unknown tier "${tier}"`);
  const limits = TIER_LIMITS[tier];
  const materials = makeMaterials();
  const root = new THREE.Group();
  const runtime = {
    seed,
    tier,
    nodes: new Map(),
    meshes: new Map(),
    sockets: new Map(),
    colliders: new Map(),
    destructionGroups: new Map(),
    materials,
    oars: [],
    lanterns: [],
    sail: null,
  };
  register(runtime, root, { id: "root", collider: { type: "compound", size: [20, 6, 5] }, destructionGroup: "vessel" });
  root.userData.sculptRuntime = runtime;

  const hullPivot = pivot(runtime, "hull", root, { destructionGroup: "hull-shell" });
  const hull = mesh(runtime, "hull-surface", buildHullGeometry(limits.hullStations, limits.hullRadial), materials.warmWood, { parent: hullPivot, group: "hull", destructionGroup: "hull-shell" });
  hull.position.y = 0.15;
  const deck = mesh(runtime, "deck", new THREE.BoxGeometry(16.8, 0.32, 3.55, 12, 1, 2), materials.warmWoodLight, { parent: root, group: "hull", destructionGroup: "deck" });
  deck.position.y = 2.54;
  const gunwaleShape = [[-8.3, 2.75, 1.88], [0, 2.58, 2.2], [8.3, 2.75, 1.88]];
  for (const side of [-1, 1]) {
    for (let i = 0; i < gunwaleShape.length - 1; i += 1) {
      const a = gunwaleShape[i];
      const b = gunwaleShape[i + 1];
      cylinderBetween(runtime, `gunwale-${side}-${i}`, [a[0], a[1], side * a[2]], [b[0], b[1], side * b[2]], 0.12, materials.darkWood, limits.cylinder, root, "hull");
    }
  }

  const tower = pivot(runtime, "tower", root, { destructionGroup: "tower" });
  tower.position.x = -0.6;
  addCabinTier(runtime, "cabin-lower", tower, materials, 5.25, 2.05, 3.15, 3.72, limits);
  addRoof(runtime, "roof-lower", tower, materials, 6.65, 4.2, 4.78, limits);
  addCabinTier(runtime, "cabin-upper", tower, materials, 4.05, 1.68, 2.55, 6.12, limits);
  addRoof(runtime, "roof-upper", tower, materials, 5.35, 3.35, 7.05, limits);

  const mast = pivot(runtime, "mast", root, { destructionGroup: "mast-rig" });
  mast.position.set(1.65, 2.45, -0.35);
  socket(runtime, "mast-step", mast, [0, 0, 0]);
  cylinderBetween(runtime, "mast-pole", [0, 0, 0], [0, 9.65, 0], 0.17, materials.darkWood, limits.cylinder, mast, "rig");
  const crown = socket(runtime, "mast-crown", mast, [0, 9.65, 0]);
  const mastFinial = mesh(runtime, "mast-finial", new THREE.SphereGeometry(0.25, limits.cylinder, Math.max(4, limits.cylinder / 2)), materials.metal, { parent: mast, group: "rig" });
  mastFinial.position.copy(crown.position);
  const sailPivot = pivot(runtime, "sail", mast, { destructionGroup: "sail" });
  sailPivot.position.set(0.1, 2.2, 0);
  const sailSurface = mesh(runtime, "sail-surface", buildSailGeometry(), materials.sail, { parent: sailPivot, group: "rig", destructionGroup: "sail" });
  sailSurface.rotation.y = -0.08;
  runtime.sail = sailPivot;
  for (let row = 0; row <= 7; row += 1) {
    const v = row / 7;
    const width = 5.25 * (0.92 - v * 0.32);
    cylinderBetween(runtime, `sail-batten-${row}`, [0, v * 6.4, 0.02], [width, v * 6.4, 0.02], 0.035, row % 2 ? materials.sailDark : materials.darkWood, 6, sailPivot, "rig");
  }
  cylinderBetween(runtime, "sail-boom", [0, 2.2, 0], [5.2, 1.4, 0], 0.08, materials.darkWood, limits.cylinder, sailPivot, "rig");
  const rigTargets = [[-9.2, 2.9, 0], [8.7, 3.1, 0], [5.15, 1.4, 0], [4.2, 6.3, 0]];
  rigTargets.forEach((target, index) => {
    const start = index < 2 ? [1.65, 12.1, -0.35] : [1.75, 11.85, -0.32];
    cylinderBetween(runtime, `rig-line-${index}`, start, target, 0.022, materials.rope, 5, root, "rig");
  });

  const oarBank = pivot(runtime, "oar-bank", root, { destructionGroup: "oar-bank" });
  for (const side of [-1, 1]) {
    for (let index = 0; index < 12; index += 1) runtime.oars.push(addOar(runtime, oarBank, materials, limits, side, index));
  }
  const details = addDeckDetails(runtime, root, materials, limits);
  runtime.lanterns = [...runtime.nodes.values()].filter((value) => value.name.startsWith("lantern-") && !value.name.startsWith("lantern-body") && !value.name.startsWith("lantern-chain"));

  const worldSocket = socket(runtime, "camera-interest", root, [0, 4.2, 0]);
  worldSocket.visible = false;
  runtime.colliders.set("hull-compound", { type: "compound-boxes", boxes: [[0, 1.1, 0, 15, 3, 4.5], [-8.8, 2, 0, 3, 3, 2.8], [8.8, 2, 0, 3, 3, 2.8]] });
  runtime.colliders.set("tower-box", { type: "box", center: [-0.6, 5.1, 0], size: [6.6, 6.4, 4.2] });
  runtime.colliders.set("mast-capsule", { type: "capsule", start: [1.65, 2.45, -0.35], end: [1.65, 12.1, -0.35], radius: 0.2 });
  runtime.nodes.set("deck-details", details);
  root.updateMatrixWorld(true);

  function setMode(mode) {
    if (!TOWER_SHIP_MODES.includes(mode)) throw new RangeError(`Unknown mode "${mode}"`);
    applySemanticMaterial(runtime, mode, materials);
    details.visible = mode !== "blockout";
    for (const value of runtime.nodes.values()) {
      if (value.name.startsWith("shoji-") || value.name.includes("vertical") || value.name.includes("horizontal")) value.visible = mode !== "blockout";
    }
  }

  function setTime(seconds, animate = false) {
    const active = animate ? seconds : 0;
    runtime.oars.forEach((oar, index) => {
      const side = oar.name.includes("starboard") ? 1 : -1;
      oar.rotation.x = oar.userData.baseRotationX + Math.sin(active * 1.8 + index * 0.12) * 0.18 * side;
      oar.rotation.z = Math.sin(active * 1.8 + index * 0.12) * 0.08;
    });
    runtime.lanterns.forEach((lantern) => {
      lantern.rotation.z = Math.sin(active * 1.25 + lantern.userData.swayPhase) * 0.09;
    });
    sailPivot.rotation.y = Math.sin(active * 0.72) * 0.045;
    sailSurface.scale.z = 1 + Math.sin(active * 1.1) * 0.04;
    root.updateMatrixWorld(true);
  }

  function dispose() {
    const geometries = new Set();
    const ownedMaterials = new Set(Object.values(materials));
    root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
    });
    geometries.forEach((geometry) => geometry.dispose());
    ownedMaterials.forEach((material) => material.dispose());
  }

  return { root, runtime, setMode, setTime, dispose };
}

export function summarizeTowerShip(root) {
  const runtime = root.userData.sculptRuntime;
  let triangles = 0;
  let vertices = 0;
  root.traverse((object) => {
    if (!object.geometry) return;
    const position = object.geometry.getAttribute("position");
    vertices += position?.count ?? 0;
    triangles += object.geometry.index ? object.geometry.index.count / 3 : (position?.count ?? 0) / 3;
  });
  return {
    nodes: runtime.nodes.size,
    meshes: runtime.meshes.size,
    sockets: runtime.sockets.size,
    colliders: runtime.colliders.size,
    destructionGroups: runtime.destructionGroups.size,
    oars: runtime.oars.length,
    vertices,
    triangles,
  };
}
