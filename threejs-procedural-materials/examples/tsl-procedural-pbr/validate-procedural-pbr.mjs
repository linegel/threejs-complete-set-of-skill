import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BufferGeometry, Color, DataTexture, NoColorSpace, SRGBColorSpace } from "three/webgpu";

import { alignedBytesPerRow, requiredPaddedByteLength } from "../../../labs/runtime/aligned-readback.mjs";
import {
  MATERIAL_ARRAY_CONTRACT,
  MATERIAL_ATLAS_CONTRACT,
  authoredBandFilterContract,
  authoredPbrIdentities,
  createAntiqueGoldPbrMaterial,
  createAtlasArrayTriplanarMaterials,
  createAtlasTileUvNode,
  createEbonyFramePbrMaterial,
  createInstancedDissolveAttributes,
  createLavaEmissivePbrMaterial,
  createMaterialTextureArray,
  createMipSafeMaterialAtlas,
  createTriplanarMaterialTexture,
  createTriplanarProjectionNode,
  createWalnutPbrMaterial,
  createWetRockPbrMaterial,
  describeProjectionLedger,
  disposeProceduralPbrMaterial,
  disposeTextureSet,
  evaluateDissolveVisibility,
  evaluateFilteredBinaryMetalness,
  evaluateWetRockResponse,
  initializeProceduralPbrMaterialData,
  PROCEDURAL_PBR_WEBGPU_REQUIRED_MESSAGE,
  proceduralPbrDebugModes,
  proceduralPbrQualityTiers,
  resolveTierViewport,
  setProceduralPbrDebugMode,
  validateAtlasGutterContract,
  validateProceduralPbrConfig,
} from "./procedural-pbr-materials.js";
import {
  computeRgbaReadbackLayout,
  computeRgba8ReadbackLayout,
  evaluateAtlasUv,
  evaluateBandLimitSample,
  evaluateColorAttachmentBudget,
  evaluateDissolveMaskParity,
  evaluateFilteredRoughness,
  evaluateTriplanarWeights,
  hashMaterialSeed,
  materialSeedPhase,
  resolveAtlasTileTransform,
} from "./pbr-oracles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const assetRoot = resolve(here, "../../assets/generated-variants");

function readPngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "asset is not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer.readUInt8(25) };
}

function pixelAt(level, x, y) {
  const offset = (y * level.width + x) * 4;
  return Array.from(level.data.subarray(offset, offset + 4));
}

function verifyExtrudedMipGutters(texture) {
  const contract = texture.userData.materialAtlas;
  assert.equal(texture.mipmaps.length, contract.sampledMipCount);
  for (let levelIndex = 0; levelIndex < texture.mipmaps.length; levelIndex++) {
    const level = texture.mipmaps[levelIndex];
    const metadata = contract.levels[levelIndex];
    for (let tileY = 0; tileY < contract.rows; tileY++) {
      for (let tileX = 0; tileX < contract.columns; tileX++) {
        const x0 = tileX * metadata.cellWidth;
        const y0 = tileY * metadata.cellHeight;
        const minX = x0 + metadata.gutter;
        const maxX = x0 + metadata.cellWidth - metadata.gutter - 1;
        const minY = y0 + metadata.gutter;
        const maxY = y0 + metadata.cellHeight - metadata.gutter - 1;
        for (let localY = 0; localY < metadata.cellHeight; localY++) {
          for (let localX = 0; localX < metadata.cellWidth; localX++) {
            const isGutter = localX < metadata.gutter
              || localX >= metadata.cellWidth - metadata.gutter
              || localY < metadata.gutter
              || localY >= metadata.cellHeight - metadata.gutter;
            if (!isGutter) continue;
            const x = x0 + localX;
            const y = y0 + localY;
            const nearestX = Math.min(maxX, Math.max(minX, x));
            const nearestY = Math.min(maxY, Math.max(minY, y));
            assert.deepEqual(
              pixelAt(level, x, y),
              pixelAt(level, nearestX, nearestY),
              `mip ${levelIndex} tile ${tileX},${tileY} gutter is not nearest-interior extrusion`,
            );
          }
        }
      }
    }
  }
}

