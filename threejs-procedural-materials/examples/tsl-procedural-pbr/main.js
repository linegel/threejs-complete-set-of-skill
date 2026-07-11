import * as THREE from "three/webgpu";
import {
  color,
  emissive,
  float,
  mrt,
  output,
  pass,
  renderOutput,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import { alignedBytesPerRow } from "../../../labs/runtime/aligned-readback.mjs";
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

function textureResource(id, texture, overrides = {}) {
  const image = texture?.image ?? {};
  return {
    id,
    kind: texture?.isDepthTexture ? "depth-texture" : texture?.isDataArrayTexture ? "texture-array" : "texture",
    name: texture?.name ?? id,
    width: image.width ?? overrides.width ?? null,
    height: image.height ?? overrides.height ?? null,
    layers: image.depth ?? overrides.layers ?? 1,
    mipLevels: texture?.mipmaps?.length || (texture?.generateMipmaps ? "generated-full-chain" : 1),
    colorSpace: texture?.colorSpace ?? null,
    format: texture?.format ?? null,
    type: texture?.type ?? null,
    byteCount: overrides.byteCount ?? null,
    byteCountProvenance: overrides.byteCount === null || overrides.byteCount === undefined ? "INSUFFICIENT_EVIDENCE" : "Derived",
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
} = {}) {
  requireKnown(Object.keys(proceduralPbrQualityTiers), tier, "tier");
  if (!proceduralPbrDebugModes.has(debugMode)) throw new RangeError(`Unknown material mode "${debugMode}"`);

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    outputBufferType: THREE.HalfFloatType,
  });
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("threejs-procedural-materials requires native WebGPU.");
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
  const validationMrt = {
    output,
    emissive,
    materialAlbedo: vec4(0),
    materialParams: vec4(0),
    materialNormal: vec4(0),
    materialFootprint: vec4(0),
    materialNormalVariance: vec4(0),
  };
  scenePass.setMRT(mrt(validationAttachments ? validationMrt : { output, emissive }));
  scenePass.setResolutionScale(1);

  const sceneColor = scenePass.getTextureNode("output");
  const emissiveNode = scenePass.getTextureNode("emissive");
  const bloomPass = bloom(emissiveNode, 0.42, 0.32, 0.85);
  bloomPass.smoothWidth.value = 0.08;
  const bloomNode = bloomPass.getTextureNode();
  const debugOutputs = {
    [SCENE_DEBUG_MODES.final]: renderOutput(sceneColor.add(bloomNode)),
    [SCENE_DEBUG_MODES.rawEmissive]: renderOutput(emissiveNode),
    [SCENE_DEBUG_MODES.bloomOnly]: renderOutput(bloomNode),
    [SCENE_DEBUG_MODES.noPost]: renderOutput(sceneColor),
    ...(validationAttachments ? {
      [SCENE_DEBUG_MODES.materialAlbedo]: renderOutput(scenePass.getTextureNode("materialAlbedo")),
      [SCENE_DEBUG_MODES.materialParams]: renderOutput(scenePass.getTextureNode("materialParams")),
      [SCENE_DEBUG_MODES.materialNormal]: renderOutput(scenePass.getTextureNode("materialNormal")),
      [SCENE_DEBUG_MODES.materialFootprint]: renderOutput(scenePass.getTextureNode("materialFootprint")),
      [SCENE_DEBUG_MODES.materialNormalVariance]: renderOutput(scenePass.getTextureNode("materialNormalVariance")),
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

  function assertLive() {
    if (disposed) throw new Error("Procedural PBR LabController is disposed");
  }

  function applyViewport() {
    renderer.setPixelRatio(viewport.effectiveDpr);
    renderer.setSize(viewport.width, viewport.height, false);
    scenePass.setSize(viewport.physicalWidth, viewport.physicalHeight);
    bloomPass.setSize(viewport.physicalWidth, viewport.physicalHeight);
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
    renderPipeline.outputNode = debugOutputs[mode];
    renderPipeline.needsUpdate = true;
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
      material.userData.proceduralPbr.uniforms.seed.value = (seed + index * 101) >>> 0;
    }
    for (let index = 0; index < dissolveAttributes.variant.count; index++) {
      dissolveAttributes.variant.array[index] = (((index + 1) * 1103515245 + seed * 12345) >>> 0) / 4294967295;
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

  function renderOnce() {
    assertLive();
    setLavaFlowTime(materials.lava, elapsedSeconds);
    for (const [index, mesh] of swatches.entries()) mesh.rotation.y = elapsedSeconds * 0.18 + index * 0.35;
    triplanarMesh.rotation.y = elapsedSeconds * 0.22;
    renderPipeline.render();
    renderedFrames += 1;
  }

  async function capturePixels(targetName = "final") {
    assertLive();
    requireKnown(MATERIAL_MODES, targetName, "capture target");
    const previousSceneMode = activeSceneMode;
    const previousMaterialMode = activeMaterialMode;
    const previousMode = activeMode;
    setMode(targetName);
    const captureWidth = viewport.physicalWidth;
    const captureHeight = viewport.physicalHeight;
    const target = new THREE.RenderTarget(captureWidth, captureHeight, {
      type: THREE.UnsignedByteType,
      depthBuffer: false,
    });
    target.texture.name = `material-capture-${targetName}`;
    const previousTarget = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      renderOnce();
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, captureWidth, captureHeight);
      const bytesPerPixel = 4;
      const bytesPerRow = alignedBytesPerRow(captureWidth, bytesPerPixel);
      const logicalBytesPerRow = captureWidth * bytesPerPixel;
      const validLengths = new Set([
        bytesPerRow * captureHeight,
        bytesPerRow * (captureHeight - 1) + logicalBytesPerRow,
      ]);
      if (!validLengths.has(pixels.byteLength)) {
        throw new Error(`Unexpected WebGPU readback length ${pixels.byteLength}; expected padded 256-byte rows`);
      }
      return {
        target: targetName,
        width: captureWidth,
        height: captureHeight,
        bytesPerPixel,
        bytesPerRow,
        pixels,
      };
    } finally {
      renderer.setRenderTarget(previousTarget);
      target.dispose();
      setMaterialDebugMode(previousMaterialMode);
      setSceneDebugMode(previousSceneMode);
      activeMode = previousMode;
    }
  }

  function describeResources() {
    const sceneTargets = renderTargetTextures(scenePass.renderTarget);
    const bloomTargets = [
      bloomPass._renderTargetBright,
      ...(bloomPass._renderTargetsHorizontal ?? []),
      ...(bloomPass._renderTargetsVertical ?? []),
    ].filter(Boolean);
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
      ...sceneTargets.map((textureValue, index) => textureResource(`scene-mrt-${index}`, textureValue, {
        width: scenePass.renderTarget?.width ?? viewport.physicalWidth,
        height: scenePass.renderTarget?.height ?? viewport.physicalHeight,
        byteCount: (scenePass.renderTarget?.width ?? viewport.physicalWidth)
          * (scenePass.renderTarget?.height ?? viewport.physicalHeight) * 8,
      })),
      ...bloomTargets.map((target, index) => textureResource(`bloom-target-${index}`, target.texture, {
        width: target.width,
        height: target.height,
        byteCount: target.width * target.height * 8,
      })),
    ];
    if (shadowDepth) {
      resources.push(textureResource("directional-shadow-depth", shadowDepth, {
        width: key.shadow.map.width,
        height: key.shadow.map.height,
        byteCount: key.shadow.map.width * key.shadow.map.height * 4,
      }));
    }
    return {
      resources,
      sampledTextureBindings: 3,
      projectionSampleOperations: {
        atlas: projectionMaterials.atlasMaterial.userData.projectionLedger.executedSamples,
        textureArray: projectionMaterials.arrayMaterial.userData.projectionLedger.executedSamples,
        triplanar: projectionMaterials.triplanarMaterial.userData.projectionLedger.executedSamples,
      },
      sceneMrtAttachments: validationAttachments ? Object.keys(validationMrt) : ["output", "emissive"],
      sceneMrtAttachmentCount: sceneTargets.length || (validationAttachments ? 7 : 2),
      sceneMrtRuntimeAllocated: sceneTargets.length > 0,
      bloomInternalTargetCount: bloomTargets.length,
      shadow: {
        enabled: renderer.shadowMap.enabled === true,
        caster: dissolveMesh.name,
        receiver: floor.name,
        light: key.name,
        mapAllocated: Boolean(shadowDepth),
        mapSize: [key.shadow.mapSize.x, key.shadow.mapSize.y],
      },
      instanceStorageBytes: dissolveAttributes.dissolve.array.byteLength + dissolveAttributes.variant.array.byteLength,
      viewport,
      physicalResidencyVerdict: "INSUFFICIENT_EVIDENCE",
    };
  }

  function describePipeline() {
    return {
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
        { id: "directional-shadow-casters", count: key.castShadow ? 1 : 0, kind: "shadow" },
        { id: "lit-scene-mrt", count: 1, kind: "full-lit-output" },
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
      backend: {
        name: "WebGPU",
        isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
      },
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
      rendererInfo: {
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
    renderer.setAnimationLoop(null);
    bloomPass.dispose();
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
    describePipeline,
    describeResources,
    getMetrics,
    dispose,
    renderer,
    renderPipeline,
    scene,
    scenePass,
    bloomPass,
    camera,
    materials,
    sampledTextures,
  };

  setCamera("design");
  setTier(tier);
  setSeed(1);
  setScenario("pbr-identity");
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
    const controller = await createProceduralPbrScene({
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio,
      tier: routeKind === "tier" ? routeId : "ultra",
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

    debugSelect?.addEventListener("change", () => controller.setMode(debugSelect.value));
    rawEmissive?.addEventListener("change", () => setExclusiveSceneDebugMode(rawEmissive, SCENE_DEBUG_MODES.rawEmissive));
    bloomOnly?.addEventListener("change", () => setExclusiveSceneDebugMode(bloomOnly, SCENE_DEBUG_MODES.bloomOnly));
    noPost?.addEventListener("change", () => setExclusiveSceneDebugMode(noPost, SCENE_DEBUG_MODES.noPost));
    scale?.addEventListener("input", () => controller.setMaterialScale(Number(scale.value)));
    window.addEventListener("resize", () => controller.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio));
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
    controller.renderOnce();
  });
}
