import * as THREE from "three/webgpu";
import {
  color,
  emissive,
  float,
  mrt,
  output,
  pass,
  renderOutput,
  screenUV,
  select,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import {
  createAntiqueGoldPbrMaterial,
  createAtlasArrayTriplanarMaterials,
  createEbonyFramePbrMaterial,
  createInstancedDissolveAttributes,
  createLavaEmissivePbrMaterial,
  createMaterialTextureArray,
  createMipSafeMaterialAtlas,
  createTextureArrayLayerAttribute,
  createTriplanarMaterialTexture,
  createWalnutPbrMaterial,
  createWetRockPbrMaterial,
  disposeProceduralPbrMaterial,
  proceduralPbrDebugModes,
  proceduralPbrQualityTiers,
  resolveTierViewport,
  setLavaFlowTime,
  setProceduralPbrDebugMode,
} from "./procedural-pbr-materials.js";
import {
  computeRgbaReadbackLayout,
  computeRgba8ReadbackLayout,
  evaluateColorAttachmentBudget,
  hashMaterialSeed,
  materialSeedPhase,
  visualizeHalfFloatEmissive,
  WEBGPU_COLOR_ATTACHMENT_FORMAT_COST,
} from "./pbr-oracles.mjs";
import { assertLockedRouteMutation } from "./route-contract.mjs";

export const MATERIAL_SCENARIOS = Object.freeze([
  "pbr-identity",
  "specular-aa-and-filtering",
  "atlas-array-and-triplanar",
  "instanced-dissolve",
  "shadow-parity",
  "wet-rock-and-occlusion",
]);

export const MATERIAL_CAMERAS = Object.freeze(["near", "design", "far"]);

export const SCENE_DEBUG_MODES = Object.freeze({
  final: "final",
  noPost: "no-post",
  rawEmissive: "raw-emissive",
  bloomOnly: "bloom-only",
  materialAlbedo: "material-albedo",
  materialParams: "material-params",
  materialNormal: "material-normal",
  materialFootprint: "material-footprint",
  materialNormalVariance: "material-normal-variance",
});

export const MATERIAL_MODES = Object.freeze([
  ...Object.values(SCENE_DEBUG_MODES),
  "roughness-aa",
  "normal-variance",
  "dissolve",
  "triplanar-weights",
]);

const DIAGNOSTIC_MOSAIC_CAPTURE_MODE = "diagnostics-mosaic";

const RAW_MRT_CAPTURE_TARGETS = Object.freeze([
  SCENE_DEBUG_MODES.materialAlbedo,
  SCENE_DEBUG_MODES.materialParams,
  SCENE_DEBUG_MODES.materialNormal,
  SCENE_DEBUG_MODES.materialFootprint,
  SCENE_DEBUG_MODES.materialNormalVariance,
  SCENE_DEBUG_MODES.rawEmissive,
]);

export function createDisposableListenerScope() {
  const records = [];
  let disposed = false;
  return Object.freeze({
    listen(target, type, listener, options) {
      if (disposed) throw new Error("listener scope is disposed");
      if (!target?.addEventListener || !target?.removeEventListener) {
        throw new TypeError("listener target must implement addEventListener/removeEventListener");
      }
      target.addEventListener(type, listener, options);
      records.push({ target, type, listener, options });
      return listener;
    },
    dispose() {
      if (disposed) return 0;
      disposed = true;
      const count = records.length;
      while (records.length > 0) {
        const { target, type, listener, options } = records.pop();
        target.removeEventListener(type, listener, options);
      }
      return count;
    },
    get size() {
      return records.length;
    },
    get disposed() {
      return disposed;
    },
  });
}

function requireKnown(values, id, kind) {
  if (!values.includes(id)) throw new RangeError(`Unknown material ${kind} "${id}"`);
}

function nodeMaterial({ name, baseColor, roughness, metalness = 0 }) {
  const material = new THREE.MeshStandardNodeMaterial({ name });
  material.colorNode = color(baseColor);
  material.roughnessNode = float(roughness);
  material.metalnessNode = float(metalness);
  return material;
}

function setInstancedMatrix(mesh, index, position, scale = 1, rotationY = 0) {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
  matrix.compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
  mesh.setMatrixAt(index, matrix);
}

function textureMipByteCount(texture, bytesPerTexel = 4) {
  if (texture.mipmaps?.length) {
    return texture.mipmaps.reduce((sum, level) => sum + level.width * level.height * bytesPerTexel, 0);
  }
  const image = texture.image;
  const depth = image?.depth ?? 1;
  if (!image?.width || !image?.height) return null;
  let width = image.width;
  let height = image.height;
  let texels = 0;
  do {
    texels += width * height * depth;
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  } while (texture.generateMipmaps && (width > 1 || height > 1));
  if (texture.generateMipmaps) texels += depth;
  return texels * bytesPerTexel;
}

function renderTargetTextures(target) {
  if (!target) return [];
  if (Array.isArray(target.textures)) return target.textures;
  return target.texture ? [target.texture] : [];
}

function renderTargetTextureCost(texture) {
  const isRgba8 = texture?.type === THREE.UnsignedByteType;
  const format = isRgba8 ? "rgba8unorm" : "rgba16float";
  return {
    format,
    storageBytesPerTexel: isRgba8 ? 4 : 8,
    attachmentByteCostPerSample: WEBGPU_COLOR_ATTACHMENT_FORMAT_COST[format].pixelByteCost,
  };
}

function textureResource(id, texture, overrides = {}) {
  const image = texture?.image ?? {};
  return {
    id,
    runtimeIdentity: texture?.uuid ?? null,
    kind: texture?.isDepthTexture ? "depth-texture" : texture?.isDataArrayTexture ? "texture-array" : "texture",
    name: texture?.name ?? id,
    width: image.width ?? overrides.width ?? null,
    height: image.height ?? overrides.height ?? null,
    layers: image.depth ?? overrides.layers ?? 1,
    mipLevels: texture?.mipmaps?.length || (texture?.generateMipmaps ? "generated-full-chain" : 1),
    colorSpace: texture?.colorSpace ?? null,
    format: texture?.format ?? null,
    type: texture?.type ?? null,
    attachmentFormat: overrides.attachmentFormat ?? null,
    ownerPass: overrides.passId ?? null,
    byteCount: overrides.byteCount ?? null,
    byteCountProvenance: overrides.byteCount === null || overrides.byteCount === undefined ? "INSUFFICIENT_EVIDENCE" : "Derived",
    attachmentByteCostPerSample: overrides.attachmentByteCostPerSample ?? null,
  };
}

function instancedAttributeResource(id, attribute, semantic) {
  return {
    id,
    runtimeIdentity: attribute.uuid ?? attribute.id ?? `${semantic}:${attribute.count}:${attribute.itemSize}`,
    kind: "storage-capable-instanced-buffer",
    semantic,
    count: attribute.count,
    itemSize: attribute.itemSize,
    byteCount: attribute.array.byteLength,
    byteCountProvenance: "Derived",
    storageCapable: attribute.isStorageInstancedBufferAttribute === true,
    shaderReadPath: "instanced vertex attribute",
    storageBindingActive: false,
    computeDispatches: 0,
  };
}

export async function createProceduralPbrScene({
  canvas,
  width = 1280,
  height = 720,
  pixelRatio = 1,
  debugMode = "final",
  materialScale = 1,
  tier = "ultra",
  validationAttachments = true,
  runtimeProfile = "correctness",
  lockedRouteKind = null,
  lockedRouteId = null,
} = {}) {
  requireKnown(Object.keys(proceduralPbrQualityTiers), tier, "tier");
  if (!proceduralPbrDebugModes.has(debugMode)) throw new RangeError(`Unknown material mode "${debugMode}"`);
  requireKnown(["correctness", "performance"], runtimeProfile, "runtime profile");
  const routeLock = lockedRouteKind === null
    ? null
    : Object.freeze({ kind: lockedRouteKind, id: lockedRouteId });
  if (routeLock) {
    if (routeLock.kind === "mechanism") requireKnown(MATERIAL_SCENARIOS, routeLock.id, "locked mechanism route");
    else if (routeLock.kind === "tier") requireKnown(Object.keys(proceduralPbrQualityTiers), routeLock.id, "locked tier route");
    else throw new RangeError(`Unknown material route kind "${routeLock.kind}"`);
  }
  const listenerScope = createDisposableListenerScope();
  const timestampQueriesRequested = runtimeProfile === "performance";

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    outputBufferType: THREE.HalfFloatType,
    trackTimestamp: timestampQueriesRequested,
  });
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("threejs-procedural-materials requires native WebGPU.");
  }
  const initializedRendererDevice = renderer.backend.device;
  if (!initializedRendererDevice || typeof initializedRendererDevice.lost?.then !== "function") {
    throw new Error("initialized WebGPU backend did not expose its actual GPUDevice loss promise");
  }
  const rendererDeviceGeneration = 1;
  let rendererDeviceStatus = "active";
  let deviceLossGeneration = 0;
  let deviceLossDetails = null;
  let disposingRenderer = false;
  initializedRendererDevice.lost.then((info) => {
    if (disposingRenderer) return;
    rendererDeviceStatus = "lost";
    deviceLossGeneration = rendererDeviceGeneration;
    deviceLossDetails = {
      reason: info?.reason ?? "unknown",
      message: info?.message ?? "GPU device lost",
    };
  });
  const rendererBackendEvidence = () => ({
    backendKind: "WebGPU",
    backendType: "WebGPUBackend",
    deviceIdentityVerified: renderer.backend.device === initializedRendererDevice,
    deviceIdentitySource: "renderer.backend.device captured immediately after await renderer.init()",
    deviceType: initializedRendererDevice.constructor?.name || "GPUDevice",
    deviceLabel: initializedRendererDevice.label || "",
    lossPromiseObservedOnActualDevice: true,
    rendererDeviceGeneration,
  });
  const adapterIdentity = Object.freeze({
    source: "initialized renderer.backend.device",
    adapterClass: "unknown",
    deviceType: initializedRendererDevice.constructor?.name || "GPUDevice",
    deviceLabel: initializedRendererDevice.label || "",
    featureNames: Object.freeze(Array.from(initializedRendererDevice.features ?? [], String).sort()),
  });
  const timestampQueriesActive = timestampQueriesRequested
    && renderer.hasFeature?.("timestamp-query") === true;
  const colorAttachmentLimit = initializedRendererDevice.limits?.maxColorAttachmentBytesPerSample;
  if (!Number.isInteger(colorAttachmentLimit) || colorAttachmentLimit <= 0) {
    throw new Error("initialized GPUDevice did not expose maxColorAttachmentBytesPerSample");
  }
  const productionAttachmentBudget = evaluateColorAttachmentBudget({
    formats: ["rgba16float", "rgba16float"],
    limit: colorAttachmentLimit,
  });
  const diagnosticIdentityAttachmentBudget = evaluateColorAttachmentBudget({
    formats: ["rgba16float", "rgba8unorm", "rgba8unorm"],
    limit: colorAttachmentLimit,
  });
  const diagnosticSurfaceAttachmentBudget = evaluateColorAttachmentBudget({
    formats: ["rgba16float", "rgba8unorm", "rgba8unorm", "rgba8unorm"],
    limit: colorAttachmentLimit,
  });
  if (
    !productionAttachmentBudget.passes
    || !diagnosticIdentityAttachmentBudget.passes
    || !diagnosticSurfaceAttachmentBudget.passes
  ) {
    throw new Error("material pass attachments exceed maxColorAttachmentBytesPerSample");
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101416);
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 80);

  const materials = {
    walnut: createWalnutPbrMaterial({ seed: 11, coordinateScale: 1.15 * materialScale, debugMode }),
    antiqueGold: createAntiqueGoldPbrMaterial({ seed: 23, coordinateScale: 1.5 * materialScale, debugMode }),
    ebony: createEbonyFramePbrMaterial({ seed: 31, coordinateScale: 1.35 * materialScale, debugMode }),
    lava: createLavaEmissivePbrMaterial({ seed: 41, coordinateScale: 1.2 * materialScale, debugMode }),
    wetRock: createWetRockPbrMaterial({ seed: 53, coordinateScale: 1.1 * materialScale, debugMode }),
    dissolve: createWalnutPbrMaterial({ seed: 67, coordinateScale: 2.2, debugMode }),
  };
  const pbrMaterials = Object.values(materials);

  const fixtureGroups = {
    identity: new THREE.Group(),
    projection: new THREE.Group(),
    dissolve: new THREE.Group(),
    wetRock: new THREE.Group(),
  };
  for (const [name, group] of Object.entries(fixtureGroups)) {
    group.name = `material-fixture-${name}`;
    scene.add(group);
  }

  const sphereGeometry = new THREE.SphereGeometry(0.62, 96, 48);
  const swatches = [
    [materials.walnut, -3.2, "swatch-oiled-walnut"],
    [materials.antiqueGold, -1.6, "swatch-antique-gold"],
    [materials.ebony, 0, "swatch-ebony-lacquer"],
    [materials.lava, 1.6, "swatch-lava-crust-heat"],
    [materials.wetRock, 3.2, "swatch-wet-rock"],
  ].map(([material, x, name]) => {
    const mesh = new THREE.Mesh(sphereGeometry, material);
    mesh.position.set(x, 0.72, 0);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    fixtureGroups.identity.add(mesh);
    return mesh;
  });

  const sampledTextures = {
    atlas: createMipSafeMaterialAtlas(),
    array: createMaterialTextureArray(),
    triplanar: createTriplanarMaterialTexture(),
  };
  const projectionMaterials = createAtlasArrayTriplanarMaterials({
    atlas: sampledTextures.atlas,
    textureArray: sampledTextures.array,
    triplanarMap: sampledTextures.triplanar,
  });
  const atlasMesh = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.65, 1.65, 8, 8, 8), projectionMaterials.atlasMaterial);
  atlasMesh.position.set(-2.4, 0.92, 0);
  atlasMesh.name = "mip-safe-atlas-fixture";
  atlasMesh.castShadow = true;
  atlasMesh.receiveShadow = true;
  fixtureGroups.projection.add(atlasMesh);

  const arrayGeometry = new THREE.BoxGeometry(0.72, 0.72, 0.72, 4, 4, 4);
  arrayGeometry.setAttribute("instanceTextureLayer", createTextureArrayLayerAttribute(4));
  const arrayMesh = new THREE.InstancedMesh(arrayGeometry, projectionMaterials.arrayMaterial, 4);
  for (let index = 0; index < 4; index++) {
    setInstancedMatrix(arrayMesh, index, new THREE.Vector3(-0.6 + (index % 2) * 1.2, 0.48 + Math.floor(index / 2) * 0.92, 0));
  }
  arrayMesh.instanceMatrix.needsUpdate = true;
  arrayMesh.name = "texture-array-layer-fixture";
  arrayMesh.castShadow = true;
  arrayMesh.receiveShadow = true;
  fixtureGroups.projection.add(arrayMesh);

  const triplanarMesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.72, 0.24, 192, 32), projectionMaterials.triplanarMaterial);
  triplanarMesh.position.set(2.4, 0.92, 0);
  triplanarMesh.name = "three-axis-triplanar-fixture";
  triplanarMesh.castShadow = true;
  triplanarMesh.receiveShadow = true;
  fixtureGroups.projection.add(triplanarMesh);

  const dissolveGeometry = new THREE.IcosahedronGeometry(0.42, 3);
  const dissolveAttributes = createInstancedDissolveAttributes(15, { initialDissolve: 0, variantSeed: 73 });
  dissolveAttributes.attachTo(dissolveGeometry);
  for (let index = 0; index < 15; index++) dissolveAttributes.dissolve.array[index] = 0.08 + (index / 14) * 0.88;
  dissolveAttributes.dissolve.needsUpdate = true;
  const dissolveMesh = new THREE.InstancedMesh(dissolveGeometry, materials.dissolve, 15);
  for (let index = 0; index < 15; index++) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    setInstancedMatrix(
      dissolveMesh,
      index,
      new THREE.Vector3((column - 2) * 1.12, 0.48 + row * 0.92, 0),
      1,
      index * 0.37,
    );
  }
  dissolveMesh.instanceMatrix.needsUpdate = true;
  dissolveMesh.name = "storage-backed-instanced-dissolve-casters";
  dissolveMesh.castShadow = true;
  dissolveMesh.receiveShadow = true;
  fixtureGroups.dissolve.add(dissolveMesh);

  const wetRockGeometry = new THREE.DodecahedronGeometry(0.72, 4);
  const wetRockMeshes = [-2.1, 0, 2.1].map((x, index) => {
    const mesh = new THREE.Mesh(wetRockGeometry, materials.wetRock);
    mesh.position.set(x, 0.72, index === 1 ? -0.35 : 0.2);
    mesh.scale.set(1.15, 0.76 + index * 0.13, 1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `wet-rock-response-${index}`;
    fixtureGroups.wetRock.add(mesh);
    return mesh;
  });
  const occluderMaterial = nodeMaterial({ name: "direct-light occluder", baseColor: 0x2b3135, roughness: 0.86 });
  const directOccluder = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.8, 0.36), occluderMaterial);
  directOccluder.position.set(0.9, 2.05, 1.2);
  directOccluder.rotation.z = -0.24;
  directOccluder.castShadow = true;
  directOccluder.receiveShadow = false;
  directOccluder.name = "direct-light-only-occlusion-caster";
  fixtureGroups.wetRock.add(directOccluder);

  const floorMaterial = nodeMaterial({ name: "neutral ground receiver", baseColor: 0x3d4448, roughness: 0.74 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 5.2), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.name = "shadow-receiving-ground-plane";
  floor.receiveShadow = true;
  scene.add(floor);

  const ambient = new THREE.HemisphereLight(0xdce8ff, 0x171411, 1.15);
  ambient.name = "indirect-hemisphere-owner";
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.name = "direct-light-and-shadow-owner";
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -3;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  scene.add(key);
  scene.add(key.target);

  const renderPipeline = new THREE.RenderPipeline(renderer);
  renderPipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, emissive }));
  scenePass.setResolutionScale(1);
  const diagnosticIdentityPass = validationAttachments ? pass(scene, camera) : null;
  const diagnosticSurfacePass = validationAttachments ? pass(scene, camera) : null;
  const diagnosticIdentityMrt = {
    output,
    materialAlbedo: vec4(0),
    materialParams: vec4(0),
  };
  const diagnosticSurfaceMrt = {
    output,
    materialNormal: vec4(0),
    materialFootprint: vec4(0),
    materialNormalVariance: vec4(0),
  };
  const configureDiagnosticPass = (diagnosticPass, diagnosticMrt, attachmentNames) => {
    if (!diagnosticPass) return;
    diagnosticPass.setMRT(mrt(diagnosticMrt));
    diagnosticPass.setResolutionScale(1);
    for (const name of attachmentNames) {
      const diagnosticTexture = diagnosticPass.getTexture(name);
      diagnosticTexture.type = THREE.UnsignedByteType;
      diagnosticTexture.colorSpace = THREE.NoColorSpace;
    }
  };
  configureDiagnosticPass(
    diagnosticIdentityPass,
    diagnosticIdentityMrt,
    ["materialAlbedo", "materialParams"],
  );
  configureDiagnosticPass(
    diagnosticSurfacePass,
    diagnosticSurfaceMrt,
    ["materialNormal", "materialFootprint", "materialNormalVariance"],
  );

  const sceneColor = scenePass.getTextureNode("output");
  const emissiveNode = scenePass.getTextureNode("emissive");
  const materialAlbedoNode = diagnosticIdentityPass
    ? diagnosticIdentityPass.getTextureNode("materialAlbedo")
    : null;
  const materialParamsNode = diagnosticIdentityPass
    ? diagnosticIdentityPass.getTextureNode("materialParams")
    : null;
  const materialNormalNode = diagnosticSurfacePass
    ? diagnosticSurfacePass.getTextureNode("materialNormal")
    : null;
  const materialFootprintNode = diagnosticSurfacePass
    ? diagnosticSurfacePass.getTextureNode("materialFootprint")
    : null;
  const materialNormalVarianceNode = diagnosticSurfacePass
    ? diagnosticSurfacePass.getTextureNode("materialNormalVariance")
    : null;
  const bloomPass = bloom(emissiveNode, 0.42, 0.32, 0.85);
  bloomPass.smoothWidth.value = 0.08;
  const bloomNode = bloomPass.getTextureNode();
  const diagnosticMosaicNode = validationAttachments
    ? select(
      screenUV.y.lessThan(0.5),
      select(screenUV.x.lessThan(0.5), materialAlbedoNode, materialParamsNode),
      select(
        screenUV.x.lessThan(0.5),
        materialNormalNode,
        select(screenUV.x.lessThan(0.75), materialFootprintNode, materialNormalVarianceNode),
      ),
    )
    : null;
  const debugOutputs = {
    [SCENE_DEBUG_MODES.final]: renderOutput(sceneColor.add(bloomNode)),
    [SCENE_DEBUG_MODES.rawEmissive]: renderOutput(emissiveNode),
    [SCENE_DEBUG_MODES.bloomOnly]: renderOutput(bloomNode),
    [SCENE_DEBUG_MODES.noPost]: renderOutput(sceneColor),
    ...(validationAttachments ? {
      [SCENE_DEBUG_MODES.materialAlbedo]: renderOutput(materialAlbedoNode),
      [SCENE_DEBUG_MODES.materialParams]: renderOutput(materialParamsNode),
      [SCENE_DEBUG_MODES.materialNormal]: renderOutput(materialNormalNode),
      [SCENE_DEBUG_MODES.materialFootprint]: renderOutput(materialFootprintNode),
      [SCENE_DEBUG_MODES.materialNormalVariance]: renderOutput(materialNormalVarianceNode),
      [DIAGNOSTIC_MOSAIC_CAPTURE_MODE]: renderOutput(diagnosticMosaicNode),
    } : {}),
  };
  renderPipeline.outputNode = debugOutputs[SCENE_DEBUG_MODES.final];

  let activeTier = tier;
  let requestedDpr = pixelRatio;
  let viewport = resolveTierViewport({ width, height, requestedDpr, tier: activeTier });
  let activeScenario = "pbr-identity";
  let activeMaterialMode = debugMode;
  let activeSceneMode = SCENE_DEBUG_MODES.final;
  let activeMode = SCENE_DEBUG_MODES.final;
  let activeCamera = "design";
  let activeSeed = 1;
  let elapsedSeconds = 0;
  let historyResetCount = 0;
  let lastHistoryResetCause = "initialization";
  let disposed = false;
  let renderedFrames = 0;
  const rawCaptureCache = new Map();
  const captureTransientRecords = [];

  function assertLive() {
    if (disposed) throw new Error("Procedural PBR LabController is disposed");
  }

  function applyViewport() {
    renderer.setPixelRatio(viewport.effectiveDpr);
    renderer.setSize(viewport.width, viewport.height, false);
    scenePass.setSize(viewport.physicalWidth, viewport.physicalHeight);
    diagnosticIdentityPass?.setSize(viewport.physicalWidth, viewport.physicalHeight);
    diagnosticSurfacePass?.setSize(viewport.physicalWidth, viewport.physicalHeight);
    camera.aspect = viewport.width / viewport.height;
    camera.updateProjectionMatrix();
  }

  function resize(nextWidth, nextHeight, nextPixelRatio) {
    assertLive();
    requestedDpr = nextPixelRatio;
    viewport = resolveTierViewport({
      width: nextWidth,
      height: nextHeight,
      requestedDpr,
      tier: activeTier,
    });
    applyViewport();
    return viewport;
  }

  function setMaterialDebugMode(mode) {
    if (!proceduralPbrDebugModes.has(mode)) throw new RangeError(`Unknown material mode "${mode}"`);
    activeMaterialMode = mode;
    for (const material of pbrMaterials) setProceduralPbrDebugMode(material, mode);
  }

  function setSceneDebugMode(mode) {
    if (!Object.hasOwn(debugOutputs, mode)) throw new RangeError(`Unknown scene mode "${mode}"`);
    activeSceneMode = mode;
    if (renderPipeline.outputNode !== debugOutputs[mode]) {
      renderPipeline.outputNode = debugOutputs[mode];
      renderPipeline.needsUpdate = true;
    }
  }

  function setMode(mode) {
    assertLive();
    requireKnown(MATERIAL_MODES, mode, "mode");
    if (Object.hasOwn(debugOutputs, mode)) {
      setMaterialDebugMode("final");
      setSceneDebugMode(mode);
    } else {
      setMaterialDebugMode(mode);
      setSceneDebugMode(SCENE_DEBUG_MODES.noPost);
    }
    activeMode = mode;
  }

  function setMaterialScale(nextScale) {
    assertLive();
    if (!(Number.isFinite(nextScale) && nextScale > 0)) throw new Error("material scale must be positive");
    for (const [index, material] of pbrMaterials.entries()) {
      const state = material.userData.proceduralPbr;
      if (state?.uniforms?.coordinateScale) state.uniforms.coordinateScale.value = nextScale * (1 + index * 0.15);
    }
  }

  function setTier(nextTier) {
    assertLive();
    requireKnown(Object.keys(proceduralPbrQualityTiers), nextTier, "tier");
    assertLockedRouteMutation(routeLock, "tier", nextTier);
    activeTier = nextTier;
    const quality = proceduralPbrQualityTiers[nextTier];
    viewport = resolveTierViewport({
      width: viewport.width,
      height: viewport.height,
      requestedDpr,
      tier: activeTier,
    });
    bloomPass.setResolutionScale(quality.bloomScale);
    for (const material of pbrMaterials) {
      const state = material.userData.proceduralPbr;
      state.uniforms.normalStrength.value = quality.normalStrength;
      state.uniforms.specularVarianceScale.value = quality.varianceScale;
    }
    const shadowMapSize = nextTier === "ultra" ? 2048 : nextTier === "high" ? 1024 : 512;
    if (key.shadow.mapSize.x !== shadowMapSize) {
      key.shadow.map?.dispose();
      key.shadow.map = null;
      key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      key.shadow.needsUpdate = true;
    }
    applyViewport();
    renderPipeline.needsUpdate = true;
    return { tier: activeTier, viewport, shadowMapSize };
  }

  const scenarioModes = Object.freeze({
    "pbr-identity": { group: "identity", material: "identity", scene: "no-post" },
    "specular-aa-and-filtering": { group: "identity", material: "roughness-aa", scene: "no-post" },
    "atlas-array-and-triplanar": { group: "projection", material: "final", scene: "no-post" },
    "instanced-dissolve": { group: "dissolve", material: "dissolve", scene: "no-post" },
    "shadow-parity": { group: "dissolve", material: "dissolve", scene: "final" },
    "wet-rock-and-occlusion": { group: "wetRock", material: "final", scene: "final" },
  });

  function setScenario(id) {
    assertLive();
    requireKnown(MATERIAL_SCENARIOS, id, "scenario");
    assertLockedRouteMutation(routeLock, "mechanism", id);
    const route = scenarioModes[id];
    activeScenario = id;
    for (const [name, group] of Object.entries(fixtureGroups)) group.visible = name === route.group;
    setMaterialDebugMode(route.material);
    setSceneDebugMode(route.scene);
    key.shadow.needsUpdate = true;
    return { scenario: id, mechanismReachable: true, visibleGroup: route.group };
  }

  function setCamera(id) {
    assertLive();
    requireKnown(MATERIAL_CAMERAS, id, "camera");
    const cameraPositions = {
      near: [0, 1.55, 5.5],
      design: [0, 2.1, 7.8],
      far: [0, 3.2, 11.5],
    };
    camera.position.set(...cameraPositions[id]);
    camera.lookAt(0, 0.72, 0);
    camera.updateMatrixWorld(true);
    activeCamera = id;
    return id;
  }

  function setSeed(seed) {
    assertLive();
    if (seed !== 1 && seed !== 0x9e3779b9) throw new RangeError(`Unknown material seed "${seed}"`);
    activeSeed = seed;
    for (const [index, material] of pbrMaterials.entries()) {
      const state = material.userData.proceduralPbr;
      state.uniforms.seed.value = materialSeedPhase(seed, index);
      state.uniforms.authoredSeed = seed;
    }
    for (let index = 0; index < dissolveAttributes.variant.count; index++) {
      dissolveAttributes.variant.array[index] = hashMaterialSeed(seed, index + 0x1000) / 0xffffffff;
    }
    dissolveAttributes.variant.needsUpdate = true;
    return seed;
  }

  function setTime(seconds) {
    assertLive();
    if (!Number.isFinite(seconds)) throw new Error("time must be finite");
    elapsedSeconds = seconds;
    setLavaFlowTime(materials.lava, elapsedSeconds);
  }

  function step(deltaSeconds) {
    assertLive();
    if (!(Number.isFinite(deltaSeconds) && deltaSeconds >= 0)) throw new Error("deltaSeconds must be finite and non-negative");
    setTime(elapsedSeconds + Math.min(deltaSeconds, 0.25));
    return elapsedSeconds;
  }

  function resetHistory(cause) {
    assertLive();
    if (typeof cause !== "string" || cause.length === 0) throw new Error("history reset cause must be nonempty");
    historyResetCount += 1;
    lastHistoryResetCause = cause;
    return { reset: true, cause, temporalResources: 0 };
  }

  async function renderOnce(waitForGpu = true) {
    assertLive();
    setLavaFlowTime(materials.lava, elapsedSeconds);
    for (const [index, mesh] of swatches.entries()) mesh.rotation.y = elapsedSeconds * 0.18 + index * 0.35;
    triplanarMesh.rotation.y = elapsedSeconds * 0.22;
    renderPipeline.render();
    if (waitForGpu) await initializedRendererDevice.queue.onSubmittedWorkDone();
    renderedFrames += 1;
  }

  function rawAttachmentDescriptor(targetName) {
    if (!validationAttachments && targetName !== SCENE_DEBUG_MODES.rawEmissive) return null;
    const descriptors = {
      [SCENE_DEBUG_MODES.materialAlbedo]: {
        passId: "diagnostic-identity",
        pass: diagnosticIdentityPass,
        textureName: "materialAlbedo",
        format: "rgba8unorm",
        bytesPerComponent: 1,
        visualization: "raw-unorm-byte-identity",
      },
      [SCENE_DEBUG_MODES.materialParams]: {
        passId: "diagnostic-identity",
        pass: diagnosticIdentityPass,
        textureName: "materialParams",
        format: "rgba8unorm",
        bytesPerComponent: 1,
        visualization: "raw-unorm-byte-identity",
      },
      [SCENE_DEBUG_MODES.materialNormal]: {
        passId: "diagnostic-surface",
        pass: diagnosticSurfacePass,
        textureName: "materialNormal",
        format: "rgba8unorm",
        bytesPerComponent: 1,
        visualization: "raw-unorm-byte-identity",
      },
      [SCENE_DEBUG_MODES.materialFootprint]: {
        passId: "diagnostic-surface",
        pass: diagnosticSurfacePass,
        textureName: "materialFootprint",
        format: "rgba8unorm",
        bytesPerComponent: 1,
        visualization: "raw-unorm-byte-identity",
      },
      [SCENE_DEBUG_MODES.materialNormalVariance]: {
        passId: "diagnostic-surface",
        pass: diagnosticSurfacePass,
        textureName: "materialNormalVariance",
        format: "rgba8unorm",
        bytesPerComponent: 1,
        visualization: "raw-unorm-byte-identity",
      },
      [SCENE_DEBUG_MODES.rawEmissive]: {
        passId: "lit-scene-mrt",
        pass: scenePass,
        textureName: "emissive",
        format: "rgba16float",
        bytesPerComponent: 2,
        visualization: "half-float-reinhard-linear-to-srgb-v1",
      },
    };
    return descriptors[targetName] ?? null;
  }

  function rememberRawAttachment(targetName, descriptor, textureValue, textureIndex, pixels, layout) {
    const rawBytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice();
    rawCaptureCache.set(targetName, {
      target: targetName,
      passId: descriptor.passId,
      textureName: descriptor.textureName,
      textureUuid: textureValue.uuid,
      textureIndex,
      format: descriptor.format,
      width: layout.width,
      height: layout.height,
      componentCount: 4,
      bytesPerComponent: descriptor.bytesPerComponent,
      bytesPerPixel: descriptor.bytesPerComponent * 4,
      rowBytes: layout.rowBytes,
      bytesPerRow: layout.sourceBytesPerRow,
      byteLength: layout.sourceByteLength,
      layout: layout.sourceLayout,
      visualization: descriptor.visualization,
      rawBytes,
    });
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function getRawCaptureArtifact(targetName) {
    assertLive();
    const capture = rawCaptureCache.get(targetName);
    if (!capture) throw new Error(`No raw attachment capture exists for "${targetName}"`);
    const { rawBytes, ...metadata } = capture;
    return { ...metadata, dataBase64: bytesToBase64(rawBytes) };
  }

  function pixelCaptureRecord({ targetName, pixels, layout }) {
    return {
      target: targetName,
      width: layout.width,
      height: layout.height,
      bytesPerPixel: 4,
      rowBytes: layout.rowBytes,
      sourceBytesPerRow: layout.sourceBytesPerRow,
      sourceByteLength: layout.sourceByteLength,
      bytesPerRow: layout.requestedBytesPerRow,
      alignmentBytes: layout.requestedAlignment,
      readbackLayout: layout.sourceLayout,
      format: "rgba8unorm-srgb",
      colorManaged: true,
      outputColorSpace: "srgb",
      origin: "top-left",
      pixels,
    };
  }

  async function capturePixels(targetName = "final") {
    assertLive();
    const captureModes = validationAttachments
      ? [...MATERIAL_MODES, DIAGNOSTIC_MOSAIC_CAPTURE_MODE]
      : MATERIAL_MODES;
    requireKnown(captureModes, targetName, "capture target");
    const previousSceneMode = activeSceneMode;
    const previousMaterialMode = activeMaterialMode;
    const previousMode = activeMode;
    if (targetName === DIAGNOSTIC_MOSAIC_CAPTURE_MODE) {
      setMaterialDebugMode("final");
      setSceneDebugMode(DIAGNOSTIC_MOSAIC_CAPTURE_MODE);
      activeMode = DIAGNOSTIC_MOSAIC_CAPTURE_MODE;
    } else {
      setMode(targetName);
    }
    const captureWidth = viewport.physicalWidth;
    const captureHeight = viewport.physicalHeight;
    const previousTarget = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(null);
      await renderOnce();
      const rawDescriptor = rawAttachmentDescriptor(targetName);
      if (rawDescriptor) {
        const textures = renderTargetTextures(rawDescriptor.pass.renderTarget);
        const textureIndex = textures.findIndex((textureValue) => textureValue.name === rawDescriptor.textureName);
        if (textureIndex < 0) {
          throw new Error(`Raw attachment ${rawDescriptor.textureName} is not allocated by ${rawDescriptor.passId}`);
        }
        const textureValue = textures[textureIndex];
        const rawPixels = await renderer.readRenderTargetPixelsAsync(
          rawDescriptor.pass.renderTarget,
          0,
          0,
          captureWidth,
          captureHeight,
          textureIndex,
        );
        const rawLayout = computeRgbaReadbackLayout({
          width: captureWidth,
          height: captureHeight,
          byteLength: rawPixels.byteLength,
          bytesPerComponent: rawDescriptor.bytesPerComponent,
        });
        rememberRawAttachment(
          targetName,
          rawDescriptor,
          textureValue,
          textureIndex,
          rawPixels,
          rawLayout,
        );
        if (rawDescriptor.bytesPerComponent === 1) {
          return pixelCaptureRecord({ targetName, pixels: rawPixels, layout: rawLayout });
        }
        const rawBytes = new Uint8Array(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength);
        const visualization = visualizeHalfFloatEmissive({
          bytes: rawBytes,
          width: captureWidth,
          height: captureHeight,
          bytesPerRow: rawLayout.sourceBytesPerRow,
        });
        const visualizationLayout = computeRgba8ReadbackLayout({
          width: captureWidth,
          height: captureHeight,
          byteLength: visualization.byteLength,
        });
        return pixelCaptureRecord({ targetName, pixels: visualization, layout: visualizationLayout });
      }

      const target = new THREE.RenderTarget(captureWidth, captureHeight, {
        type: THREE.UnsignedByteType,
        depthBuffer: false,
      });
      target.texture.name = `material-capture-${targetName}`;
      const transientRecord = {
        id: `capture-transient-${captureTransientRecords.length}`,
        targetUuid: target.uuid,
        textureUuid: target.texture.uuid,
        target: targetName,
        width: captureWidth,
        height: captureHeight,
        format: "rgba8unorm-srgb",
        byteCount: captureWidth * captureHeight * 4,
        createdAtFrame: renderedFrames,
        disposedAtFrame: null,
        active: true,
      };
      captureTransientRecords.push(transientRecord);
      renderer.setRenderTarget(target);
      try {
        await renderOnce();
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, captureWidth, captureHeight);
        const layout = computeRgba8ReadbackLayout({
          width: captureWidth,
          height: captureHeight,
          byteLength: pixels.byteLength,
          bytesPerElement: pixels.BYTES_PER_ELEMENT,
        });
        return pixelCaptureRecord({ targetName, pixels, layout });
      } finally {
        target.dispose();
        transientRecord.active = false;
        transientRecord.disposedAtFrame = renderedFrames;
      }
    } finally {
      renderer.setRenderTarget(previousTarget);
      setMaterialDebugMode(previousMaterialMode);
      setSceneDebugMode(previousSceneMode);
      activeMode = previousMode;
    }
  }

  function describeResources() {
    const sceneTargets = renderTargetTextures(scenePass.renderTarget);
    const diagnosticPasses = [
      {
        id: "identity",
        pass: diagnosticIdentityPass,
        mrt: diagnosticIdentityMrt,
        budget: diagnosticIdentityAttachmentBudget,
      },
      {
        id: "surface",
        pass: diagnosticSurfacePass,
        mrt: diagnosticSurfaceMrt,
        budget: diagnosticSurfaceAttachmentBudget,
      },
    ].filter((entry) => entry.pass);
    const diagnosticTargetEntries = diagnosticPasses.flatMap((entry) => (
      renderTargetTextures(entry.pass.renderTarget).map((textureValue, index) => ({
        ...entry,
        textureValue,
        index,
      }))
    ));
    const bloomTargets = [
      bloomPass._renderTargetBright,
      ...(bloomPass._renderTargetsHorizontal ?? []),
      ...(bloomPass._renderTargetsVertical ?? []),
    ].filter(Boolean);
    const passDepthEntries = [
      { id: "scene-depth", passId: "lit-scene-mrt", pass: scenePass },
      ...diagnosticPasses.map(({ id, pass: diagnosticPass }) => ({
        id: `diagnostic-${id}-depth`,
        passId: `diagnostic-${id}`,
        pass: diagnosticPass,
      })),
    ].filter(({ pass: passValue }) => passValue.renderTarget?.depthTexture);
    const shadowColor = key.shadow.map?.texture ?? null;
    const shadowDepth = key.shadow.map?.depthTexture ?? null;
    const resources = [
      textureResource("material-color-atlas", sampledTextures.atlas, {
        byteCount: textureMipByteCount(sampledTextures.atlas),
      }),
      textureResource("material-color-array", sampledTextures.array, {
        byteCount: textureMipByteCount(sampledTextures.array),
      }),
      textureResource("material-triplanar-map", sampledTextures.triplanar, {
        byteCount: textureMipByteCount(sampledTextures.triplanar),
      }),
      ...sceneTargets.map((textureValue, index) => {
        const cost = renderTargetTextureCost(textureValue);
        const targetWidth = scenePass.renderTarget?.width ?? viewport.physicalWidth;
        const targetHeight = scenePass.renderTarget?.height ?? viewport.physicalHeight;
        return textureResource(`scene-mrt-${index}`, textureValue, {
          width: targetWidth,
          height: targetHeight,
          byteCount: targetWidth * targetHeight * cost.storageBytesPerTexel,
          attachmentFormat: cost.format,
          attachmentByteCostPerSample: cost.attachmentByteCostPerSample,
        });
      }),
      ...diagnosticTargetEntries.map(({ id, pass: diagnosticPass, textureValue, index }) => {
        const cost = renderTargetTextureCost(textureValue);
        const targetWidth = diagnosticPass.renderTarget?.width ?? viewport.physicalWidth;
        const targetHeight = diagnosticPass.renderTarget?.height ?? viewport.physicalHeight;
        return textureResource(`diagnostic-${id}-mrt-${index}`, textureValue, {
          width: targetWidth,
          height: targetHeight,
          byteCount: targetWidth * targetHeight * cost.storageBytesPerTexel,
          attachmentFormat: cost.format,
          attachmentByteCostPerSample: cost.attachmentByteCostPerSample,
        });
      }),
      ...bloomTargets.map((target, index) => textureResource(`bloom-target-${index}`, target.texture, {
        width: target.width,
        height: target.height,
        byteCount: target.width * target.height * 8,
      })),
      ...passDepthEntries.map(({ id, passId, pass: passValue }) => {
        const targetWidth = passValue.renderTarget.width;
        const targetHeight = passValue.renderTarget.height;
        return textureResource(id, passValue.renderTarget.depthTexture, {
          width: targetWidth,
          height: targetHeight,
          byteCount: targetWidth * targetHeight * 4,
          attachmentFormat: "depth24plus-or-implementation-depth",
          passId,
        });
      }),
      instancedAttributeResource("instance-dissolve", dissolveAttributes.dissolve, "visible/shadow dissolve threshold"),
      instancedAttributeResource("instance-variant", dissolveAttributes.variant, "deterministic material variant"),
    ];
    if (shadowColor) {
      const cost = renderTargetTextureCost(shadowColor);
      resources.push(textureResource("directional-shadow-color", shadowColor, {
        width: key.shadow.map.width,
        height: key.shadow.map.height,
        byteCount: key.shadow.map.width * key.shadow.map.height * cost.storageBytesPerTexel,
        attachmentFormat: cost.format,
        attachmentByteCostPerSample: cost.attachmentByteCostPerSample,
      }));
    }
    if (shadowDepth) {
      resources.push(textureResource("directional-shadow-depth", shadowDepth, {
        width: key.shadow.map.width,
        height: key.shadow.map.height,
        byteCount: key.shadow.map.width * key.shadow.map.height * 4,
        attachmentFormat: "depth24plus-or-implementation-depth",
      }));
    }
    return {
      resources,
      sampledTextureBindingModel: {
        value: 3,
        provenance: "Derived from the three live projection material resources; compiled per-stage layout remains unmeasured",
        compiledLayoutVerdict: "INSUFFICIENT_EVIDENCE",
      },
      projectionOperationModel: {
        provenance: "Derived from installed r185 projection multiplicity; generated WGSL inspection remains unmeasured",
        compiledShaderVerdict: "INSUFFICIENT_EVIDENCE",
        values: {
          atlas: projectionMaterials.atlasMaterial.userData.projectionLedger.executedSamples,
          textureArray: projectionMaterials.arrayMaterial.userData.projectionLedger.executedSamples,
          triplanar: projectionMaterials.triplanarMaterial.userData.projectionLedger.executedSamples,
        },
      },
      sceneMrtAttachments: ["output", "emissive"],
      sceneMrtAttachmentCount: sceneTargets.length || 2,
      sceneMrtRuntimeAllocated: sceneTargets.length > 0,
      sceneMrtAttachmentByteCostPerSample: productionAttachmentBudget.total,
      diagnosticMrtPasses: diagnosticPasses.map((entry) => ({
        id: entry.id,
        attachments: Object.keys(entry.mrt),
        attachmentCount: renderTargetTextures(entry.pass.renderTarget).length || 3,
        runtimeAllocated: renderTargetTextures(entry.pass.renderTarget).length > 0,
        attachmentByteCostPerSample: entry.budget.total,
      })),
      diagnosticMrtConfiguredAttachmentCount: diagnosticPasses.reduce(
        (count, entry) => count + Object.keys(entry.mrt).length,
        0,
      ),
      diagnosticMrtRuntimeAttachmentCount: diagnosticTargetEntries.length,
      diagnosticMrtRuntimeAllocated: diagnosticTargetEntries.length > 0,
      deviceMaxColorAttachmentBytesPerSample: colorAttachmentLimit,
      attachmentBudgets: {
        production: productionAttachmentBudget,
        diagnosticIdentity: diagnosticIdentityPass ? diagnosticIdentityAttachmentBudget : null,
        diagnosticSurface: diagnosticSurfacePass ? diagnosticSurfaceAttachmentBudget : null,
      },
      diagnosticPassPolicy: "each pass is reachable only from its material diagnostic outputs; the mosaic reaches both",
      bloomInternalTargetCount: bloomTargets.length,
      passDepthTargets: passDepthEntries.map(({ id, passId, pass: passValue }) => ({
        id,
        passId,
        runtimeIdentity: passValue.renderTarget.depthTexture.uuid,
        width: passValue.renderTarget.width,
        height: passValue.renderTarget.height,
      })),
      shadow: {
        enabled: renderer.shadowMap.enabled === true,
        caster: dissolveMesh.name,
        receiver: floor.name,
        light: key.name,
        mapAllocated: Boolean(shadowDepth),
        mapSize: [key.shadow.mapSize.x, key.shadow.mapSize.y],
      },
      instanceAttributeBytes: dissolveAttributes.resourceContract.bytes,
      activeStorageBindingBytes: 0,
      instanceStateAccess: dissolveAttributes.resourceContract.shaderReadPath,
      storageAllocations: [
        instancedAttributeResource("instance-dissolve", dissolveAttributes.dissolve, "visible/shadow dissolve threshold"),
        instancedAttributeResource("instance-variant", dissolveAttributes.variant, "deterministic material variant"),
      ],
      captureTransients: captureTransientRecords.map((record) => ({ ...record })),
      captureTransientSummary: {
        createdCount: captureTransientRecords.length,
        disposedCount: captureTransientRecords.filter((record) => record.active === false).length,
        activeCount: captureTransientRecords.filter((record) => record.active === true).length,
        peakByteCount: captureTransientRecords.reduce((peak, record) => Math.max(peak, record.byteCount), 0),
      },
      viewport,
      physicalResidencyVerdict: "INSUFFICIENT_EVIDENCE",
    };
  }

  function describePipeline() {
    return {
      runtimeProfile,
      timestampQueriesRequired: timestampQueriesRequested,
      timestampQueriesRequested,
      timestampQueriesActive,
      performanceTimestampMode: timestampQueriesRequested ? "auto" : "disabled",
      owners: {
        renderer: "tsl-procedural-pbr",
        renderPipeline: "tsl-procedural-pbr",
        toneMap: "renderOutput",
        outputColorTransform: "renderOutput",
        shadowMap: key.name,
        emissive: "material emissive MRT",
      },
      signals: [
        { id: "scene-color", producer: "shared scene MRT output", consumers: ["bloom composite", "renderOutput"] },
        { id: "emissive", producer: "material emissive MRT", consumers: ["BloomNode"] },
        { id: "material-footprint", producer: "filtered material field graph", consumers: ["diagnostic MRT"] },
        { id: "material-normal-variance", producer: "removed material slope energy", consumers: ["roughness AA", "diagnostic MRT"] },
        { id: "dissolve-mask", producer: "shared instance field graph", consumers: ["visible maskNode", "maskShadowNode"] },
      ],
      sceneSubmissions: [
        {
          id: "directional-shadow-casters",
          declaredPassCount: key.castShadow ? 1 : 0,
          kind: "shadow",
          provenance: "Authored pass topology",
          actualSubmissionCountVerdict: "INSUFFICIENT_EVIDENCE",
        },
        {
          id: "lit-scene-mrt",
          declaredPassCount: 1,
          kind: "full-lit-output",
          provenance: "Authored pass topology",
          actualSubmissionCountVerdict: "INSUFFICIENT_EVIDENCE",
        },
        {
          id: "material-diagnostic-mrt-passes",
          declaredPassCount: !validationAttachments
            ? 0
            : activeSceneMode === DIAGNOSTIC_MOSAIC_CAPTURE_MODE
              ? 2
              : activeSceneMode.startsWith("material-")
                ? 1
                : 0,
          kind: "diagnostic-extra-scene-pass",
          provenance: "Derived from selected output-node reachability",
          actualSubmissionCountVerdict: "INSUFFICIENT_EVIDENCE",
        },
      ],
      computeDispatches: [],
      resources: describeResources().resources,
      finalToneMapOwner: "renderOutput",
      finalOutputTransformOwner: "renderOutput",
      outputColorTransformDisabledOnPipeline: renderPipeline.outputColorTransform === false,
      activeScenario,
      activeMechanismGraph: {
        "atlas-array-and-triplanar": activeScenario === "atlas-array-and-triplanar",
        "instanced-dissolve": activeScenario === "instanced-dissolve" || activeScenario === "shadow-parity",
        "shadow-parity": activeScenario === "shadow-parity",
        "wet-rock-and-occlusion": activeScenario === "wet-rock-and-occlusion",
      },
    };
  }

  function getMetrics() {
    return {
      labId: "tsl-procedural-pbr",
      backendKind: "WebGPU",
      nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
      initialized: true,
      rendererType: "WebGPURenderer",
      rendererBackendEvidence: rendererBackendEvidence(),
      adapterIdentity,
      rendererDeviceStatus,
      rendererDeviceGeneration,
      deviceLossGeneration,
      deviceLossDetails,
      runtimeProfile,
      timestampQueriesRequired: timestampQueriesRequested,
      timestampQueriesRequested,
      timestampQueriesActive,
      performanceTimestampMode: timestampQueriesRequested ? "auto" : "disabled",
      threeRevision: THREE.REVISION,
      status: "incomplete",
      acceptance: "INSUFFICIENT_EVIDENCE",
      acceptanceBoundary: "Runtime graph is implemented; current-adapter GPU timing, visual-error, shadow-atlas readback, and lifecycle evidence are not captured.",
      renderedFrames,
      scenario: activeScenario,
      activeScenario,
      mechanism: activeScenario,
      activeMechanism: activeScenario,
      mode: activeMode,
      activeMode,
      tier: activeTier,
      activeTier,
      seed: activeSeed,
      camera: activeCamera,
      activeCamera,
      timeSeconds: elapsedSeconds,
      routeSelection: {
        scenario: activeScenario,
        mechanism: activeScenario,
        mode: activeMode,
        tier: activeTier,
      },
      state: {
        scenario: activeScenario,
        mode: activeMode,
        tier: activeTier,
        seed: activeSeed,
        timeSeconds: elapsedSeconds,
        camera: activeCamera,
        cameraPosition: camera.position.toArray(),
        viewport,
      },
      history: { resetCount: historyResetCount, lastCause: lastHistoryResetCause, temporalResources: 0 },
      lifecycle: {
        listenerCount: listenerScope.size,
        listenerScopeDisposed: listenerScope.disposed,
        captureTransientActiveCount: captureTransientRecords.filter((record) => record.active).length,
      },
      rendererInfo: {
        rendererType: "WebGPURenderer",
        backendType: "WebGPUBackend",
        backendEvidence: rendererBackendEvidence(),
        render: { ...renderer.info.render },
        memory: { ...renderer.info.memory },
      },
      claims: {
        nativeWebGPUCorrectness: "INSUFFICIENT_EVIDENCE",
        currentAdapterTiming: "INSUFFICIENT_EVIDENCE",
        shadowDissolveParity: "INSUFFICIENT_EVIDENCE",
        supersampledSpecularError: "INSUFFICIENT_EVIDENCE",
        lifecycle: "INSUFFICIENT_EVIDENCE",
      },
    };
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    disposingRenderer = true;
    renderer.setAnimationLoop(null);
    listenerScope.dispose();
    rawCaptureCache.clear();
    bloomPass.dispose();
    diagnosticIdentityPass?.dispose();
    diagnosticSurfacePass?.dispose();
    scenePass.dispose();
    renderPipeline.dispose();
    const geometries = new Set();
    const otherMaterials = new Set([floorMaterial, occluderMaterial, ...Object.values(projectionMaterials)]);
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material && !pbrMaterials.includes(object.material)) otherMaterials.add(object.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    pbrMaterials.forEach((material) => disposeProceduralPbrMaterial(material));
    otherMaterials.forEach((material) => material.dispose?.());
    Object.values(sampledTextures).forEach((textureValue) => textureValue.dispose());
    renderer.dispose();
  }

  const controller = {
    ready: async () => undefined,
    setScenario,
    setMode,
    setDebugMode: setMaterialDebugMode,
    setSceneDebugMode,
    setMaterialScale,
    setTier,
    setSeed,
    setCamera,
    setTime,
    step,
    resetHistory,
    resize,
    renderOnce,
    capturePixels,
    getRawCaptureArtifact,
    listen: (target, type, listener, options) => {
      assertLive();
      return listenerScope.listen(target, type, listener, options);
    },
    describePipeline,
    describeResources,
    getMetrics,
    dispose,
    renderer,
    renderPipeline,
    scene,
    scenePass,
    diagnosticPasses: Object.freeze({
      identity: diagnosticIdentityPass,
      surface: diagnosticSurfacePass,
    }),
    bloomPass,
    camera,
    materials,
    sampledTextures,
  };

  setCamera("design");
  setTier(tier);
  setSeed(1);
  setScenario(routeLock?.kind === "mechanism" ? routeLock.id : "pbr-identity");
  return controller;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const canvas = document.querySelector("#scene");
  const debugSelect = document.querySelector("#debug");
  const rawEmissive = document.querySelector("#raw-emissive");
  const bloomOnly = document.querySelector("#bloom-only");
  const noPost = document.querySelector("#no-post");
  const scale = document.querySelector("#scale");
  try {
    if (debugSelect) {
      for (const mode of proceduralPbrDebugModes.keys()) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = mode;
        debugSelect.append(option);
      }
    }
    const routeKind = document.documentElement.dataset.routeKind;
    const routeId = document.documentElement.dataset.routeId;
    const runtimeProfile = new URLSearchParams(window.location.search).get("profile") ?? "correctness";
    const controller = await createProceduralPbrScene({
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio,
      tier: routeKind === "tier" ? routeId : "ultra",
      runtimeProfile,
      lockedRouteKind: routeKind ?? null,
      lockedRouteId: routeId ?? null,
    });
    if (routeKind === "mechanism") controller.setScenario(routeId);
    window.labController = controller;
    window.__LAB_CONTROLLER__ = controller;
    window.__proceduralPbrLab = controller;
    window.__LAB_READY__ = controller.ready();

    function setExclusiveSceneDebugMode(activeControl, mode) {
      for (const control of [rawEmissive, bloomOnly, noPost]) {
        if (control !== activeControl) control.checked = false;
      }
      controller.setMode(activeControl.checked ? mode : SCENE_DEBUG_MODES.final);
    }

    if (debugSelect) controller.listen(debugSelect, "change", () => controller.setMode(debugSelect.value));
    if (rawEmissive) controller.listen(rawEmissive, "change", () => setExclusiveSceneDebugMode(rawEmissive, SCENE_DEBUG_MODES.rawEmissive));
    if (bloomOnly) controller.listen(bloomOnly, "change", () => setExclusiveSceneDebugMode(bloomOnly, SCENE_DEBUG_MODES.bloomOnly));
    if (noPost) controller.listen(noPost, "change", () => setExclusiveSceneDebugMode(noPost, SCENE_DEBUG_MODES.noPost));
    if (scale) controller.listen(scale, "input", () => controller.setMaterialScale(Number(scale.value)));
    controller.listen(window, "resize", () => controller.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio));
    const captureMode = new URLSearchParams(window.location.search).has("capture");
    if (!captureMode) rendererLoop(controller);
  } catch (error) {
    window.__LAB_ERROR__ = String(error?.stack ?? error);
    throw error;
  }
}

function rendererLoop(controller) {
  controller.renderer.setAnimationLoop((timeMs) => {
    controller.setTime(timeMs * 0.001);
    void controller.renderOnce(false);
  });
}