function validateLiveProjectionResources() {
  const atlas = createMipSafeMaterialAtlas();
  const textureArray = createMaterialTextureArray();
  const triplanarMap = createTriplanarMaterialTexture();
  try {
    assert.equal(atlas.colorSpace, SRGBColorSpace);
    assert.equal(atlas.generateMipmaps, false);
    assert.equal(atlas.image.width, MATERIAL_ATLAS_CONTRACT.width);
    verifyExtrudedMipGutters(atlas);
    assert.equal(textureArray.isDataArrayTexture, true);
    assert.equal(textureArray.image.depth, MATERIAL_ARRAY_CONTRACT.layers);
    assert.equal(textureArray.colorSpace, SRGBColorSpace);
    const layerBytes = textureArray.image.width * textureArray.image.height * 4;
    const layerHashes = new Set();
    for (let layer = 0; layer < textureArray.image.depth; layer++) {
      const bytes = textureArray.image.data.subarray(layer * layerBytes, (layer + 1) * layerBytes);
      layerHashes.add(createHash("sha256").update(bytes).digest("hex"));
    }
    assert.equal(layerHashes.size, textureArray.image.depth, "array layers must be materially distinct");
    const materials = createAtlasArrayTriplanarMaterials({ atlas, textureArray, triplanarMap });
    assert.equal(materials.atlasMaterial.userData.projectionLedger.executedSamples, 1);
    assert.equal(materials.arrayMaterial.userData.projectionLedger.executedSamples, 1);
    assert.equal(materials.triplanarMaterial.userData.projectionLedger.executedSamples, 3);
    assert.equal(materials.triplanarMaterial.userData.projectionLedger.compiledShaderEvidence, "INSUFFICIENT_EVIDENCE");
    assert.equal(materials.triplanarMaterial.userData.projectionContract.sourceTextureUuid, triplanarMap.uuid);
    assert.equal(materials.triplanarMaterial.userData.projectionContract.filteredOperations, 3);
    const projection = createTriplanarProjectionNode(triplanarMap, { scale: 0.72 });
    assert.equal(projection.node.isNode, true, "triplanar projection is not a live TSL node");
    assert.equal(projection.node.node?.isShaderCallNodeInternal, true, "triplanar projection does not reach the r185 shader call");
    assert.equal(projection.contract.compiledShaderEvidence, "INSUFFICIENT_EVIDENCE");

    for (let tileIndex = 0; tileIndex < MATERIAL_ATLAS_CONTRACT.columns * MATERIAL_ATLAS_CONTRACT.rows; tileIndex++) {
      const transform = resolveAtlasTileTransform({
        atlasWidth: MATERIAL_ATLAS_CONTRACT.width,
        atlasHeight: MATERIAL_ATLAS_CONTRACT.height,
        columns: MATERIAL_ATLAS_CONTRACT.columns,
        rows: MATERIAL_ATLAS_CONTRACT.rows,
        tileIndex,
        gutterTexels: MATERIAL_ATLAS_CONTRACT.baseGutterTexels,
      });
      const nodeTransform = createAtlasTileUvNode({
        atlasWidth: MATERIAL_ATLAS_CONTRACT.width,
        atlasHeight: MATERIAL_ATLAS_CONTRACT.height,
        columns: MATERIAL_ATLAS_CONTRACT.columns,
        rows: MATERIAL_ATLAS_CONTRACT.rows,
        tileIndex,
        gutterTexels: MATERIAL_ATLAS_CONTRACT.baseGutterTexels,
      }).transform;
      assert.deepEqual(nodeTransform, transform, "atlas node and CPU transform contracts diverged");
      const minimum = evaluateAtlasUv(transform, [0, 0]);
      const maximum = evaluateAtlasUv(transform, [1, 1]);
      assert(minimum[0] >= tileIndex % 2 * 0.5 && minimum[1] >= Math.floor(tileIndex / 2) * 0.5);
      assert(maximum[0] <= (tileIndex % 2 + 1) * 0.5 && maximum[1] <= (Math.floor(tileIndex / 2) + 1) * 0.5);
      assert.deepEqual(transform.gradientScale, transform.span, "atlas gradients must inherit tile scale");
    }
    Object.values(materials).forEach((material) => material.dispose());
    return {
      atlasMipCount: atlas.mipmaps.length,
      arrayLayers: textureArray.image.depth,
      triplanarSamples: 3,
    };
  } finally {
    atlas.dispose();
    textureArray.dispose();
    triplanarMap.dispose();
  }
}

