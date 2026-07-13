import {
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsNodeMaterial,
  RenderPipeline,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three/webgpu";
import {
  attribute,
  color,
  cross,
  clamp,
  dot,
  float,
  mix,
  instancedArray,
  length,
  positionLocal,
  normalize,
  sin,
  uniform,
  uv,
  vec3,
} from "three/tsl";

import { ashMedium } from "./ash-preset.js";
import {
  compileAshTree,
  reportAshForegroundBoundsAndFrustum,
} from "./tree-system.js";

export const ashDiagnosticModes = Object.freeze([
  "final",
  "branch-levels",
  "continuations",
  "child-slots",
  "angular-slots",
  "leaf-origins",
  "bark-uv-checker",
  "wind-displacement",
]);

const ASSET_URLS = Object.freeze({
  barkColor: new URL("../../assets/structured-ash-growth/bark-color.jpg", import.meta.url),
  barkNormal: new URL("../../assets/structured-ash-growth/bark-normal.jpg", import.meta.url),
  barkRoughness: new URL("../../assets/structured-ash-growth/bark-roughness.jpg", import.meta.url),
  leafColor: new URL("../../assets/structured-ash-growth/ash.png", import.meta.url),
  leafAlpha: new URL("../../assets/structured-ash-growth/ash.png", import.meta.url),
});

async function makeTexture(loader, url, colorSpace) {
  const texture = await loader.loadAsync(url.href);
  texture.colorSpace = colorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function disposeAshMaterialTextures(materials) {
  const textures = new Set();
  for (const material of [materials?.bark, materials?.leaves]) {
    for (const key of ["map", "normalMap", "roughnessMap", "alphaMap"]) {
      if (material?.[key]) textures.add(material[key]);
    }
  }
  for (const texture of textures) texture.dispose();
}

export function getAshGeometryResourceLedger(tree) {
  if (!tree?.branchGeometry || !tree?.leafGeometry || !tree?.leafOrigins) {
    throw new Error("compiled Ash tree geometry is required");
  }
  const arrays = new Set();
  for (const geometry of [tree.branchGeometry, tree.leafGeometry, tree.leafOrigins]) {
    for (const attribute of Object.values(geometry.attributes)) {
      if (attribute?.array) arrays.add(attribute.array);
    }
    if (geometry.index?.array) arrays.add(geometry.index.array);
  }
  return Object.freeze({
    uniqueBufferArrays: arrays.size,
    residentBytes: [...arrays].reduce((total, array) => total + array.byteLength, 0),
  });
}

async function createBarkMaterial({ textureLoader, loadTextures }) {
  const material = new MeshStandardNodeMaterial();
  material.name = "ash-bark-final";
  material.color = new Color(ashMedium.bark.tint);
  material.roughness = 0.82;
  material.metalness = 0;

  if (loadTextures) {
    material.map = await makeTexture(textureLoader, ASSET_URLS.barkColor, SRGBColorSpace);
    material.normalMap = await makeTexture(textureLoader, ASSET_URLS.barkNormal, NoColorSpace);
    material.roughnessMap = await makeTexture(textureLoader, ASSET_URLS.barkRoughness, NoColorSpace);
    material.map.repeat.set(1, 1 / ashMedium.bark.textureScaleY);
  }

  return material;
}

function createAshLeafWindNodes({ timeNode, windStrengthNode, phaseOffset = float(0) }) {
  const leafRoot = attribute("leafRoot", "vec3");
  const leafUvY = attribute("leafUvY", "float");
  const tangentU = attribute("leafTangentU", "vec3");
  const tangentV = attribute("leafTangentV", "vec3");
  const windPhase = dot(leafRoot, vec3(0.071, 0.113, 0.097)).add(phaseOffset);
  const baseWind = sin(timeNode.mul(0.5).add(windPhase)).mul(0.5);
  const gustWind = sin(timeNode.mul(1.0).add(windPhase.mul(1.3))).mul(0.3);
  const flutterWind = sin(timeNode.mul(2.5).add(windPhase.mul(1.5))).mul(0.2);
  const wind = baseWind.add(gustWind).add(flutterWind);
  const gradient = vec3(1.0, 0.18, 0.38).mul(windStrengthNode).mul(wind);
  return {
    leafUvY,
    gradient,
    displacement: gradient.mul(leafUvY),
    normal: normalize(cross(tangentU, tangentV.add(gradient))),
  };
}

export function evaluateAshLeafWindCPU({
  uvY,
  windStrength,
  windScalar,
  tangentU,
  tangentV,
} = {}) {
  const values = [uvY, windStrength, windScalar, ...tangentU, ...tangentV];
  if (!values.every(Number.isFinite) || uvY < 0 || uvY > 1) {
    throw new Error("invalid Ash leaf deformation oracle inputs");
  }
  const gradient = [1, 0.18, 0.38].map((axis) => axis * windStrength * windScalar);
  const displacement = gradient.map((axis) => axis * uvY);
  const deformedV = tangentV.map((axis, index) => axis + gradient[index]);
  const normal = [
    tangentU[1] * deformedV[2] - tangentU[2] * deformedV[1],
    tangentU[2] * deformedV[0] - tangentU[0] * deformedV[2],
    tangentU[0] * deformedV[1] - tangentU[1] * deformedV[0],
  ];
  const length = Math.hypot(...normal);
  return Object.freeze({
    displacement: Object.freeze(displacement),
    normal: Object.freeze(normal.map((axis) => axis / length)),
    normalLength: length > 0 ? 1 : 0,
  });
}

async function createLeafMaterial({ textureLoader, loadTextures, timeNode, windStrengthNode }) {
  const material = new MeshStandardNodeMaterial();
  material.name = "ash-leaves-final-rooted-wind";
  material.side = DoubleSide;
  material.alphaTest = ashMedium.leaves.alphaTest;
  material.alphaHash = true;
  material.forceSinglePass = true;
  material.roughness = 0.68;
  material.metalness = 0;

  if (loadTextures) {
    material.map = await makeTexture(textureLoader, ASSET_URLS.leafColor, SRGBColorSpace);
    material.alphaMap = await makeTexture(textureLoader, ASSET_URLS.leafAlpha, NoColorSpace);
  }

  const windNodes = createAshLeafWindNodes({ timeNode, windStrengthNode });
  material.positionNode = positionLocal.add(windNodes.displacement);
  material.normalNode = windNodes.normal;
  material.userData.windContract = {
    leafUvY: "roots the card base; uv.y=0 remains fixed",
    branchGeometry: "static in the Ash contract",
    windDisplacement: "leafUvY * windStrength * three-band sine wind",
  };
  material.userData.windNodes = { timeNode, windStrengthNode };
  material.userData.windGraph = windNodes;

  return material;
}

function createLeafWindDiagnosticMaterial(leaves) {
  const material = leaves.clone();
  material.name = "diagnostic-live-leaf-wind-and-shadow-parity";
  material.positionNode = leaves.positionNode;
  material.normalNode = leaves.normalNode;
  const magnitude = clamp(length(leaves.userData.windGraph.displacement).mul(4), 0, 1);
  material.colorNode = vec3(magnitude, attribute("leafUvY", "float").mul(0.35), float(1).sub(magnitude));
  return material;
}

function createDiagnosticMaterials() {
  const level = attribute("aLevel", "float");
  const continuation = attribute("aContinuation", "float");
  const childSlot = attribute("aChildSlot", "float");
  const angularSlot = attribute("aAngularSlot", "float");
  const barkUVChecker = attribute("barkUVChecker", "float");
  const windDisplacement = attribute("windDisplacement", "float");

  const branchLevels = new MeshBasicNodeMaterial();
  branchLevels.name = "diagnostic-branch-levels";
  branchLevels.colorNode = vec3(level, float(1).sub(level), level.mul(0.35).add(0.1));

  const continuations = new MeshBasicNodeMaterial();
  continuations.name = "diagnostic-continuations";
  continuations.colorNode = mix(color(0xb2632f), color(0x58a6d6), continuation);

  const childSlots = new MeshBasicNodeMaterial();
  childSlots.name = "diagnostic-child-slots";
  childSlots.colorNode = vec3(childSlot.add(1).div(8), float(0.2), float(1).sub(childSlot.add(1).div(8)));

  const angularSlots = new MeshBasicNodeMaterial();
  angularSlots.name = "diagnostic-angular-slots";
  angularSlots.colorNode = vec3(angularSlot.add(1).div(8), angularSlot.add(1).div(5), float(0.35));

  const barkChecker = new MeshBasicNodeMaterial();
  barkChecker.name = "diagnostic-bark-uv-checker";
  barkChecker.colorNode = mix(color(0x232323), color(0xf0efe4), barkUVChecker);

  const windMagnitude = new MeshBasicNodeMaterial();
  windMagnitude.name = "diagnostic-wind-displacement";
  windMagnitude.colorNode = vec3(windDisplacement, float(0.12), float(1).sub(windDisplacement));

  return {
    "branch-levels": branchLevels,
    continuations,
    "child-slots": childSlots,
    "angular-slots": angularSlots,
    "bark-uv-checker": barkChecker,
    "wind-displacement": windMagnitude,
  };
}

function createGround(worldUnitsPerMeter) {
  const geometry = new PlaneGeometry(480 * worldUnitsPerMeter, 480 * worldUnitsPerMeter, 1, 1);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new MeshStandardNodeMaterial();
  material.name = "ash-scene-ground";
  material.colorNode = color(0x33451f);
  material.roughness = 0.94;
  const ground = new Mesh(geometry, material);
  ground.name = "ash-ground-procedural-grass-dirt-placeholder";
  ground.receiveShadow = true;
  return ground;
}

export function createAshCamera({ aspect = 1.5, worldUnitsPerMeter = 1 } = {}) {
  if (!(worldUnitsPerMeter > 0) || !Number.isFinite(worldUnitsPerMeter)) {
    throw new Error("Ash worldUnitsPerMeter must be finite and positive");
  }
  const camera = new PerspectiveCamera(45, aspect, 0.1 * worldUnitsPerMeter, 1200 * worldUnitsPerMeter);
  camera.name = "ash-contract-camera-3x2";
  camera.position.set(115 * worldUnitsPerMeter, 20 * worldUnitsPerMeter, 0);
  camera.lookAt(0, 25 * worldUnitsPerMeter, 0);
  return camera;
}

export async function createAshScene({
  loadTextures = true,
  textureLoader = new TextureLoader(),
  timeNode = uniform(0),
  windStrengthNode = uniform(0.45),
  worldUnitsPerMeter = 1,
} = {}) {
  if (!(worldUnitsPerMeter > 0) || !Number.isFinite(worldUnitsPerMeter)) {
    throw new Error("Ash worldUnitsPerMeter must be finite and positive");
  }
  const tree = compileAshTree(ashMedium);
  const scene = new Scene();
  const camera = createAshCamera({ worldUnitsPerMeter });
  const group = new Group();
  const ground = createGround(worldUnitsPerMeter);
  const materials = {
    bark: await createBarkMaterial({ textureLoader, loadTextures }),
    leaves: await createLeafMaterial({ textureLoader, loadTextures, timeNode, windStrengthNode }),
    diagnostics: createDiagnosticMaterials(),
  };
  materials.diagnostics["leaf-wind-displacement"] = createLeafWindDiagnosticMaterial(materials.leaves);

  scene.name = "structured-ash-growth-webgpu-tsl";
  scene.background = new Color(0x98b8cf);
  scene.fog = new FogExp2(0x98b8cf, 0.0045 / worldUnitsPerMeter);

  const branchMesh = new Mesh(tree.branchGeometry, materials.bark);
  branchMesh.name = "ash-branch-contract-geometry";
  branchMesh.castShadow = true;
  branchMesh.receiveShadow = true;

  const leafMesh = new Mesh(tree.leafGeometry, materials.leaves);
  leafMesh.name = "ash-leaf-cards-rooted-leafUvY-wind";
  leafMesh.castShadow = true;

  const originMaterial = new PointsNodeMaterial();
  originMaterial.name = "diagnostic-leaf-origins";
  originMaterial.colorNode = color(0xffd45c);
  originMaterial.sizeNode = float(0.75);
  const leafOrigins = new Points(tree.leafOrigins, originMaterial);
  leafOrigins.name = "ash-leaf-origin-diagnostic-points";
  leafOrigins.visible = false;

  group.name = "foreground-ash-contract";
  group.scale.setScalar(worldUnitsPerMeter);
  group.add(branchMesh, leafMesh, leafOrigins);
  scene.add(group, ground);

  const sun = new DirectionalLight(0xfff1c4, 3.2);
  sun.name = "ash-daylight-sun";
  sun.position.set(70 * worldUnitsPerMeter, 95 * worldUnitsPerMeter, 55 * worldUnitsPerMeter);
  sun.castShadow = true;
  scene.add(sun, new AmbientLight(0x9fb8cf, 0.45));

  const state = {
    scene,
    camera,
    tree,
    group,
    branchMesh,
    leafMesh,
    leafOrigins,
    ground,
    materials,
    sun,
    timeNode,
    windStrengthNode,
    diagnosticMode: "final",
    worldUnitsPerMeter,
    diagnostics: reportAshForegroundBoundsAndFrustum(tree, camera, worldUnitsPerMeter),
  };

  state.setDiagnosticMode = (mode = "final") => setAshDiagnosticMode(state, mode);
  return state;
}

function ashForestRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
    value = (value ^ (value >>> 15)) >>> 0;
    return value / 0x100000000;
  };
}

