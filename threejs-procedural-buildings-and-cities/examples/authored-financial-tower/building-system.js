import * as THREE from "three";

const BAY_WIDTH = 3.2;
const FLOOR_HEIGHT = 3.35;
const PODIUM_FLOOR_HEIGHT = 4.45;

const settings = {
  seed: 1042,
  variant: "setback-tower",
  widthBays: 9,
  depthBays: 7,
  floors: 17,
  podiumFloors: 3,
  setbackFloors: 2,
  towerScale: 0.82,
  ornamentDensity: 0.72,
  colonnade: true,
  crown: true,
  shaftRhythm: "chicago-grid",
  roofStyle: "statue-tower",
  porticoProjection: 1.8,
  centralAxisBays: 3,
};

function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return { range: (min, max) => min + (max - min) * next() };
}

export function createBuildingPlan() {
  const random = createRandom(settings.seed);
  const fullWidth = settings.widthBays * BAY_WIDTH;
  const fullDepth = settings.depthBays * BAY_WIDTH;
  const podiumHeight = settings.podiumFloors * PODIUM_FLOOR_HEIGHT;
  const towerScale = THREE.MathUtils.clamp(
    settings.towerScale + random.range(-0.05, 0.04),
    0.62,
    0.96,
  );
  const baseInset =
    BAY_WIDTH * (1 - towerScale) * random.range(0.86, 1.08);
  const shaftFloors =
    settings.floors - settings.podiumFloors - settings.setbackFloors;
  const lower = Math.max(
    3,
    Math.floor(shaftFloors * random.range(0.36, 0.5)),
  );
  const middle = Math.max(
    3,
    Math.floor(shaftFloors * random.range(0.26, 0.38)),
  );
  const slices = [lower, middle, Math.max(1, shaftFloors - lower - middle)];
  const tiers = [{
    name: "podium",
    role: "podium",
    width: fullWidth,
    depth: fullDepth,
    y0: 0,
    height: podiumHeight,
    floors: settings.podiumFloors,
  }];
  let y = podiumHeight;
  for (let index = 0; index < slices.length; index += 1) {
    const inset = baseInset *
      (0.75 + index * 1.15 + random.range(-0.08, 0.12));
    tiers.push({
      name: `shaft-${index + 1}`,
      role: "shaft",
      width: Math.max(BAY_WIDTH * 4, fullWidth - inset * 2),
      depth: Math.max(BAY_WIDTH * 4, fullDepth - inset * 2),
      y0: y,
      height: slices[index] * FLOOR_HEIGHT,
      floors: slices[index],
      inset,
    });
    y += slices[index] * FLOOR_HEIGHT;
  }
  const crownInset =
    tiers.at(-1).inset + BAY_WIDTH * random.range(0.42, 0.68);
  tiers.push({
    name: "crown",
    role: "crown",
    width: Math.max(BAY_WIDTH * 4, fullWidth - crownInset * 2),
    depth: Math.max(BAY_WIDTH * 4, fullDepth - crownInset * 2),
    y0: y,
    height: settings.setbackFloors * FLOOR_HEIGHT,
    floors: settings.setbackFloors,
    inset: crownInset,
  });

  return {
    settings,
    bayWidth: BAY_WIDTH,
    floorHeight: FLOOR_HEIGHT,
    tiers,
    placements: createPlacements(tiers),
  };
}

function placement(moduleId, slot, shape, role, position, scale, rotation = [0, 0, 0]) {
  return { moduleId, slot, shape, role, position, scale, rotation };
}

function facadeTransform(side, tier, along, y, normalOffset = 0) {
  if (side === "front") {
    return { position: [along, y, tier.depth / 2 + normalOffset], rotationY: 0 };
  }
  if (side === "back") {
    return { position: [-along, y, -tier.depth / 2 - normalOffset], rotationY: Math.PI };
  }
  if (side === "right") {
    return { position: [tier.width / 2 + normalOffset, y, -along], rotationY: Math.PI / 2 };
  }
  return { position: [-tier.width / 2 - normalOffset, y, along], rotationY: -Math.PI / 2 };
}