function validateMetalnessDistribution() {
  const footprint = 0.01;
  let fractional = 0;
  let endpoints = 0;
  for (let index = 0; index <= 10_000; index++) {
    const cause = index / 10_000;
    const actual = evaluateFilteredBinaryMetalness(cause, footprint, 0.5);
    const low = 0.5 - footprint;
    const high = 0.5 + footprint;
    let expected;
    if (cause <= low) expected = 0;
    else if (cause >= high) expected = 1;
    else {
      const t = (cause - low) / (high - low);
      expected = t * t * (3 - 2 * t);
    }
    assert(Math.abs(actual - expected) <= 2e-15, `filtered metalness oracle mismatch at ${cause}`);
    if (actual === 0 || actual === 1) endpoints++;
    else fractional++;
  }
  assert(fractional / 10_001 < 0.021, "fractional metalness leaked beyond the filtered boundary");
  assert(endpoints / 10_001 > 0.979, "conductor/dielectric endpoints do not dominate the distribution");
  const gold = createAntiqueGoldPbrMaterial();
  try {
    assert.equal(gold.metalness, 0, "fallback scalar must be a physical endpoint");
    assert.equal(gold.userData.proceduralPbr.metalnessIdentity.conductorValue, 1);
    assert.equal(gold.userData.proceduralPbr.metalnessIdentity.dielectricValue, 0);
    assert.match(gold.userData.proceduralPbr.metalnessIdentity.transition, /subpixel/);
  } finally {
    gold.dispose();
  }
  return { fractionalFraction: fractional / 10_001, endpointFraction: endpoints / 10_001 };
}

function validateDissolveParity() {
  const walnut = createWalnutPbrMaterial();
  try {
    assert.strictEqual(walnut.maskNode, walnut.maskShadowNode, "visible and shadow masks must share node identity");
    assert.strictEqual(
      walnut.userData.proceduralPbr.dissolveParity.visibleMaskNode,
      walnut.userData.proceduralPbr.dissolveParity.shadowMaskNode,
    );
    const attributes = createInstancedDissolveAttributes(32, { variantSeed: 41 });
    assert.equal(attributes.dissolve.count, 32);
    assert.equal(attributes.variant.count, 32);
    assert.equal(attributes.dissolve.isStorageInstancedBufferAttribute, true);
    assert.equal(attributes.variant.isStorageInstancedBufferAttribute, true);
    assert.equal(attributes.resourceContract.storageCapable, true);
    assert.equal(attributes.resourceContract.shaderReadPath, "instanced vertex attributes");
    assert.equal(attributes.resourceContract.computeDispatches, 0);
    const geometry = attributes.attachTo(new BufferGeometry());
    assert.strictEqual(geometry.getAttribute("instanceDissolve"), attributes.dissolve);
    assert.strictEqual(geometry.getAttribute("instanceVariant"), attributes.variant);
    assert(new Set(attributes.variant.array).size > 24, "instance variants collapsed to repeated values");
    const causes = Array.from({ length: 1025 }, (_, index) => index / 1024);
    const exactParity = evaluateDissolveMaskParity({
      causeSamples: causes,
      visibleThreshold: 0.42,
      shadowThreshold: 0.42,
      footprint: 0.035,
    });
    assert.equal(exactParity.iou, 1);
    assert.equal(exactParity.mismatchCount, 0);
    const biasedShadow = evaluateDissolveMaskParity({
      causeSamples: causes,
      visibleThreshold: 0.42,
      shadowThreshold: 0.47,
      footprint: 0.035,
    });
    assert(biasedShadow.iou < 0.98, "dissolve IoU oracle cannot detect a biased shadow threshold");
    for (let index = 0; index <= 512; index++) {
      const cause = index / 512;
      const threshold = 0.42;
      const footprint = 0.035;
      const visible = evaluateDissolveVisibility(cause, threshold, footprint);
      const shadow = evaluateDissolveVisibility(cause, threshold, footprint);
      assert.equal(visible, shadow, `dissolve visible/shadow oracle diverged at ${cause}`);
      assert(visible >= 0 && visible <= 1);
    }
    geometry.dispose();
  } finally {
    walnut.dispose();
  }
  return "shared-node-storage-capable-attributes-and-iou-oracle-passed";
}