function hashFloatStorage(arrays) {
  let hash = 0x811c9dc5;
  const word = new Uint32Array(1);
  const scalar = new Float32Array(word.buffer);
  for (const array of arrays) {
    for (const value of array) {
      scalar[0] = value;
      hash ^= word[0];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

function createForestBand({
  tree,
  materials,
  timeNode,
  count,
  seed,
  radiusMin,
  radiusMax,
  lod,
  worldUnitsPerMeter,
}) {
  const transformStorage = instancedArray(count, "vec4").setName(`AshForestTransformLod${lod}`);
  const stateStorage = instancedArray(count, "vec4").setName(`AshForestTintPhaseLod${lod}`);
  const random = ashForestRandom(seed);
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = radiusMin + random() * (radiusMax - radiusMin);
    const scale = 0.72 + random() * 0.38;
    const lane = index * 4;
    transformStorage.value.array[lane + 0] = Math.cos(angle) * radius * worldUnitsPerMeter;
    transformStorage.value.array[lane + 1] = 0;
    transformStorage.value.array[lane + 2] = Math.sin(angle) * radius * worldUnitsPerMeter;
    transformStorage.value.array[lane + 3] = scale;
    stateStorage.value.array[lane + 0] = 0.86 + random() * 0.25;
    stateStorage.value.array[lane + 1] = random() * Math.PI * 2;
    stateStorage.value.array[lane + 2] = lod;
    stateStorage.value.array[lane + 3] = 1;
  }
  transformStorage.value.needsUpdate = true;
  stateStorage.value.needsUpdate = true;

  const transform = transformStorage.toAttribute();
  const state = stateStorage.toAttribute();
  const branchGeometry = new InstancedBufferGeometry().copy(tree.branchGeometry);
  const leafGeometry = new InstancedBufferGeometry().copy(tree.leafGeometry);
  branchGeometry.instanceCount = count;
  leafGeometry.instanceCount = count;

  const bark = materials.bark.clone();
  bark.name = `ash-forest-bark-storage-lod${lod}`;
  bark.positionNode = positionLocal.mul(transform.w).mul(worldUnitsPerMeter).add(transform.xyz);
  bark.colorNode = color(ashMedium.bark.tint).mul(state.x);

  const leaves = materials.leaves.clone();
  leaves.name = `ash-forest-leaves-storage-lod${lod}`;
  const windStrengthNode = materials.leaves.userData.windNodes.windStrengthNode;
  const windNodes = createAshLeafWindNodes({
    timeNode,
    windStrengthNode: windStrengthNode.mul(mix(1, 0.45, state.z)),
    phaseOffset: state.y,
  });
  leaves.positionNode = positionLocal
    .add(windNodes.displacement)
    .mul(transform.w)
    .mul(worldUnitsPerMeter)
    .add(transform.xyz);
  leaves.normalNode = windNodes.normal;
  leaves.colorNode = color(0x658b35).mul(state.x);

  const branches = new Mesh(branchGeometry, bark);
  const foliage = new Mesh(leafGeometry, leaves);
  branches.name = `ash-forest-branches-lod${lod}`;
  foliage.name = `ash-forest-foliage-lod${lod}`;
  branches.castShadow = true;
  foliage.castShadow = true;
  // The named composition spans a 675-unit radius. Explicit conservative
  // bounds are a follow-up optimization; disabling object culling is truthful
  // and avoids silently dropping instances in this fixed validation scene.
  branches.frustumCulled = false;
  foliage.frustumCulled = false;

  return {
    branches,
    foliage,
    transformStorage,
    stateStorage,
    drawCount: 2,
    storageBytes: transformStorage.value.array.byteLength + stateStorage.value.array.byteLength,
    storageIdentity: hashFloatStorage([transformStorage.value.array, stateStorage.value.array]),
    storageArrays: [transformStorage.value.array, stateStorage.value.array],
    dispose() {
      branchGeometry.dispose();
      leafGeometry.dispose();
      bark.dispose();
      leaves.dispose();
      transformStorage.value.array = null;
      stateStorage.value.array = null;
    },
  };
}

export function createAshForestStorage({
  tree,
  materials,
  timeNode,
  count = 100,
  seed = 0x8de2,
  worldUnitsPerMeter = 1,
} = {}) {
  if (!tree || !materials || !timeNode) {
    throw new Error("Ash forest storage requires the compiled tree, materials, and shared time node");
  }
  if (!Number.isInteger(count) || count < 1) throw new Error("Ash forest count must be positive");
  if (!(worldUnitsPerMeter > 0) || !Number.isFinite(worldUnitsPerMeter)) {
    throw new Error("Ash forest worldUnitsPerMeter must be finite and positive");
  }
  const nearCount = Math.ceil(count * 0.5);
  const farCount = count - nearCount;
  const group = new Group();
  group.name = "ash-forest-storage-four-draw-bands";
  const bands = [
    { count: nearCount, seed, radiusMin: 175, radiusMax: 390, lod: 0 },
    { count: farCount, seed: seed ^ 0x9e3779b9, radiusMin: 390, radiusMax: 675, lod: 1 },
  ].filter((descriptor) => descriptor.count > 0).map((descriptor) => createForestBand({
    tree,
    materials,
    timeNode,
    worldUnitsPerMeter,
    ...descriptor,
  }));
  for (const band of bands) group.add(band.branches, band.foliage);
  return {
    group,
    bands,
    count,
    worldUnitsPerMeter,
    drawCount: bands.reduce((sum, band) => sum + band.drawCount, 0),
    storageBytes: bands.reduce((sum, band) => sum + band.storageBytes, 0),
    storageIdentity: bands.map((band) => band.storageIdentity).join("+"),
    storageImmutable: () => bands.every((band) =>
      band.transformStorage.value.array === band.storageArrays[0] &&
      band.stateStorage.value.array === band.storageArrays[1]),
    dispose() {
      for (const band of bands) band.dispose();
      group.clear();
    },
  };
}

export function setAshDiagnosticMode(state, mode = "final") {
  if (!ashDiagnosticModes.includes(mode)) throw new Error(`unknown Ash diagnostic mode "${mode}"`);
  const selected = mode;
  state.diagnosticMode = selected;
  state.leafOrigins.visible = selected === "leaf-origins";
  state.branchMesh.material = selected === "final" || selected === "leaf-origins"
    ? state.materials.bark
    : selected === "wind-displacement"
      ? state.materials.bark
      : state.materials.diagnostics[selected] ?? state.materials.bark;
  state.leafMesh.material = selected === "wind-displacement"
    ? state.materials.diagnostics["leaf-wind-displacement"]
    : state.materials.leaves;
  state.leafMesh.visible = selected !== "bark-uv-checker" && selected !== "child-slots" && selected !== "angular-slots";
  return selected;
}

export function createAshRenderPipeline(renderer, sceneState) {
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = true;
  pipeline.userData = {
    owner: "structured-ash-growth-scene",
    toneMapAndOutput: "RenderPipeline.outputColorTransform",
    diagnosticModes: ashDiagnosticModes,
    scene: sceneState.scene.name,
    camera: sceneState.camera.name,
  };
  return pipeline;
}