function addFacadeBox(result, tier, side, along, y, width, height, depth, moduleId, slot, role, normalOffset = 0) {
  const transform = facadeTransform(side, tier, along, y + height / 2, normalOffset);
  result.push(placement(
    moduleId,
    slot,
    "box",
    role,
    transform.position,
    [width, height, depth],
    [0, transform.rotationY, 0],
  ));
}

function createPlacements(tiers) {
  const result = [];
  for (const tier of tiers) {
    result.push(placement(
      `${tier.role}-mass-cap`,
      "limestone",
      "box",
      tier.role,
      [0, tier.y0 + tier.height / 2, 0],
      [tier.width, tier.height, tier.depth],
    ));
    if (tier.role === "podium") appendPodium(result, tier);
    if (tier.role === "shaft") appendShaft(result, tier);
    if (tier.role === "crown") appendCrown(result, tier);
  }
  appendRoof(result, tiers.at(-1));
  return result;
}

function appendPodium(result, tier) {
  const sides = ["front", "back", "left", "right"];
  for (const side of sides) {
    const span = side === "front" || side === "back" ? tier.width : tier.depth;
    const count = side === "front" || side === "back" ? 9 : 7;
    const bay = span / count;
    for (let index = 0; index < count; index += 1) {
      const along = -span / 2 + bay * (index + 0.5);
      addFacadeBox(result, tier, side, along, 0, bay * 0.96, 0.74, 0.72, "granite-plinth", "granite", "podium", 0.08);
      for (let floor = 0; floor < tier.floors; floor += 1) {
        const y = floor === 0 ? 0.74 : floor * PODIUM_FLOOR_HEIGHT;
        const height = floor === 0 ? 3.79 : 4.27;
        const center = Math.floor(count / 2);
        const isDoor = side === "front" && floor === 0 && Math.abs(index - center) <= 1;
        const isCenter = side === "front" && floor === 0 && index === center;
        const slot = isDoor ? "bronze" : "glass";
        const moduleId = isCenter ? "revolving-door-bay" : isDoor ? "lobby-door" : "tall-lobby-window";
        addFacadeBox(result, tier, side, along, y + 0.12, bay * 0.72, height * 0.72, 0.22, moduleId, slot, "podium", 0.58);
        addFacadeBox(result, tier, side, along, y, bay * 0.94, 0.22, 0.48, "window-sill-strip", "limestone", "podium", 0.48);
        addFacadeBox(result, tier, side, along, y + height - 0.18, bay * 0.94, 0.28, 0.52, "lintel-strip", "ornament", "podium", 0.5);
      }
    }
    addFacadeBox(result, tier, side, 0, PODIUM_FLOOR_HEIGHT - 0.26, span, 0.52, 0.72, "belt-course-large", "ornament", "podium", 0.38);
    addFacadeBox(result, tier, side, 0, tier.height - 0.78, span, 0.78, 1.0, "large-cornice", "ornament", "podium", 0.46);
  }

  const frontCount = 9;
  for (let seam = 0; seam <= frontCount; seam += 1) {
    if (seam !== 0 && seam !== frontCount && seam % 2 === 0) continue;
    const x = -tier.width / 2 + (tier.width / frontCount) * seam;
    const isPylon = seam === 0 || seam === frontCount;
    result.push(placement(
      isPylon ? "square-corner-pylon" : "colossal-column",
      "limestone",
      isPylon ? "box" : "column",
      "podium",
      [x, 5.1, tier.depth / 2 + settings.porticoProjection],
      [isPylon ? 1.55 : 1.7, 10.2, isPylon ? 1.35 : 1.7],
    ));
  }
}