function integrateSchlickFurnace(f0, samples = 200_000) {
  let integral = 0;
  for (let index = 0; index < samples; index++) {
    const cosine = (index + 0.5) / samples;
    const fresnel = f0 + (1 - f0) * ((1 - cosine) ** 5);
    integral += 2 * cosine * fresnel;
  }
  return integral / samples;
}

function validateSchlickFresnelIntegral() {
  for (const f0 of [0.020373, 0.04, 0.36, 0.78]) {
    const numeric = integrateSchlickFurnace(f0);
    const analytic = f0 + (1 - f0) / 21;
    assert(Math.abs(numeric - analytic) < 2e-10, `Schlick Fresnel quadrature failed for F0=${f0}`);
    assert(numeric >= 0 && numeric <= 1, `Schlick Fresnel integral escaped [0,1] for F0=${f0}`);
  }
  for (const identity of Object.values(authoredPbrIdentities)) {
    const reflectance = new Color(identity.baseColor);
    assert([reflectance.r, reflectance.g, reflectance.b].every((channel) => channel >= 0 && channel <= 1));
  }
  return "schlick-fresnel-integral-only-not-node-material-furnace-acceptance";
}

function validateSpecularFilterOracle() {
  const supportMultiplier = 2;
  const surfacePixelSpan = 0.01;
  const heightHalfAmplitude = 0.0004;
  const slopeVarianceCalibration = 1.25;
  let previousKeep = 1;
  for (let index = 0; index <= 100; index++) {
    const coordinateFootprint = index * 0.003;
    const sample = evaluateBandLimitSample({
      coordinateFootprint,
      surfacePixelSpan,
      heightHalfAmplitude,
      supportMultiplier,
      slopeVarianceCalibration,
    });
    assert(Number.isFinite(sample.removedSlopeVariance) && sample.removedSlopeVariance >= 0);
    assert(sample.keep <= previousKeep + 1e-15, "band retention must be monotone with footprint");
    previousKeep = sample.keep;
  }
  const retained = evaluateBandLimitSample({
    coordinateFootprint: 0.05,
    surfacePixelSpan,
    heightHalfAmplitude,
    supportMultiplier,
    slopeVarianceCalibration,
  });
  assert.equal(retained.keep, 1);
  assert.equal(retained.removedSlopeVariance, 0);
  const removed = evaluateBandLimitSample({
    coordinateFootprint: 0.25,
    surfacePixelSpan,
    heightHalfAmplitude,
    supportMultiplier,
    slopeVarianceCalibration,
  });
  assert.equal(removed.keep, 0);
  assert(removed.removedSlopeVariance > 0);
  const roughness = evaluateFilteredRoughness({
    roughness: 0.28,
    normalVariance: removed.removedSlopeVariance,
    specularVarianceScale: 1,
  });
  assert(roughness >= 0.28 && roughness <= 1);
  assert(Math.abs(roughness - Math.min(1, Math.sqrt(0.28 ** 2 + removed.removedSlopeVariance))) < 1e-15);
  return { retained, removed, filteredRoughness: roughness };
}

