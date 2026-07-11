import { StorageBufferAttribute } from "three/webgpu";
import {
  Fn,
  instanceIndex,
  storage,
  uint,
  uniform,
  vec4,
} from "three/tsl";

import { deriveTileGutterTexels } from "./patch-compute.js";
import { BODY_PRESETS } from "./planet-config.js";
import { normalize, planetFieldNodes } from "./planet-fields.js";

const DEFAULT_TILE_SIDE = 17;
const WORKGROUP_SIZE = 64;
const FIELD_CHANNELS = Object.freeze([
  Object.freeze(["height", "macroHeight", "ridge", "oceanDepth"]),
  Object.freeze(["humidity", "temperature", "ruggednessProxy", "roughnessCause"]),
  Object.freeze(["craterFloor", "craterRim", "ejectaStrength", "snow"]),
]);

function assertPowerOfTwoPlusOne(value, label) {
  if (!Number.isInteger(value) || value < 3 ||
      !Number.isInteger(Math.log2(value - 1))) {
    throw new Error(`${label} must be 2^k+1 and at least 3`);
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function extendedPatchDirection(patch, localU, localV) {
  const { minU, minV, maxU, maxV } = patch.uvRect;
  const unitU = minU + (maxU - minU) * localU;
  const unitV = minV + (maxV - minV) * localV;
  const u = unitU * 2 - 1;
  const v = unitV * 2 - 1;
  const { origin, u: uAxis, v: vAxis } = patch.faceAxes;
  return normalize([
    origin[0] + uAxis[0] * u + vAxis[0] * v,
    origin[1] + uAxis[1] * u + vAxis[1] * v,
    origin[2] + uAxis[2] * u + vAxis[2] * v,
  ]);
}

function makeMipLayouts(tileSide, baseGutter) {
  const layouts = [];
  let coreSide = tileSide;
  let gutter = baseGutter;
  let level = 0;
  while (true) {
    const storageSide = coreSide + gutter * 2;
    layouts.push(Object.freeze({
      level,
      coreSide,
      gutter,
      storageSide,
      texelsPerPatch: storageSide * storageSide,
    }));
    if (coreSide <= 3) break;
    coreSide = (coreSide - 1) / 2 + 1;
    gutter = Math.max(1, Math.ceil(gutter / 2));
    level += 1;
  }
  return Object.freeze(layouts);
}

function makeDirectionArray(patches, layout) {
  const array = new Float32Array(patches.length * layout.texelsPerPatch * 4);
  for (let patchIndex = 0; patchIndex < patches.length; patchIndex += 1) {
    const patch = patches[patchIndex];
    for (let y = 0; y < layout.storageSide; y += 1) {
      for (let x = 0; x < layout.storageSide; x += 1) {
        const localU = (x - layout.gutter) / (layout.coreSide - 1);
        const localV = (y - layout.gutter) / (layout.coreSide - 1);
        const direction = extendedPatchDirection(patch, localU, localV);
        const texel = patchIndex * layout.texelsPerPatch + y * layout.storageSide + x;
        const lane = texel * 4;
        array[lane + 0] = direction[0];
        array[lane + 1] = direction[1];
        array[lane + 2] = direction[2];
        array[lane + 3] = patchIndex;
      }
    }
  }
  return array;
}

function makeMipMappingArray(patches, previous, output) {
  const array = new Uint32Array(patches.length * output.texelsPerPatch * 4);
  for (let patchIndex = 0; patchIndex < patches.length; patchIndex += 1) {
    const previousBase = patchIndex * previous.texelsPerPatch;
    const outputBase = patchIndex * output.texelsPerPatch;
    for (let y = 0; y < output.storageSide; y += 1) {
      for (let x = 0; x < output.storageSide; x += 1) {
        const u = (x - output.gutter) / (output.coreSide - 1);
        const v = (y - output.gutter) / (output.coreSide - 1);
        const sourceX = previous.gutter + u * (previous.coreSide - 1);
        const sourceY = previous.gutter + v * (previous.coreSide - 1);
        const x0 = clamp(Math.floor(sourceX), 0, previous.storageSide - 1);
        const x1 = clamp(x0 + 1, 0, previous.storageSide - 1);
        const y0 = clamp(Math.floor(sourceY), 0, previous.storageSide - 1);
        const y1 = clamp(y0 + 1, 0, previous.storageSide - 1);
        const outputTexel = outputBase + y * output.storageSide + x;
        const lane = outputTexel * 4;
        array[lane + 0] = previousBase + y0 * previous.storageSide + x0;
        array[lane + 1] = previousBase + y0 * previous.storageSide + x1;
        array[lane + 2] = previousBase + y1 * previous.storageSide + x0;
        array[lane + 3] = previousBase + y1 * previous.storageSide + x1;
      }
    }
  }
  return array;
}

function resolvePatchIndices(patches, patchIds) {
  if (patchIds == null) return patches.map((_, index) => index);
  if (!Array.isArray(patchIds) || patchIds.length === 0) {
    throw new Error("dirty patch ids must be a nonempty array or null for every patch");
  }
  const byId = new Map(patches.map((patch, index) => [patch.id, index]));
  const unique = new Set();
  for (const patchId of patchIds) {
    if (!byId.has(patchId)) throw new Error(`unknown dirty planet patch "${patchId}"`);
    unique.add(byId.get(patchId));
  }
  return [...unique].sort((a, b) => a - b);
}

function createBakeComputeNode({
  channel,
  dirtyCount,
  dirtyNode,
  directions,
  output,
  baseLayout,
  uniforms,
}) {
  const workItemCount = dirtyCount * baseLayout.texelsPerPatch;
  const kernel = Fn(() => {
    const dirtySlot = uint(instanceIndex).div(uint(baseLayout.texelsPerPatch));
    const localTexel = uint(instanceIndex).mod(uint(baseLayout.texelsPerPatch));
    const patchIndex = dirtyNode.element(dirtySlot);
    const atlasIndex = patchIndex.mul(uint(baseLayout.texelsPerPatch)).add(localTexel);
    const direction = directions.element(atlasIndex).xyz;
    const fields = planetFieldNodes({
      direction,
      seed: uniforms.seed,
      rocky: uniforms.rocky,
      seaLevel: uniforms.seaLevel,
      humidityBias: uniforms.humidityBias,
      temperatureBias: uniforms.temperatureBias,
    });
    const packed = channel === 0
      ? vec4(fields.height, fields.macroHeight, fields.ridge, fields.oceanDepth)
      : channel === 1
        ? vec4(fields.humidity, fields.temperature, fields.ruggednessProxy, fields.roughnessCause)
        : vec4(fields.craterFloor, fields.craterRim, fields.ejectaStrength, fields.snow);
    output.element(atlasIndex).assign(packed);
  });
  return kernel().compute(workItemCount, [WORKGROUP_SIZE])
    .setName(`planet:field-atlas-bake-channel-${channel}`);
}

function createMipComputeNode({
  channel,
  level,
  dirtyCount,
  dirtyNode,
  mappingNode,
  source,
  destination,
  outputLayout,
}) {
  const workItemCount = dirtyCount * outputLayout.texelsPerPatch;
  const kernel = Fn(() => {
    const dirtySlot = uint(instanceIndex).div(uint(outputLayout.texelsPerPatch));
    const localTexel = uint(instanceIndex).mod(uint(outputLayout.texelsPerPatch));
    const patchIndex = dirtyNode.element(dirtySlot);
    const outputIndex = patchIndex.mul(uint(outputLayout.texelsPerPatch)).add(localTexel);
    const sourceIndices = mappingNode.element(outputIndex);
    const average = source.element(sourceIndices.x)
      .add(source.element(sourceIndices.y))
      .add(source.element(sourceIndices.z))
      .add(source.element(sourceIndices.w))
      .mul(0.25);
    destination.element(outputIndex).assign(average);
  });
  return kernel().compute(workItemCount, [WORKGROUP_SIZE])
    .setName(`planet:field-atlas-mip-${level}-channel-${channel}`);
}

/**
 * Per-patch storage atlas with explicit derived gutters, patch-local mip
 * chains, and dirty-patch dispatch. The base and first mip are sampled by the
 * live NodeMaterial; the remaining mips stay resident for tier/diagnostic use.
 */
export function createPlanetFieldAtlas({
  patches,
  preset = BODY_PRESETS.pelagia,
  seed = 31.731,
  tileSide = DEFAULT_TILE_SIDE,
  gutterSupport = {
    maximumWarpDisplacementTexels: 0.75,
    reconstructionFilterRadiusTexels: 1,
    derivativeStencilRadiusTexels: 1.5,
    maximumProjectedFootprintRadiusTexels: 2.4,
  },
} = {}) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("planet field atlas requires a nonempty patch array");
  }
  assertPowerOfTwoPlusOne(tileSide, "planet field atlas tileSide");
  const gutter = deriveTileGutterTexels(gutterSupport);
  const layouts = makeMipLayouts(tileSide, gutter);
  const baseLayout = layouts[0];
  const directionArray = makeDirectionArray(patches, baseLayout);
  const directionBuffer = new StorageBufferAttribute(directionArray, 4);
  directionBuffer.name = "PlanetFieldAtlasDirectionsWithGutters";
  const directions = storage(directionBuffer, "vec4", directionArray.length / 4).toReadOnly();
  const dirtyArray = new Uint32Array(patches.length);
  const dirtyBuffer = new StorageBufferAttribute(dirtyArray, 1);
  dirtyBuffer.name = "PlanetFieldAtlasDirtyPatchIndices";
  const dirtyNode = storage(dirtyBuffer, "uint", patches.length).toReadOnly();

  const levels = layouts.map((layout) => {
    const buffers = FIELD_CHANNELS.map((_, channel) => {
      const buffer = new StorageBufferAttribute(
        patches.length * layout.texelsPerPatch,
        4,
        Float32Array,
      );
      buffer.name = `PlanetFieldAtlasL${layout.level}Channel${channel}`;
      return buffer;
    });
    const nodes = buffers.map((buffer) =>
      storage(buffer, "vec4", patches.length * layout.texelsPerPatch));
    return { ...layout, buffers, nodes, mappingBuffer: null, mappingNode: null };
  });

  for (let level = 1; level < levels.length; level += 1) {
    const mappingArray = makeMipMappingArray(patches, levels[level - 1], levels[level]);
    const mappingBuffer = new StorageBufferAttribute(mappingArray, 4);
    mappingBuffer.name = `PlanetFieldAtlasMip${level}SourceIndices`;
    levels[level].mappingBuffer = mappingBuffer;
    levels[level].mappingNode = storage(
      mappingBuffer,
      "uvec4",
      mappingArray.length / 4,
    ).toReadOnly();
  }

  const uniforms = {
    seed: uniform(seed),
    rocky: uniform(preset.kind === "rocky" ? 1 : 0),
    seaLevel: uniform(preset.seaLevel),
    humidityBias: uniform(preset.humidityBias),
    temperatureBias: uniform(preset.temperatureBias),
  };
  let version = 0;
  let disposed = false;
  let pendingDirty = new Set(patches.map((patch) => patch.id));
  const dispatches = [];

  function indexFor(patchIndex, x, y, level = 0) {
    if (!Number.isInteger(patchIndex) || patchIndex < 0 || patchIndex >= patches.length) {
      throw new Error("atlas patchIndex is out of range");
    }
    const layout = levels[level];
    if (!layout) throw new Error(`unknown planet atlas mip level ${level}`);
    if (!Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || y < 0 || x >= tileSide || y >= tileSide) {
      throw new Error("atlas core coordinates must address the base tile");
    }
    const levelX = Math.round(x * (layout.coreSide - 1) / (tileSide - 1));
    const levelY = Math.round(y * (layout.coreSide - 1) / (tileSide - 1));
    return patchIndex * layout.texelsPerPatch +
      (levelY + layout.gutter) * layout.storageSide + levelX + layout.gutter;
  }

  function sampleNodes(indexNode, level = 0) {
    const atlasLevel = levels[level];
    if (!atlasLevel) throw new Error(`unknown planet atlas mip level ${level}`);
    const field0 = atlasLevel.nodes[0].element(indexNode);
    const field1 = atlasLevel.nodes[1].element(indexNode);
    const field2 = atlasLevel.nodes[2].element(indexNode);
    return {
      height: field0.x,
      macroHeight: field0.y,
      ridge: field0.z,
      oceanDepth: field0.w,
      humidity: field1.x,
      temperature: field1.y,
      ruggednessProxy: field1.z,
      roughnessCause: field1.w,
      craterFloor: field2.x,
      craterRim: field2.y,
      ejectaStrength: field2.z,
      snow: field2.w,
    };
  }

  return {
    patches,
    preset,
    tileSide,
    gutter,
    gutterSupport: Object.freeze({ ...gutterSupport }),
    layouts,
    levels,
    directionBuffer,
    directions,
    dirtyBuffer,
    uniforms,
    indexFor,
    sampleNodes,
    sampleHeightNode(indexNode, level = 0) {
      const atlasLevel = levels[level];
      if (!atlasLevel) throw new Error(`unknown planet atlas mip level ${level}`);
      return atlasLevel.nodes[0].element(indexNode).x;
    },
    get field0() { return levels[0].nodes[0]; },
    get field1() { return levels[0].nodes[1]; },
    get field2() { return levels[0].nodes[2]; },
    get version() { return version; },
    get byteLength() {
      return directionBuffer.array.byteLength + dirtyBuffer.array.byteLength +
        levels.reduce((sum, level) => sum +
          level.buffers.reduce((inner, buffer) => inner + buffer.array.byteLength, 0) +
          (level.mappingBuffer?.array.byteLength ?? 0), 0);
    },
    markDirtyPatchIds(patchIds) {
      for (const patchIndex of resolvePatchIndices(patches, patchIds)) {
        pendingDirty.add(patches[patchIndex].id);
      }
    },
    setSeed(nextSeed) {
      if (!Number.isFinite(nextSeed)) throw new Error("planet field seed must be finite");
      uniforms.seed.value = nextSeed;
      pendingDirty = new Set(patches.map((patch) => patch.id));
    },
    dispatch(renderer, { patchIds = undefined } = {}) {
      if (disposed) throw new Error("planet field atlas is disposed");
      if (renderer?.backend?.isWebGPUBackend !== true || typeof renderer.compute !== "function") {
        throw new Error("planet field atlas requires an initialized native WebGPU renderer");
      }
      const selectedPatchIds = patchIds === null
        ? null
        : patchIds ?? [...pendingDirty];
      if (Array.isArray(selectedPatchIds) && selectedPatchIds.length === 0) {
        return { version, dirtyPatchCount: 0, nodes: [] };
      }
      const dirtyIndices = resolvePatchIndices(patches, selectedPatchIds);
      dirtyArray.fill(0);
      dirtyArray.set(dirtyIndices);
      dirtyBuffer.needsUpdate = true;
      const nodes = [];
      for (let channel = 0; channel < FIELD_CHANNELS.length; channel += 1) {
        nodes.push(createBakeComputeNode({
          channel,
          dirtyCount: dirtyIndices.length,
          dirtyNode,
          directions,
          output: levels[0].nodes[channel],
          baseLayout,
          uniforms,
        }));
      }
      for (let level = 1; level < levels.length; level += 1) {
        for (let channel = 0; channel < FIELD_CHANNELS.length; channel += 1) {
          nodes.push(createMipComputeNode({
            channel,
            level,
            dirtyCount: dirtyIndices.length,
            dirtyNode,
            mappingNode: levels[level].mappingNode,
            source: levels[level - 1].nodes[channel],
            destination: levels[level].nodes[channel],
            outputLayout: levels[level],
          }));
        }
      }
      for (const node of nodes) renderer.compute(node);
      version += 1;
      pendingDirty.clear();
      dispatches.push(...nodes.map((node) => ({
        id: node.name,
        workgroups: Math.ceil(node.count / WORKGROUP_SIZE),
        invocations: node.count,
        version,
      })));
      return { version, dirtyPatchCount: dirtyIndices.length, nodes };
    },
    async readback(renderer, { level = 0 } = {}) {
      if (disposed) throw new Error("planet field atlas is disposed");
      const atlasLevel = levels[level];
      if (!atlasLevel) throw new Error(`unknown planet atlas mip level ${level}`);
      const values = await Promise.all(
        atlasLevel.buffers.map((buffer) => renderer.getArrayBufferAsync(buffer)),
      );
      return {
        version,
        level,
        fields: values.map((value) => new Float32Array(value)),
      };
    },
    describe() {
      return {
        kind: "consumed-storage-field-atlas",
        evidenceStatus: "runtime compute graph constructed; native-WebGPU readback remains incomplete",
        cacheStatus: "patch-resident-storage-atlas",
        gutterStatus: "derived-from-declared-warp-filter-derivative-and-footprint-support",
        tileSide,
        gutter,
        patchCount: patches.length,
        mipCount: levels.length,
        mipLayouts: levels.map((level) => ({
          level: level.level,
          coreSide: level.coreSide,
          gutter: level.gutter,
          storageSide: level.storageSide,
          texelsPerPatch: level.texelsPerPatch,
        })),
        workgroupSize: WORKGROUP_SIZE,
        dispatchCount: dispatches.length,
        dispatches: dispatches.slice(),
        byteLength: this.byteLength,
        channels: {
          field0: FIELD_CHANNELS[0],
          field1: FIELD_CHANNELS[1],
          field2: FIELD_CHANNELS[2],
        },
        consumedBy: ["planet vertex displacement", "planet PBR identity", "field-atlas diagnostic"],
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      directionBuffer.dispose();
      dirtyBuffer.dispose();
      for (const level of levels) {
        for (const buffer of level.buffers) buffer.dispose();
        level.mappingBuffer?.dispose();
      }
    },
  };
}