function appendShaft(result, tier) {
  const sides = ["front", "back", "left", "right"];
  for (const side of sides) {
    const span = side === "front" || side === "back" ? tier.width : tier.depth;
    const count = Math.max(4, Math.round(span / BAY_WIDTH));
    const bay = span / count;
    const center = Math.floor(count / 2);
    for (let floor = 0; floor < tier.floors; floor += 1) {
      const y = tier.y0 + floor * FLOOR_HEIGHT;
      for (let index = 0; index < count; index += 1) {
        const along = -span / 2 + bay * (index + 0.5);
        const corner = index === 0 || index === count - 1;
        const central = side === "front" &&
          Math.abs(index - center) <= Math.floor(settings.centralAxisBays / 2);
        if (corner) {
          addFacadeBox(result, tier, side, along, y, bay * 0.92, FLOOR_HEIGHT, 1.08, "rounded-corner-pier", "limestone", "shaft", 0.32);
        } else if (central) {
          addFacadeBox(result, tier, side, along, y + 0.24, bay * 0.78, FLOOR_HEIGHT - 0.46, 0.3, "central-glass-shaft", "glass", "shaft", 0.58);
        } else {
          const wide = index % 3 === 1;
          addFacadeBox(result, tier, side, along, y + 0.58, bay * (wide ? 0.66 : 0.52), 2.18, 0.24, wide ? "window-4m" : "window-3m", "glass", "shaft", 0.54);
          addFacadeBox(result, tier, side, along, y + 0.25, bay * 0.82, 0.42, 0.42, "spandrel-panel", "ornament", "shaft", 0.5);
        }
      }
      addFacadeBox(result, tier, side, 0, y - 0.16, span, 0.36, 0.54, "floor-band-strip", "ornament", "shaft", 0.34);
      addFacadeBox(result, tier, side, 0, y + FLOOR_HEIGHT - 0.48, span, 0.26, 0.54, "lintel-strip", "ornament", "shaft", 0.34);
    }
    for (let seam = 3; seam < count; seam += 3) {
      const along = -span / 2 + bay * seam;
      addFacadeBox(result, tier, side, along, tier.y0, 0.58, tier.height, 0.72, "pilaster-bundle", "limestone", "shaft", 0.48);
    }
    addFacadeBox(result, tier, side, 0, tier.y0 - 0.34, span, 0.54, 0.74, "belt-course-large", "ornament", "shaft", 0.4);
    addFacadeBox(result, tier, side, 0, tier.y0 + tier.height - 0.3, span, 0.36, 0.58, "dentil-corbel-course", "ornament", "shaft", 0.36);
  }
}

function appendCrown(result, tier) {
  for (const side of ["front", "back", "left", "right"]) {
    const span = side === "front" || side === "back" ? tier.width : tier.depth;
    const count = Math.max(3, Math.round(span / 3.6));
    const bay = span / count;
    for (let index = 0; index < count; index += 1) {
      const along = -span / 2 + bay * (index + 0.5);
      const edge = index === 0 || index === count - 1;
      addFacadeBox(result, tier, side, along, tier.y0, bay * 0.9, tier.height, edge ? 1.16 : 0.92, edge ? "corner-parapet" : "crown-window-bay", edge ? "limestone" : "glass", "crown", 0.38);
    }
    addFacadeBox(result, tier, side, 0, tier.y0 - 0.26, span, 0.36, 0.62, "small-cornice", "ornament", "crown", 0.35);
    addFacadeBox(result, tier, side, 0, tier.y0 + tier.height - 0.74, span, 0.8, 1.06, "large-cornice", "ornament", "crown", 0.46);
    if (side === "front" || side === "back") {
      addFacadeBox(result, tier, side, 0, tier.y0 + tier.height + 0.35, Math.min(5.4, span * 0.36), 1.45, 1.0, "crown-pediment", "ornament", "crown", 0.54);
    }
    for (const sign of [-1, 1]) {
      const along = sign * (span / 2 - 0.5);
      const transform = facadeTransform(side, tier, along, tier.y0 + tier.height + 1.1, 0.42);
      result.push(placement(
        "crown-urn-finial",
        "ornament",
        "finial",
        "crown",
        transform.position,
        [0.8, 1.6, 0.8],
        [0, transform.rotationY, 0],
      ));
    }
  }
}