function validateTriplanarWeightOracle() {
  for (const normal of [[1, 0, 0], [-1, 0, 0], [1, 1, 1], [0.2, -0.6, 0.4]]) {
    const weights = evaluateTriplanarWeights(normal);
    assert(weights.every((weight) => weight >= 0 && weight <= 1));
    assert(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-15);
  }
  assert.deepEqual(evaluateTriplanarWeights([1, 0, 0]), [1, 0, 0]);
  assert.deepEqual(evaluateTriplanarWeights([-1, 0, 0]), [1, 0, 0]);
  assert.throws(() => evaluateTriplanarWeights([0, 0, 0]), /non-zero/);
  return "nonnegative-l1-normalized-axis-invariant-weights";
}

function validateAttachmentBudgetOracle() {
  const production = evaluateColorAttachmentBudget({
    formats: ["rgba16float", "rgba16float"],
    limit: 32,
  });
  const diagnosticIdentity = evaluateColorAttachmentBudget({
    formats: ["rgba16float", "rgba8unorm", "rgba8unorm"],
    limit: 32,
  });
  const diagnosticSurface = evaluateColorAttachmentBudget({
    formats: ["rgba16float", "rgba8unorm", "rgba8unorm", "rgba8unorm"],
    limit: 32,
  });
  const invalidCombined = evaluateColorAttachmentBudget({
    formats: [
      "rgba16float", "rgba16float",
      "rgba8unorm", "rgba8unorm", "rgba8unorm", "rgba8unorm",
    ],
    limit: 32,
  });
  assert.equal(production.total, 16);
  assert.equal(production.passes, true);
  assert.equal(diagnosticIdentity.total, 24);
  assert.equal(diagnosticIdentity.passes, true);
  assert.equal(diagnosticSurface.total, 32);
  assert.equal(diagnosticSurface.passes, true);
  assert.equal(invalidCombined.total, 48);
  assert.equal(invalidCombined.passes, false);
  assert.deepEqual(
    diagnosticSurface.entries.map(({ pixelByteCost, componentAlignment }) => ({ pixelByteCost, componentAlignment })),
    [
      { pixelByteCost: 8, componentAlignment: 2 },
      { pixelByteCost: 8, componentAlignment: 1 },
      { pixelByteCost: 8, componentAlignment: 1 },
      { pixelByteCost: 8, componentAlignment: 1 },
    ],
  );
  return { production, diagnosticIdentity, diagnosticSurface, invalidCombined };
}

function validateWetnessCoherence() {
  let previous = evaluateWetRockResponse(0);
  for (let index = 1; index <= 100; index++) {
    const current = evaluateWetRockResponse(index / 100);
    assert(current.colorScale < previous.colorScale, "wet rock color must darken monotonically");
    assert(current.roughness < previous.roughness, "wet rock roughness must decrease monotonically");
    assert(current.clearcoat > previous.clearcoat, "wet rock film response must increase monotonically");
    assert(current.clearcoatRoughness < previous.clearcoatRoughness, "wet rock film roughness must decrease monotonically");
    assert(current.normalStrength < previous.normalStrength, "wet rock micro-normal strength must attenuate monotonically");
    previous = current;
  }
  const wetRock = createWetRockPbrMaterial();
  try {
    assert.deepEqual(
      wetRock.userData.proceduralPbr.wetnessCause.coupledChannels,
      ["color", "roughness", "clearcoat", "normal"],
    );
    assert.equal(wetRock.userData.proceduralPbr.wetnessCause.ambientAndEmissionUnaffectedByProjectedOcclusion, true);
    assert.match(wetRock.userData.proceduralPbr.wetnessCause.directLightOcclusionOwner, /directional-light/);
    assert.equal(wetRock.isMeshPhysicalNodeMaterial, true);
    assert.equal(wetRock.lights, true);
    assert.equal(wetRock.aoNode, null, "wetness must not inject ambient occlusion");
    assert.equal(wetRock.emissiveNode, null, "wet rock must remain non-emissive");
  } finally {
    wetRock.dispose();
  }
  return { dry: evaluateWetRockResponse(0), wet: evaluateWetRockResponse(1) };
}

