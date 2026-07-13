import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  Sphere,
  Vector3,
} from "three/webgpu";
import {
  abs,
  atan,
  attribute,
  clamp,
  color,
  cos,
  float,
  max,
  mix,
  normalize,
  select,
  sin,
  smoothstep,
  uint,
  uniform,
  vec3,
} from "three/tsl";

import { BODY_PRESETS, createPlanetConfig } from "./planet-config.js";
import { planetFieldNodes } from "./planet-fields.js";
import { PLANET_TIER_CONFIG } from "./planet-tiers.js";
import {
  annotateNeighborLevels,
  balanceQuadtree,
  createVertexMorphStencil,
  createRootPatches,
  createTransitionIndexVariant,
  patchSurfaceDirection,
  selectPlanetQuadtreeFrontier,
  splitPatch,
  transitionMask,
} from "./planet-quadtree.js";

export const PLANET_DEBUG_MODES = Object.freeze([
  "final",
  "height",
  "patch-level",
  "transition-mask",
  "derivative-candidate",
  "field-crater-climate",
  "craters",
  "climate",
]);

export const PLANET_BODY_MODES = Object.freeze([
  "solid",
  "gas-giant",
  "ice-giant",
]);

const BODY_MODE_INDEX = Object.freeze(Object.fromEntries(
  PLANET_BODY_MODES.map((mode, index) => [mode, index]),
));
const DEBUG_MODE_INDEX = Object.freeze(Object.fromEntries(
  PLANET_DEBUG_MODES.map((mode, index) => [mode, index]),
));

export { PLANET_TIER_CONFIG } from "./planet-tiers.js";

function replaceWithChildren(patches, patch) {
  return [...patches.filter((candidate) => candidate.id !== patch.id), ...splitPatch(patch)];
}

/** Deterministic nonuniform frontier retained only for legacy CPU fixtures. */
export function createPlanetFixtureFrontier(refinement = 2) {
  let patches = createRootPatches();
  if (refinement >= 1) {
    patches = replaceWithChildren(patches, patches.find((patch) => patch.face === 4));
  }
  if (refinement >= 2) {
    const target = patches.find((patch) => patch.face === 4 && patch.level === 1 && patch.x === 0 && patch.y === 0);
    patches = replaceWithChildren(patches, target);
  }
  if (refinement >= 3) {
    const target = patches.find((patch) => patch.face === 4 && patch.level === 2 && patch.x === 1 && patch.y === 1);
    patches = replaceWithChildren(patches, target);
  }
  return annotateNeighborLevels(balanceQuadtree(patches));
}

