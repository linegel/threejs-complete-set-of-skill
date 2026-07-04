import {
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
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
  dot,
  float,
  mix,
  positionLocal,
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

function makeTexture(loader, url, colorSpace) {
  const texture = loader.load(url.href);
  texture.colorSpace = colorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createBarkMaterial({ textureLoader, loadTextures }) {
  const material = new MeshStandardNodeMaterial();
  material.name = "ash-bark-final";
  material.color = new Color(ashMedium.bark.tint);
  material.roughness = 0.82;
  material.metalness = 0;

  if (loadTextures) {
    material.map = makeTexture(textureLoader, ASSET_URLS.barkColor, SRGBColorSpace);
    material.normalMap = makeTexture(textureLoader, ASSET_URLS.barkNormal, NoColorSpace);
    material.roughnessMap = makeTexture(textureLoader, ASSET_URLS.barkRoughness, NoColorSpace);
    material.map.repeat.set(1, 1 / ashMedium.bark.textureScaleY);
  }

  return material;
}

function createLeafMaterial({ textureLoader, loadTextures, timeNode, windStrengthNode }) {
  const material = new MeshStandardNodeMaterial();
  material.name = "ash-leaves-final-rooted-wind";
  material.side = DoubleSide;
  material.alphaTest = ashMedium.leaves.alphaTest;
  material.alphaHash = true;
  material.forceSinglePass = true;
  material.roughness = 0.68;
  material.metalness = 0;

  if (loadTextures) {
    material.map = makeTexture(textureLoader, ASSET_URLS.leafColor, SRGBColorSpace);
    material.alphaMap = makeTexture(textureLoader, ASSET_URLS.leafAlpha, NoColorSpace);
  }

  const leafRoot = attribute("leafRoot", "vec3");
  const leafUvY = attribute("leafUvY", "float");
  const windPhase = dot(leafRoot, vec3(0.071, 0.113, 0.097));
  const baseWind = sin(timeNode.mul(0.5).add(windPhase)).mul(0.5);
  const gustWind = sin(timeNode.mul(1.0).add(windPhase.mul(1.3))).mul(0.3);
  const flutterWind = sin(timeNode.mul(2.5).add(windPhase.mul(1.5))).mul(0.2);
  const wind = baseWind.add(gustWind).add(flutterWind);
  const windVector = vec3(1.0, 0.18, 0.38).mul(leafUvY).mul(windStrengthNode).mul(wind);

  material.positionNode = positionLocal.add(windVector);
  material.userData.windContract = {
    leafUvY: "roots the card base; uv.y=0 remains fixed",
    branchGeometry: "static in the Ash contract",
    windDisplacement: "leafUvY * windStrength * three-band sine wind",
  };

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

function createGround() {
  const geometry = new PlaneGeometry(480, 480, 1, 1);
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

export function createAshCamera({ aspect = 1.5 } = {}) {
  const camera = new PerspectiveCamera(45, aspect, 0.1, 1200);
  camera.name = "ash-contract-camera-3x2";
  camera.position.set(115, 20, 0);
  camera.lookAt(0, 25, 0);
  return camera;
}

export function createAshScene({
  loadTextures = true,
  textureLoader = new TextureLoader(),
  timeNode = uniform(0),
  windStrengthNode = uniform(0.45),
} = {}) {
  const tree = compileAshTree(ashMedium);
  const scene = new Scene();
  const camera = createAshCamera();
  const group = new Group();
  const materials = {
    bark: createBarkMaterial({ textureLoader, loadTextures }),
    leaves: createLeafMaterial({ textureLoader, loadTextures, timeNode, windStrengthNode }),
    diagnostics: createDiagnosticMaterials(),
  };

  scene.name = "structured-ash-growth-webgpu-tsl";
  scene.background = new Color(0x98b8cf);
  scene.fog = new FogExp2(0x98b8cf, 0.0045);

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
  group.add(branchMesh, leafMesh, leafOrigins);
  scene.add(group, createGround());

  const sun = new DirectionalLight(0xfff1c4, 3.2);
  sun.name = "ash-daylight-sun";
  sun.position.set(70, 95, 55);
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
    materials,
    timeNode,
    windStrengthNode,
    diagnosticMode: "final",
    diagnostics: reportAshForegroundBoundsAndFrustum(tree, camera),
  };

  state.setDiagnosticMode = (mode = "final") => setAshDiagnosticMode(state, mode);
  return state;
}

export function setAshDiagnosticMode(state, mode = "final") {
  const selected = ashDiagnosticModes.includes(mode) ? mode : "final";
  state.diagnosticMode = selected;
  state.leafOrigins.visible = selected === "leaf-origins";
  state.branchMesh.material = selected === "final" || selected === "leaf-origins"
    ? state.materials.bark
    : state.materials.diagnostics[selected] ?? state.materials.bark;
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