function validateTierViewportPolicy() {
  const expected = { ultra: 2, high: 1.5, mobile: 1 };
  for (const [tier, cap] of Object.entries(expected)) {
    const view = resolveTierViewport({ width: 641, height: 359, requestedDpr: 3, tier });
    assert.equal(view.effectiveDpr, cap);
    assert.equal(view.requestedDpr, 3, "tier cap must not erase the requested DPR");
    assert.equal(view.physicalWidth, Math.round(641 * cap));
    assert.equal(view.physicalHeight, Math.round(359 * cap));
    const resized = resolveTierViewport({ width: 1200, height: 800, requestedDpr: view.requestedDpr, tier });
    assert.equal(resized.effectiveDpr, cap, "resize bypassed locked tier DPR cap");
  }
  assert.throws(() => resolveTierViewport({ width: 1, height: 1, requestedDpr: 1, tier: "invented" }), /Unknown/);
  const stride = alignedBytesPerRow(641, 4);
  assert.equal(stride, 2816);
  assert.equal(requiredPaddedByteLength(641, 359, 4, stride), stride * 358 + 641 * 4);
  const compact = computeRgba8ReadbackLayout({
    width: 641,
    height: 359,
    byteLength: 641 * 4 * 359,
  });
  assert.equal(compact.rowBytes, 641 * 4);
  assert.equal(compact.sourceBytesPerRow, 641 * 4);
  assert.equal(compact.requestedBytesPerRow, stride);
  assert.equal(compact.sourceLayout, "compact");
  const padded = computeRgba8ReadbackLayout({
    width: 641,
    height: 359,
    byteLength: requiredPaddedByteLength(641, 359, 4, stride),
  });
  assert.equal(padded.sourceBytesPerRow, stride);
  assert.equal(padded.sourceLayout, "aligned-padded");
  assert.throws(() => computeRgba8ReadbackLayout({
    width: 641,
    height: 359,
    byteLength: 641 * 4 * 359 + 3,
  }), /unrecognized/);
  const halfStride = alignedBytesPerRow(641, 8);
  const half = computeRgbaReadbackLayout({
    width: 641,
    height: 359,
    byteLength: halfStride * 358 + 641 * 8,
    bytesPerComponent: 2,
  });
  assert.equal(half.sourceBytesPerRow, halfStride);
  assert.equal(half.rowBytes, 641 * 8);
  return { dprCaps: expected, oddReadbackStride: stride, compactReadbackStride: compact.sourceBytesPerRow };
}

function validateSeedMapping() {
  const seeds = [1, 0x9e3779b9];
  const phases = seeds.map((seed) => Array.from({ length: 8 }, (_, stream) => materialSeedPhase(seed, stream)));
  assert(phases.flat().every((phase) => phase >= 0 && phase < 64));
  assert.notDeepEqual(phases[0], phases[1], "fixed seeds collapsed to the same bounded phases");
  for (const seed of seeds) {
    const first = Array.from({ length: 16 }, (_, stream) => hashMaterialSeed(seed, stream));
    const second = Array.from({ length: 16 }, (_, stream) => hashMaterialSeed(seed, stream));
    assert.deepEqual(first, second, "uint32 seed hashing is nondeterministic");
    assert.equal(new Set(first).size, first.length, "seed streams collided in the fixed fixture");
  }
  return { seeds, maximumPhase: Math.max(...phases.flat()) };
}