function appendRoof(result, crown) {
  const roofHeight = Math.min(6.2, crown.depth * 0.32);
  result.push(placement(
    "sloped-metal-roof",
    "roof",
    "pyramid",
    "roof",
    [0, crown.y0 + crown.height + roofHeight / 2 + 0.12, 0],
    [crown.width * 0.92, roofHeight, crown.depth * 0.92],
    [0, Math.PI / 4, 0],
  ));
  result.push(placement(
    "roof-lantern",
    "black-metal",
    "box",
    "roof",
    [0, crown.y0 + crown.height + roofHeight + 1.0, 0],
    [2.4, 1.8, 2.4],
  ));
  result.push(placement(
    "roof-statue-mast",
    "bronze",
    "finial",
    "roof",
    [0, crown.y0 + crown.height + roofHeight + 4.4, 0],
    [1.7, 5.8, 1.7],
  ));
}

const roleColors = {
  podium: new THREE.Color(0x758faa),
  shaft: new THREE.Color(0x94a08a),
  crown: new THREE.Color(0xa88c6b),
  roof: new THREE.Color(0x6d7686),
};
const slotColors = {
  limestone: new THREE.Color(0xd4c9b2),
  granite: new THREE.Color(0x3f4448),
  glass: new THREE.Color(0x274b64),
  bronze: new THREE.Color(0x8d642d),
  "black-metal": new THREE.Color(0x171a1d),
  ornament: new THREE.Color(0xc6b58f),
  roof: new THREE.Color(0x405766),
};
const stone = new THREE.Color().setRGB(0.9, 0.84, 0.73);
const stoneDark = new THREE.Color().setRGB(0.58, 0.54, 0.47);
const stoneWarm = new THREE.Color().setRGB(0.78, 0.7, 0.6);

function finalInstanceColor(item) {
  if (item.slot !== "limestone" && item.slot !== "ornament") {
    return new THREE.Color(0xffffff);
  }
  if (item.moduleId.includes("mass-cap") || item.moduleId.includes("plinth")) {
    return stoneDark;
  }
  if (
    item.moduleId.includes("cornice") ||
    item.moduleId.includes("lintel") ||
    item.moduleId.includes("pediment")
  ) {
    return stoneWarm;
  }
  return stone;
}

function hashColor(text) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return new THREE.Color().setHSL(
    ((hash >>> 0) % 997) / 997,
    0.58,
    0.58,
  );
}

export function compileBuilding(plan, materials) {
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    column: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
    finial: new THREE.CylinderGeometry(0.28, 0.5, 1, 12),
    pyramid: new THREE.ConeGeometry(0.72, 1, 4),
  };
  const groups = new Map();
  for (const item of plan.placements) {
    const key = `${item.slot}:${item.shape}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const root = new THREE.Group();
  root.name = "compiled-financial-building";
  const batches = [];
  const diagnosticMaterial = new THREE.MeshBasicMaterial({
    toneMapped: false,
  });
  const dummy = new THREE.Object3D();
  for (const [key, items] of groups) {
    const [slot, shape] = key.split(":");
    const mesh = new THREE.InstancedMesh(
      geometries[shape],
      materials[slot],
      items.length,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.userData.items = items;
    mesh.userData.slot = slot;
    mesh.userData.finalMaterial = materials[slot];
    items.forEach((item, index) => {
      dummy.position.set(...item.position);
      dummy.rotation.set(...item.rotation);
      dummy.scale.set(...item.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, finalInstanceColor(item));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
    batches.push(mesh);
  }

  function setDebugMode(mode) {
    for (const batch of batches) {
      const diagnostic =
        mode === "topology" ||
        mode === "placements" ||
        mode === "material-slots";
      batch.material = diagnostic
        ? diagnosticMaterial
        : batch.userData.finalMaterial;
      batch.userData.items.forEach((item, index) => {
        let color = finalInstanceColor(item);
        if (mode === "topology") color = roleColors[item.role] ?? roleColors.roof;
        if (mode === "placements") color = hashColor(item.moduleId);
        if (mode === "material-slots") color = slotColors[item.slot];
        batch.setColorAt(index, color);
      });
      batch.instanceColor.needsUpdate = true;
    }
  }

  return {
    root,
    batches,
    setDebugMode,
    moduleCount: plan.placements.length,
  };
}