export function createPlanetPatchGeometry({
  patches,
  gridSide = 17,
  atlas = null,
  radiusWorld = 1,
  maximumDisplacementWorld = 0,
} = {}) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("planet patch geometry requires a nonempty patch frontier");
  }
  if (!Number.isInteger(gridSide) || gridSide < 3 ||
      !Number.isInteger(Math.log2(gridSide - 1))) {
    throw new Error("planet patch gridSide must be 2^k+1");
  }
  if (atlas && atlas.tileSide !== gridSide) {
    throw new Error("planet patch geometry and field atlas must use the same core grid side");
  }

  annotateNeighborLevels(patches);
  const verticesPerPatch = gridSide * gridSide;
  const vertexCount = verticesPerPatch * patches.length;
  const directions = new Float32Array(vertexCount * 3);
  const levels = new Float32Array(vertexCount);
  const masks = new Float32Array(vertexCount);
  const atlasIndices = new Uint32Array(vertexCount);
  const mipIndices = new Uint32Array(vertexCount);
  const morphIndices = Array.from({ length: 4 }, () => new Uint32Array(vertexCount));
  const morphDirections = Array.from({ length: 4 }, () => new Float32Array(vertexCount * 3));
  const morphWeights = new Float32Array(vertexCount * 4);
  const morphFactors = new Float32Array(vertexCount);
  const indices = [];

  let vertexOffset = 0;
  for (let patchIndex = 0; patchIndex < patches.length; patchIndex += 1) {
    const patch = patches[patchIndex];
    const mask = transitionMask(patch);
    for (let y = 0; y < gridSide; y += 1) {
      for (let x = 0; x < gridSide; x += 1) {
        const localIndex = y * gridSide + x;
        const vertexIndex = vertexOffset + localIndex;
        const direction = patchSurfaceDirection(
          patch,
          x / (gridSide - 1),
          y / (gridSide - 1),
        );
        const lane = vertexIndex * 3;
        directions[lane + 0] = direction[0];
        directions[lane + 1] = direction[1];
        directions[lane + 2] = direction[2];
        levels[vertexIndex] = patch.level;
        masks[vertexIndex] = mask;
        atlasIndices[vertexIndex] = atlas?.indexFor(patchIndex, x, y, 0) ?? 0;
        mipIndices[vertexIndex] = atlas?.indexFor(
          patchIndex,
          x,
          y,
          Math.min(1, (atlas?.levels.length ?? 1) - 1),
        ) ?? 0;

        const stencil = createVertexMorphStencil({ x, y, gridSide, patch });
        morphFactors[vertexIndex] = Math.max(patch.lodMorph ?? 0, stencil.transitionWeight);
        for (let corner = 0; corner < 4; corner += 1) {
          const [sampleX, sampleY] = stencil.coordinates[corner];
          const sampleDirection = patchSurfaceDirection(
            patch,
            sampleX / (gridSide - 1),
            sampleY / (gridSide - 1),
          );
          morphIndices[corner][vertexIndex] =
            atlas?.indexFor(patchIndex, sampleX, sampleY, 0) ?? 0;
          const directionLane = vertexIndex * 3;
          morphDirections[corner][directionLane + 0] = sampleDirection[0];
          morphDirections[corner][directionLane + 1] = sampleDirection[1];
          morphDirections[corner][directionLane + 2] = sampleDirection[2];
          morphWeights[vertexIndex * 4 + corner] = stencil.weights[corner];
        }
      }
    }
    // Morphing puts odd fine-edge vertices on the coarse chord. Standard
    // topology can therefore retain every fine triangle without a T-junction
    // crack or the degenerate "collapse-to-previous" approximation.
    const patchIndices = createTransitionIndexVariant(gridSide, 0);
    const groupStart = indices.length;
    for (const index of patchIndices) indices.push(vertexOffset + index);
    patch.drawRange = Object.freeze({ start: groupStart, count: patchIndices.length });
    vertexOffset += verticesPerPatch;
  }

  const IndexType = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const geometry = new BufferGeometry();
  // WebGPU requires ≤8 vertex buffers (spec minimum). Separate BufferAttributes
  // become one GPU vertex buffer each; packing every float attribute into a
  // single InterleavedBuffer keeps the render pipeline valid while preserving
  // named TSL attribute() bindings. Indices that were Uint32 are stored as
  // float (exact for the atlas index domain ≪ 2^24) and cast with uint() in TSL.
  //
  // Layout per vertex (28 floats):
  //   0..2   position / surfaceDirection (identical unit vector)
  //   3      patchLevel
  //   4      transitionMask
  //   5      atlasIndex
  //   6      atlasMipIndex
  //   7..10  morphWeights
  //   11     morphFactor
  //   12..15 morphIndex0..3
  //   16..18 morphDirection0
  //   19..21 morphDirection1
  //   22..24 morphDirection2
  //   25..27 morphDirection3
  const stride = 28;
  const packed = new Float32Array(vertexCount * stride);
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const base = vertexIndex * stride;
    const dirLane = vertexIndex * 3;
    packed[base + 0] = directions[dirLane + 0];
    packed[base + 1] = directions[dirLane + 1];
    packed[base + 2] = directions[dirLane + 2];
    packed[base + 3] = levels[vertexIndex];
    packed[base + 4] = masks[vertexIndex];
    packed[base + 5] = atlasIndices[vertexIndex];
    packed[base + 6] = mipIndices[vertexIndex];
    packed[base + 7] = morphWeights[vertexIndex * 4 + 0];
    packed[base + 8] = morphWeights[vertexIndex * 4 + 1];
    packed[base + 9] = morphWeights[vertexIndex * 4 + 2];
    packed[base + 10] = morphWeights[vertexIndex * 4 + 3];
    packed[base + 11] = morphFactors[vertexIndex];
    packed[base + 12] = morphIndices[0][vertexIndex];
    packed[base + 13] = morphIndices[1][vertexIndex];
    packed[base + 14] = morphIndices[2][vertexIndex];
    packed[base + 15] = morphIndices[3][vertexIndex];
    for (let corner = 0; corner < 4; corner += 1) {
      const dest = base + 16 + corner * 3;
      packed[dest + 0] = morphDirections[corner][dirLane + 0];
      packed[dest + 1] = morphDirections[corner][dirLane + 1];
      packed[dest + 2] = morphDirections[corner][dirLane + 2];
    }
  }
  const interleaved = new InterleavedBuffer(packed, stride);
  // Base position and canonical surface direction are the same unit vector.
  // positionNode applies the single metric displacement on the GPU.
  geometry.setAttribute("position", new InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.setAttribute("surfaceDirection", new InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.setAttribute("patchLevel", new InterleavedBufferAttribute(interleaved, 1, 3));
  geometry.setAttribute("transitionMask", new InterleavedBufferAttribute(interleaved, 1, 4));
  geometry.setAttribute("atlasIndex", new InterleavedBufferAttribute(interleaved, 1, 5));
  geometry.setAttribute("atlasMipIndex", new InterleavedBufferAttribute(interleaved, 1, 6));
  geometry.setAttribute("morphWeights", new InterleavedBufferAttribute(interleaved, 4, 7));
  geometry.setAttribute("morphFactor", new InterleavedBufferAttribute(interleaved, 1, 11));
  for (let corner = 0; corner < 4; corner += 1) {
    geometry.setAttribute(
      `morphIndex${corner}`,
      new InterleavedBufferAttribute(interleaved, 1, 12 + corner),
    );
    geometry.setAttribute(
      `morphDirection${corner}`,
      new InterleavedBufferAttribute(interleaved, 3, 16 + corner * 3),
    );
  }
  geometry.setIndex(new BufferAttribute(new IndexType(indices), 1));
  for (let patchIndex = 0; patchIndex < patches.length; patchIndex += 1) {
    const range = patches[patchIndex].drawRange;
    geometry.addGroup(range.start, range.count, patchIndex);
  }
  geometry.boundingSphere = new Sphere(
    new Vector3(0, 0, 0),
    radiusWorld + maximumDisplacementWorld,
  );
  geometry.userData.planetPatchContract = {
    patchCount: patches.length,
    gridSide,
    vertexCount,
    triangleCount: indices.length / 3,
    drawCount: patches.length,
    groupCount: geometry.groups.length,
    submission: "one indexed draw group per selected leaf patch",
    atlasConsumed: Boolean(atlas),
    morphing: "bilinear next-coarser stencil; transition edges force morph=1",
    maximumScreenError: Math.max(...patches.map((patch) => patch.screenError ?? 0)),
    transitionMasks: [...new Set(patches.map(transitionMask))].sort((a, b) => a - b),
  };
  return geometry;
}

function createSolidColor(fields) {
  const ocean = smoothstep(0.001, 0.08, fields.oceanDepth);
  const coast = smoothstep(0.0, 0.08, abs(fields.height));
  const dry = mix(color(0x7b633f), color(0x9a8250), fields.arid);
  const temperate = mix(color(0x294e2a), dry, fields.arid);
  const rock = mix(temperate, color(0x77746b), fields.rock);
  const snow = mix(rock, color(0xdde7e9), fields.snow);
  const land = mix(snow, color(0xbda56e), coast.mul(0.16));
  const water = mix(color(0x061e38), color(0x167a9e), clamp(fields.humidity, 0, 1));
  return mix(land, water, ocean);
}

function createGasColor(direction, timeNode, ice = false) {
  // Longitude enters only through sin/cos of the advected phase; the branch is
  // continuous at -pi/pi and therefore has no authored longitude seam.
  const longitude = atan(direction.z, direction.x);
  const latitude = direction.y;
  const jet = mix(0.025, 0.12, float(1).sub(abs(latitude)));
  const phase = longitude.add(timeNode.mul(jet));
  const band = sin(latitude.mul(62).add(sin(phase.mul(3)).mul(2.2))).mul(0.5).add(0.5);
  const storm = cos(phase.mul(5).add(latitude.mul(13))).mul(0.5).add(0.5);
  if (ice) {
    return mix(color(0x274d73), color(0x8ed6dd), band.mul(0.82).add(storm.mul(0.18)));
  }
  return mix(color(0x7f4f31), color(0xe1c285), band.mul(0.78).add(storm.mul(0.22)));
}

export function sampleGasBandCPU(direction, timeSeconds = 0) {
  const longitude = Math.atan2(direction[2], direction[0]);
  const latitude = direction[1];
  const jet = 0.025 + (0.12 - 0.025) * (1 - Math.abs(latitude));
  const phase = longitude + timeSeconds * jet;
  const band = Math.sin(latitude * 62 + Math.sin(phase * 3) * 2.2) * 0.5 + 0.5;
  const storm = Math.cos(phase * 5 + latitude * 13) * 0.5 + 0.5;
  return band * 0.78 + storm * 0.22;
}

export function createPlanetNodeMaterial({
  config = createPlanetConfig(),
  physical = false,
  atlas = null,
} = {}) {
  const material = physical
    ? new MeshPhysicalNodeMaterial()
    : new MeshStandardNodeMaterial();
  const radiusRenderUnits = config.radiusKm * 1000 / config.metresPerRenderUnit;
  const uniforms = {
    seed: atlas?.uniforms.seed ?? uniform(config.seed),
    rocky: atlas?.uniforms.rocky ?? uniform(config.preset.kind === "rocky" ? 1 : 0),
    seaLevel: atlas?.uniforms.seaLevel ?? uniform(config.preset.seaLevel),
    humidityBias: atlas?.uniforms.humidityBias ?? uniform(config.preset.humidityBias),
    temperatureBias: atlas?.uniforms.temperatureBias ?? uniform(config.preset.temperatureBias),
    radius: uniform(radiusRenderUnits),
    amplitude: uniform(radiusRenderUnits * config.preset.terrainAmplitudeRadiusFraction),
    bodyMode: uniform(BODY_MODE_INDEX.solid),
    debugMode: uniform(DEBUG_MODE_INDEX.final),
    time: uniform(0),
  };
  const direction = normalize(attribute("surfaceDirection", "vec3"));
  // Atlas indices ride the interleaved float vertex buffer (WebGPU ≤8 VBs);
  // cast to uint for storage-buffer addressing (domain is well inside f32 exact ints).
  const atlasIndex = uint(attribute("atlasIndex", "float"));
  const mipIndex = uint(attribute("atlasMipIndex", "float"));
  const directFields = atlas ? null : planetFieldNodes({
      direction,
      seed: uniforms.seed,
      rocky: uniforms.rocky,
      seaLevel: uniforms.seaLevel,
      humidityBias: uniforms.humidityBias,
      temperatureBias: uniforms.temperatureBias,
    });
  const fields = atlas?.sampleNodes(atlasIndex, 0) ?? directFields;
  const filteredFields = atlas?.sampleNodes(
    mipIndex,
    Math.min(1, (atlas?.levels.length ?? 1) - 1),
  ) ?? fields;
  const materialFields = atlas ? {
    ...fields,
    humidity: filteredFields.humidity,
    temperature: filteredFields.temperature,
    roughnessCause: filteredFields.roughnessCause,
    snow: filteredFields.snow,
    arid: smoothstep(
      0.46,
      0.78,
      float(1).sub(filteredFields.humidity)
        .mul(filteredFields.temperature)
        .sub(fields.height.mul(0.08)),
    ),
    rock: smoothstep(
      0.08,
      0.3,
      filteredFields.ruggednessProxy.add(max(fields.height, 0).mul(0.28)),
    ),
  } : fields;
  const displacedRadius = uniforms.radius.add(fields.height.mul(uniforms.amplitude));
  const displaced = direction.mul(displacedRadius);
  const roundBody = direction.mul(uniforms.radius);
  let solidPosition = displaced;
  let roundPosition = roundBody;
  let shadingDirection = direction;
  if (atlas) {
    const weights = attribute("morphWeights", "vec4");
    const morphAmount = clamp(attribute("morphFactor", "float"), 0, 1);
    const morphDirections = Array.from({ length: 4 }, (_, corner) =>
      attribute(`morphDirection${corner}`, "vec3"));
    const morphHeights = Array.from({ length: 4 }, (_, corner) =>
      atlas.sampleHeightNode(uint(attribute(`morphIndex${corner}`, "float")), 0));
    const solidCorners = morphDirections.map((cornerDirection, corner) =>
      cornerDirection.mul(uniforms.radius.add(morphHeights[corner].mul(uniforms.amplitude))));
    const roundCorners = morphDirections.map((cornerDirection) =>
      cornerDirection.mul(uniforms.radius));
    const coarseSolid = solidCorners[0].mul(weights.x)
      .add(solidCorners[1].mul(weights.y))
      .add(solidCorners[2].mul(weights.z))
      .add(solidCorners[3].mul(weights.w));
    const coarseRound = roundCorners[0].mul(weights.x)
      .add(roundCorners[1].mul(weights.y))
      .add(roundCorners[2].mul(weights.z))
      .add(roundCorners[3].mul(weights.w));
    solidPosition = mix(displaced, coarseSolid, morphAmount);
    roundPosition = mix(roundBody, coarseRound, morphAmount);
    shadingDirection = normalize(mix(direction, normalize(coarseRound), morphAmount));
  }
  material.positionNode = select(
    uniforms.bodyMode.equal(BODY_MODE_INDEX.solid),
    solidPosition,
    roundPosition,
  );

  // The bundled fused derivative is intentionally candidate-only: it has not
  // passed an independent derivative oracle. Keep the preview on the reference
  // radial normal instead of laundering CPU/TSL agreement into a normal claim.
  material.normalNode = select(
    uniforms.bodyMode.equal(BODY_MODE_INDEX.solid),
    shadingDirection,
    shadingDirection,
  );

  const solidColor = createSolidColor(materialFields);
  const gasColor = createGasColor(shadingDirection, uniforms.time, false);
  const iceColor = createGasColor(shadingDirection, uniforms.time, true);
  const bodyColor = select(
    uniforms.bodyMode.equal(BODY_MODE_INDEX["gas-giant"]),
    gasColor,
    select(uniforms.bodyMode.equal(BODY_MODE_INDEX["ice-giant"]), iceColor, solidColor),
  );
  const derivativeCandidateMagnitude = atlas
    ? clamp(abs(fields.height.sub(filteredFields.height)).mul(12), 0, 1)
    : clamp(
        abs(fields.heightDerivativeCandidateX)
          .add(abs(fields.heightDerivativeCandidateY))
          .mul(0.3),
        0,
        1,
      );
  const level = attribute("patchLevel", "float").div(6);
  const mask = attribute("transitionMask", "float").div(15);
  const debugColor = select(
    uniforms.debugMode.equal(DEBUG_MODE_INDEX.height),
    mix(color(0x123567), color(0xf4d78c), fields.height.mul(0.5).add(0.5)),
    select(
      uniforms.debugMode.equal(DEBUG_MODE_INDEX["patch-level"]),
      vec3(level, float(1).sub(level), level.mul(0.4).add(0.1)),
      select(
        uniforms.debugMode.equal(DEBUG_MODE_INDEX["transition-mask"]),
        vec3(mask, mask.mul(0.37), float(1).sub(mask)),
        select(
          uniforms.debugMode.equal(DEBUG_MODE_INDEX["derivative-candidate"]),
          vec3(
            derivativeCandidateMagnitude,
            float(0.1),
            float(1).sub(derivativeCandidateMagnitude),
          ),
          select(
            uniforms.debugMode.equal(DEBUG_MODE_INDEX.craters),
            vec3(fields.craterFloor, fields.craterRim, fields.ejectaStrength),
            select(
              uniforms.debugMode.equal(DEBUG_MODE_INDEX["field-crater-climate"]),
              vec3(
                clamp(fields.craterFloor.add(fields.craterRim), 0, 1),
                materialFields.humidity,
                materialFields.temperature,
              ),
              vec3(materialFields.humidity, materialFields.temperature, materialFields.snow),
            ),
          ),
        ),
      ),
    ),
  );
  material.colorNode = select(uniforms.debugMode.equal(DEBUG_MODE_INDEX.final), bodyColor, debugColor);
  material.roughnessNode = select(
    uniforms.bodyMode.equal(BODY_MODE_INDEX.solid),
    mix(0.48, 0.94, materialFields.roughnessCause),
    float(0.78),
  );
  material.metalnessNode = float(0);
  material.emissiveNode = vec3(0);
  material.userData.planetUniforms = uniforms;
  material.userData.fieldOwner = atlas ? "planet-field-atlas-storage" : "planetFieldNodes-direct";
  material.userData.fieldAtlasConsumed = Boolean(atlas);
  material.userData.fieldAtlasResources = atlas
    ? atlas.levels.flatMap((level) => level.buffers.map((buffer) => buffer.name))
    : [];
  material.userData.normalEvidence =
    "reference radial normal only; height derivative candidate is diagnostic and not accepted";
  material.userData.outputOwner = "host RenderPipeline";
  return material;
}

export function createPlanetRuntimeConfiguration({
  tier = "balanced",
  preset = "pelagia",
  seed = 31.731,
  worldUnitsPerMeter = 0.001,
} = {}) {
  const tierConfig = PLANET_TIER_CONFIG[tier];
  if (!tierConfig) throw new Error(`unknown planet tier "${tier}"`);
  if (!BODY_PRESETS[preset]) throw new Error(`unknown planet preset "${preset}"`);
  if (!(worldUnitsPerMeter > 0) || !Number.isFinite(worldUnitsPerMeter)) {
    throw new Error("worldUnitsPerMeter must be finite and positive");
  }
  const config = createPlanetConfig({
    preset,
    seed,
    trial: tier === "full" ? "full-detail" : tier === "balanced" ? "budgeted" : "minimum-resident",
    metresPerRenderUnit: 1 / worldUnitsPerMeter,
  });
  const radiusWorld = config.radiusKm * 1000 * worldUnitsPerMeter;
  const maximumDisplacementWorld =
    radiusWorld * config.preset.terrainAmplitudeRadiusFraction;
  return Object.freeze({
    tier,
    tierConfig,
    preset,
    seed,
    worldUnitsPerMeter,
    config,
    radiusWorld,
    maximumDisplacementWorld,
  });
}

export function createPlanetRuntimeFrontier({
  tier = "balanced",
  preset = "pelagia",
  seed = 31.731,
  worldUnitsPerMeter = 0.001,
  cameraPositionBody = [17000, 9500, 22000],
  verticalFovRadians = 42 * Math.PI / 180,
  renderTargetHeightPx = 800,
  cameraNear = 10,
  maxLeafPatches = 32768,
} = {}) {
  const runtime = createPlanetRuntimeConfiguration({ tier, preset, seed, worldUnitsPerMeter });
  const { tierConfig } = runtime;
  const patches = selectPlanetQuadtreeFrontier({
    cameraPositionBody,
    verticalFovRadians,
    renderTargetHeightPx,
    cameraNear,
    radiusWorld: runtime.radiusWorld,
    maximumDisplacementWorld: runtime.maximumDisplacementWorld,
    maximumSurfaceSlope: tierConfig.maximumSurfaceSlope,
    gridSide: tierConfig.gridSide,
    splitThreshold: tierConfig.splitPixelError,
    mergeThreshold: tierConfig.mergePixelError,
    minLevel: tierConfig.minLevel,
    maxLevel: tierConfig.maxLevel,
    maxLeafPatches,
  });
  return { ...runtime, patches };
}

export function createPlanetPatchMesh({
  tier = "balanced",
  preset = "pelagia",
  seed = 31.731,
  worldUnitsPerMeter = 0.001,
  patches = null,
  atlas = null,
  cameraPositionBody = [17000, 9500, 22000],
  verticalFovRadians = 42 * Math.PI / 180,
  renderTargetHeightPx = 800,
  cameraNear = 10,
} = {}) {
  const runtime = createPlanetRuntimeConfiguration({ tier, preset, seed, worldUnitsPerMeter });
  const resolvedPatches = patches ?? createPlanetRuntimeFrontier({
    tier,
    preset,
    seed,
    worldUnitsPerMeter,
    cameraPositionBody,
    verticalFovRadians,
    renderTargetHeightPx,
    cameraNear,
  }).patches;
  if (atlas && (atlas.patches.length !== resolvedPatches.length ||
      atlas.patches.some((patch, index) => patch.id !== resolvedPatches[index].id))) {
    throw new Error("planet mesh and field atlas must address the same ordered patch frontier");
  }
  const geometry = createPlanetPatchGeometry({
    patches: resolvedPatches,
    gridSide: runtime.tierConfig.gridSide,
    atlas,
    radiusWorld: runtime.radiusWorld,
    maximumDisplacementWorld: runtime.maximumDisplacementWorld,
  });
  const material = createPlanetNodeMaterial({ config: runtime.config, atlas });
  // BufferGeometry groups are actual leaf submissions. Repeating the same
  // immutable material reference avoids one material graph per patch while
  // retaining independent indexed draw ranges for diagnostics and culling.
  const materials = resolvedPatches.map(() => material);
  const mesh = new Mesh(geometry, materials);
  mesh.name = `webgpu-quadtree-planet-${tier}`;
  mesh.frustumCulled = true;
  mesh.userData.patches = resolvedPatches;
  mesh.userData.config = runtime.config;
  mesh.userData.primaryMaterial = material;
  mesh.userData.atlas = atlas;
  mesh.userData.tier = tier;
  mesh.userData.worldUnitsPerMeter = worldUnitsPerMeter;
  mesh.userData.radiusWorld = runtime.radiusWorld;
  mesh.userData.maximumDisplacementWorld = runtime.maximumDisplacementWorld;
  mesh.userData.resources = {
    vertexBytes: Object.values(geometry.attributes)
      .reduce((sum, attributeValue) => sum + attributeValue.array.byteLength, 0),
    indexBytes: geometry.index.array.byteLength,
    drawCount: resolvedPatches.length,
    groupCount: geometry.groups.length,
    materialGraphCount: 1,
    fieldAtlasBytes: atlas?.byteLength ?? 0,
  };
  return mesh;
}

export function setPlanetMaterialMode(mesh, { mode, bodyMode, time } = {}) {
  const material = mesh.userData.primaryMaterial ??
    (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
  const uniforms = material?.userData?.planetUniforms;
  if (!uniforms) throw new Error("mesh does not expose planet material uniforms");
  if (mode !== undefined) {
    if (!(mode in DEBUG_MODE_INDEX)) throw new Error(`unknown planet debug mode "${mode}"`);
    uniforms.debugMode.value = DEBUG_MODE_INDEX[mode];
  }
  if (bodyMode !== undefined) {
    if (!(bodyMode in BODY_MODE_INDEX)) throw new Error(`unknown planet body mode "${bodyMode}"`);
    uniforms.bodyMode.value = BODY_MODE_INDEX[bodyMode];
  }
  if (time !== undefined) uniforms.time.value = time;
}

export function disposePlanetPatchMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of new Set(materials)) material?.dispose();
}