function validateMaterialGraphs() {
  const materials = {
    walnut: createWalnutPbrMaterial(),
    gold: createAntiqueGoldPbrMaterial(),
    ebony: createEbonyFramePbrMaterial(),
    lava: createLavaEmissivePbrMaterial(),
    wetRock: createWetRockPbrMaterial(),
  };
  try {
    for (const [name, material] of Object.entries(materials)) {
      for (const slot of ["colorNode", "roughnessNode", "metalnessNode", "normalNode", "maskNode", "maskShadowNode", "mrtNode"]) {
      assert(material[slot], `${name} missing live ${slot}`);
      }
      assert.equal(material.mrtNode.isMRTNode, true, `${name} does not expose a real MRT node`);
      assert.deepEqual(
        Object.keys(material.mrtNode.outputNodes),
        ["materialAlbedo", "materialParams", "materialNormal", "materialFootprint", "materialNormalVariance"],
        `${name} diagnostic MRT schema drifted`,
      );
      const diagnosticNodes = Object.values(material.mrtNode.outputNodes);
      assert(diagnosticNodes.every((node) => node?.isNode === true), `${name} diagnostic MRT contains a non-node output`);
      assert.equal(
        new Set(diagnosticNodes.map((node) => node.getCacheKey())).size,
        diagnosticNodes.length,
        `${name} diagnostic MRT aliases semantic outputs`,
      );
      assert.equal(material.userData.proceduralPbr.normalVarianceSource, "footprint-removed-material-slope-energy");
      assert.equal(material.userData.proceduralPbr.geometryRoughnessOwner, "three-r185-getRoughness");
      for (const mode of proceduralPbrDebugModes.keys()) {
        const version = material.version;
        assert(setProceduralPbrDebugMode(material, mode));
        assert.equal(material.version, version, `${name} uniform-only debug mode forced a pipeline recompile`);
      }
    }
    assert(materials.lava.emissiveNode, "lava must publish authored scene-linear emission");
    for (const [name, material] of Object.entries(materials)) {
      if (name !== "lava") assert.equal(material.emissiveNode, null, `${name} has unauthored emission`);
    }
    assert(materials.walnut.color.equals(new Color(0x5a2814)), "walnut base color was double converted");
  } finally {
    Object.values(materials).forEach((material) => material.dispose());
  }
  return Object.keys(materials);
}

function validateConfigFailures() {
  const badColorSpaceMap = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  badColorSpaceMap.colorSpace = SRGBColorSpace;
  for (const fixture of [
    { roughnessRange: [0.8, 0.2] },
    { coordinateScale: 0 },
    { coordinateMode: "camera" },
    { seed: Number.NaN },
    { debugMode: "invented" },
    { normalStrength: -0.1 },
    { emissionIntensity: -1 },
    { sceneUnitsPerMeter: 0 },
    { specularVarianceScale: -1 },
    { identity: { ...authoredPbrIdentities.walnut, metalnessRange: [0.1, 0.9] } },
    { causeMaps: [badColorSpaceMap] },
  ]) assert.throws(() => validateProceduralPbrConfig(fixture), /Invalid procedural PBR config/);
  badColorSpaceMap.dispose();
  const map = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  map.colorSpace = NoColorSpace;
  assert(validateProceduralPbrConfig({ causeMaps: [map], emissionIntensity: 4 }).pass);
  map.dispose();
  assert.throws(() => validateAtlasGutterContract({
    atlasWidth: 1024,
    atlasHeight: 1024,
    columns: 4,
    rows: 4,
    guttersByMip: [1, 1],
    filterRadiusByMip: [2.2, 1.1],
  }), /below required support/);
  assert.throws(() => createInstancedDissolveAttributes(0), /positive integer/);
  assert.throws(() => createInstancedDissolveAttributes(4, { initialDissolve: 1.1 }), /inside \[0,1\]/);
  assert.throws(() => createInstancedDissolveAttributes(4, { variantSeed: -1 }), /uint32/);
  assert.throws(() => createWalnutPbrMaterial({ debugMode: "invented" }), /Invalid procedural PBR config/);
  assert.throws(() => createWetRockPbrMaterial({ waterlineWorldY: Number.NaN }), /waterlineWorldY/);
  assert.throws(() => createLavaEmissivePbrMaterial({ flowTime: Number.NaN }), /flowTime/);

  const atlas = createMipSafeMaterialAtlas();
  const textureArray = createMaterialTextureArray();
  const triplanarMap = createTriplanarMaterialTexture();
  try {
    triplanarMap.colorSpace = NoColorSpace;
    assert.throws(
      () => createAtlasArrayTriplanarMaterials({ atlas, textureArray, triplanarMap }),
      /must declare SRGBColorSpace/,
    );
  } finally {
    atlas.dispose();
    textureArray.dispose();
    triplanarMap.dispose();
  }
  return "invalid-configs-rejected";
}

function validateIdentities() {
  assert.equal(authoredPbrIdentities.walnut.metalnessModel, "dielectric-endpoint");
  assert.equal(authoredPbrIdentities.ebony.metalnessModel, "dielectric-endpoint");
  assert.equal(authoredPbrIdentities.wetRock.metalnessModel, "dielectric-endpoint");
  assert.equal(authoredPbrIdentities.antiqueGold.metalnessModel, "filtered-binary-conductor-mask");
  assert.deepEqual(Object.keys(proceduralPbrQualityTiers), ["ultra", "high", "mobile"]);
  assert.equal(authoredBandFilterContract.qFade[1], 0.5);
  const ledger = describeProjectionLedger({ projection: "triplanar", colorTextures: 1, dataTextures: 1, normalTextures: 1 });
  assert.equal(ledger.sampledTextureBindings, 3);
  assert.equal(ledger.executedSamples, 9);
  return "identity-endpoints-and-ledger-passed";
}

async function validateCapabilityGate() {
  let computeCalls = 0;
  let restored = null;
  const accepted = await initializeProceduralPbrMaterialData({
    backend: { isWebGPUBackend: true },
    getRenderTarget: () => "previous",
    setRenderTarget: (value) => { restored = value; },
    init: async () => undefined,
    compute: (nodes) => { computeCalls = nodes.length; },
  }, { computeNodes: ["cause-map", "instance-state"] });
  assert.equal(accepted.computeNodeCount, 2);
  assert.equal(computeCalls, 2);
  assert.equal(restored, "previous");
  await assert.rejects(() => initializeProceduralPbrMaterialData({
    backend: { isWebGPUBackend: false },
    getRenderTarget: () => null,
    setRenderTarget: () => undefined,
    init: async () => undefined,
    compute: () => assert.fail("non-WebGPU compute must not dispatch"),
  }), new RegExp(PROCEDURAL_PBR_WEBGPU_REQUIRED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return "native-backend-gate-passed";
}

async function validateAssets() {
  const manifest = JSON.parse(await readFile(resolve(assetRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.colorSpace, "NoColorSpace");
  for (const asset of manifest.assets) {
    const buffer = await readFile(resolve(assetRoot, asset.file));
    const hash = createHash("sha256").update(buffer).digest("hex");
    const size = readPngSize(buffer);
    assert.equal(hash, asset.sha256, `${asset.file} hash mismatch`);
    assert.equal(size.width, asset.width);
    assert.equal(size.height, asset.height);
    assert.equal(size.colorType, 6);
    assert.equal(asset.colorSpace, "NoColorSpace");
  }
  return manifest.assets.map((asset) => asset.file);
}

function validateDisposal() {
  const material = createWalnutPbrMaterial();
  let calls = 0;
  material.dispose = () => { calls++; };
  assert(disposeProceduralPbrMaterial(material));
  assert(!disposeProceduralPbrMaterial(material));
  assert.equal(calls, 1);
  let disposedTextures = 0;
  const textureSet = { a: { dispose: () => { disposedTextures++; } }, b: null };
  assert.equal(disposeTextureSet(textureSet), 1);
  assert.equal(disposeTextureSet(textureSet), 0);
  assert.equal(disposedTextures, 1);
  return "idempotent-disposal-passed";
}

const result = {
  materialGraphs: validateMaterialGraphs(),
  identities: validateIdentities(),
  projectionResources: validateLiveProjectionResources(),
  metalness: validateMetalnessDistribution(),
  dissolveParity: validateDissolveParity(),
  fresnelIntegral: validateSchlickFresnelIntegral(),
  specularFilterOracle: validateSpecularFilterOracle(),
  triplanarWeightOracle: validateTriplanarWeightOracle(),
  attachmentBudgetOracle: validateAttachmentBudgetOracle(),
  wetness: validateWetnessCoherence(),
  tierViewport: validateTierViewportPolicy(),
  seedMapping: validateSeedMapping(),
  invalidConfigs: validateConfigFailures(),
  capabilityGate: await validateCapabilityGate(),
  assets: await validateAssets(),
  disposal: validateDisposal(),
};

console.log(JSON.stringify({ pass: true, status: "incomplete", ...result }, null, 2));
