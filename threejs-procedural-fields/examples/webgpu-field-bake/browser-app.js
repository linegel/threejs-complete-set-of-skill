import {
  FloatType,
  Mesh,
  MeshBasicNodeMaterial,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  REVISION,
  RenderTarget,
  Scene,
  TextureLoader,
  UnsignedByteType,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  float,
  normalize,
  renderOutput,
  select,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";

import {
  FIELD_ALGORITHM,
  FIELD_GRADIENT_CHANNELS,
  FIELD_PARITY_CHANNELS,
  createFieldNodeBundle,
  fieldInputTransform,
  gpuParityProbes,
  sampleField,
  sampleFieldDerived,
  sampleFieldGradient,
  sampleFieldCPU,
} from "./field-bundle.mjs";
import { createFieldBakeSystem } from "./field-bake.mjs";
import {
  FIELD_MECHANISM_OUTPUTS,
  enforceLockedRouteSelection,
  validateDisplaySubmissionCount,
  validateStorageEvidenceContract,
  validateTierResourceDescription,
} from "./route-contract.mjs";

const canvas = document.getElementById("view");
const status = document.getElementById("status");

const FIELD_EXTENT = Object.freeze({ width: 641, height: 359 });
const PLACEMENT_EXTENT = Object.freeze({ columns: 64, rows: 64 });
const SCENARIOS = new Set([
  "field-and-gradient-gallery",
  "domain-warp-jacobian",
  "storage-bake-and-mips",
  "direct-vs-baked",
  "structured-placement",
  "shared-cause-composition",
]);
const TIERS = new Set(["gpu-storage", "gpu-direct-evaluate", "precomputed-minimum"]);
const MODES = new Set([
  "final",
  "coordinates",
  "warp",
  "macro-height",
  "gradient",
  "slope",
  "packed",
  "direct-vs-baked",
  "placement",
]);
const CAMERAS = new Map([
  ["near", 0.5],
  ["design", 1],
  ["far", 2],
]);
const PIXEL_TARGETS = new Set(["display", "final", "diagnostic"]);
const PRECOMPUTED_ASSETS = Object.freeze([
  { id: "biome-field-a", file: "biome-field-a.png", width: 512, height: 512, sourceSeed: 1103 },
  { id: "biome-field-b", file: "biome-field-b.png", width: 512, height: 512, sourceSeed: 2207 },
  { id: "biome-field-c", file: "biome-field-c.png", width: 512, height: 512, sourceSeed: 3301 },
]);

function setStatus(message) {
  status.textContent = message;
}

function requireKnown(value, values, label) {
  if (!values.has(value)) throw new Error(`Unknown ${label} "${value}"`);
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function probeGpuInputs(probe) {
  const inputTransform = fieldInputTransform(probe);
  return {
    coordinate: inputTransform.coordinate,
    inputJacobianColumns: inputTransform.jacobianColumns,
    seed: (probe.seed ?? FIELD_ALGORITHM.defaultSeed) >>> 0,
    warpStrength: probe.domain === "sphere" ? FIELD_ALGORITHM.warp.amplitude : 0,
  };
}

function unpackVector(channels, vector) {
  return Object.fromEntries(channels.map((channel, index) => [channel, vector[index]]));
}

function describeRgbaReadbackLayout(raw, readWidth, readHeight) {
  if (!(raw instanceof Uint8Array)) {
    throw new TypeError(`display readback must be Uint8Array, received ${raw?.constructor?.name}`);
  }
  const rowBytes = readWidth * 4;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  let sourceBytesPerRow;
  if (readHeight === 1 || raw.byteLength === rowBytes * readHeight) {
    sourceBytesPerRow = rowBytes;
  } else if (
    raw.byteLength === bytesPerRow * readHeight ||
    raw.byteLength === bytesPerRow * (readHeight - 1) + rowBytes
  ) {
    sourceBytesPerRow = bytesPerRow;
  } else {
    throw new Error(
      `invalid WebGPU RGBA8 row layout: length=${raw.byteLength}, ` +
      `tight=${rowBytes * readHeight}, paddedTail=${bytesPerRow * (readHeight - 1) + rowBytes}, ` +
      `paddedFull=${bytesPerRow * readHeight}`,
    );
  }
  return { rowBytes, bytesPerRow, sourceBytesPerRow };
}

function compactRgbaRows(raw, readWidth, readHeight, sourceBytesPerRow) {
  const rowBytes = readWidth * 4;
  const packed = new Uint8Array(rowBytes * readHeight);
  for (let y = 0; y < readHeight; y += 1) {
    packed.set(
      raw.subarray(y * sourceBytesPerRow, y * sourceBytesPerRow + rowBytes),
      y * rowBytes,
    );
  }
  return packed;
}

async function createApp() {
  const routeKind = document.documentElement.dataset.routeKind ?? null;
  const routeId = document.documentElement.dataset.routeId ?? null;
  const lockedTier = routeKind === "tier" ? routeId : "gpu-storage";
  const lockedScenario = routeKind === "mechanism" ? routeId : "field-and-gradient-gallery";
  requireKnown(lockedTier, TIERS, "tier route");
  requireKnown(lockedScenario, SCENARIOS, "scenario route");

  const renderer = new WebGPURenderer({ canvas, antialias: false, outputBufferType: FloatType });
  renderer.setPixelRatio(1);
  renderer.setSize(FIELD_EXTENT.width, FIELD_EXTENT.height, false);
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("threejs-procedural-fields requires a native WebGPU backend.");
  }

  const coordinateUniform = uniform(new Vector3(1, 0, 0));
  const seedUniform = uniform(FIELD_ALGORITHM.defaultSeed >>> 0, "uint");
  const warpStrengthUniform = uniform(FIELD_ALGORITHM.warp.amplitude);
  const viewScaleUniform = uniform(1);
  const timeUniform = uniform(0);
  const inputJacobianColumnUniforms = [0, 1, 2].map((index) => uniform(
    new Vector3(index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0),
  ));

  // Probe materials write raw data to the FloatType readback target. They are
  // independent of the presentation graph and never own output conversion.
  const packedMaterial = new MeshBasicNodeMaterial();
  packedMaterial.fragmentNode = sampleField({
    coordinate: coordinateUniform,
    seed: seedUniform,
    warpStrength: warpStrengthUniform,
    inputJacobianColumns: inputJacobianColumnUniforms,
  });
  const derivedMaterial = new MeshBasicNodeMaterial();
  derivedMaterial.fragmentNode = sampleFieldDerived({
    coordinate: coordinateUniform,
    seed: seedUniform,
    warpStrength: warpStrengthUniform,
    inputJacobianColumns: inputJacobianColumnUniforms,
  });
  const gradientMaterial = new MeshBasicNodeMaterial();
  gradientMaterial.fragmentNode = sampleFieldGradient({
    coordinate: coordinateUniform,
    seed: seedUniform,
    warpStrength: warpStrengthUniform,
    inputJacobianColumns: inputJacobianColumnUniforms,
  });

  const mesh = new Mesh(new PlaneGeometry(2, 2), packedMaterial);
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const probeTarget = new RenderTarget(1, 1, { type: FloatType });
  const displayTarget = new RenderTarget(FIELD_EXTENT.width, FIELD_EXTENT.height, {
    type: UnsignedByteType,
  });
  displayTarget.texture.colorSpace = renderer.outputColorSpace;

  let scenario = lockedScenario;
  let tier = null;
  let mode = "final";
  let cameraId = "design";
  let seed = FIELD_ALGORITHM.defaultSeed >>> 0;
  let timeSeconds = 0;
  let width = FIELD_EXTENT.width;
  let height = FIELD_EXTENT.height;
  let dpr = 1;
  let fieldSystem = null;
  let precomputedTexture = null;
  let precomputedAsset = null;
  let displayMaterial = null;
  let disposed = false;
  let initialized = false;
  const metrics = {
    renderCount: 0,
    computeDispatchCount: 0,
    tierTransitions: 0,
    modeTransitions: 0,
    scenarioTransitions: 0,
    resizeCount: 0,
    historyResetCount: 0,
    lastHistoryResetCause: null,
  };

  function disposeDisplayMaterial() {
    displayMaterial?.dispose();
    displayMaterial = null;
  }

  function disposeTierResources() {
    fieldSystem?.dispose();
    fieldSystem = null;
    precomputedTexture?.dispose();
    precomputedTexture = null;
    precomputedAsset = null;
  }

  function buildDiagnosticNodes() {
    const displayUv = uv();
    const objectCoordinate = vec3(
      displayUv.x.sub(0.5).mul(8).mul(viewScaleUniform),
      float(0.37).add(timeUniform.mul(0.01)),
      displayUv.y.sub(0.5).mul(8).mul(viewScaleUniform),
    );
    const objectBundle = createFieldNodeBundle({
      coordinate: objectCoordinate,
      seed: seedUniform,
      warpStrength: float(0),
      varPrefix: "displayObjectField",
    });
    const sphereCoordinate = normalize(vec3(
      displayUv.x.sub(0.5).mul(2),
      displayUv.y.sub(0.5).mul(2),
      1,
    ));
    const sphereBundle = createFieldNodeBundle({
      coordinate: sphereCoordinate,
      seed: seedUniform,
      warpStrength: float(FIELD_ALGORITHM.warp.amplitude),
      varPrefix: "displaySphereField",
    });
    const directPacked = objectBundle.packedChannels;
    const storagePacked = fieldSystem
      ? texture(fieldSystem.resources.packedTexture, displayUv)
      : directPacked;
    const precomputedPacked = precomputedTexture
      ? texture(precomputedTexture, displayUv)
      : directPacked;
    const tierPacked = tier === "gpu-storage"
      ? storagePacked
      : tier === "precomputed-minimum" ? precomputedPacked : directPacked;
    const directVsBaked = select(displayUv.x.lessThan(0.5), directPacked, tierPacked);
    const acceptedColor = vec3(0.12, 0.92, 0.32);
    const rejectedColor = vec3(0.2, 0.035, 0.03);
    const placementColor = select(
      objectBundle.placementMask.greaterThanEqual(0.5),
      acceptedColor,
      rejectedColor,
    ).mul(objectBundle.placementMask.mul(0.65).add(0.35));

    const named = {
      coordinates: vec4(displayUv.x, displayUv.y, 0, 1),
      warp: vec4(sphereBundle.tangentWarp.mul(0.5).add(0.5), 1),
      "macro-height": vec4(vec3(objectBundle.macroHeight), 1),
      gradient: vec4(objectBundle.macroGradient.mul(0.5).add(0.5), 1),
      slope: vec4(vec3(objectBundle.slope), 1),
      packed: tierPacked,
      "direct-vs-baked": directVsBaked,
      placement: vec4(placementColor, 1),
    };
    const scenarioNodes = {
      "macro-slope-roughness-gallery": vec4(
        objectBundle.macroHeight,
        objectBundle.slope,
        objectBundle.roughness,
        1,
      ),
      "tangent-warp-vector": named.warp,
      "storage-packed-sample": storagePacked,
      "split-direct-storage-comparison": directVsBaked,
      "accepted-rejected-placement-mask": named.placement,
      "height-moisture-roughness-causes": vec4(
        objectBundle.macroHeight,
        objectBundle.moisture,
        objectBundle.roughness,
        1,
      ),
    };
    const scenarioNode = scenarioNodes[FIELD_MECHANISM_OUTPUTS[scenario].outputNodeId];
    return { selected: mode === "final" ? scenarioNode : named[mode], named };
  }

  function rebuildDisplayGraph() {
    disposeDisplayMaterial();
    const nodes = buildDiagnosticNodes();
    displayMaterial = new MeshBasicNodeMaterial();
    displayMaterial.fragmentNode = renderOutput(
      nodes.selected,
      renderer.toneMapping,
      renderer.outputColorSpace,
    );
    displayMaterial.name = `field-display:${scenario}:${tier}:${mode}`;
    mesh.material = displayMaterial;
  }

  async function configureTierResources(nextTier, { force = false } = {}) {
    requireKnown(nextTier, TIERS, "tier");
    if (!force && tier === nextTier) return;
    disposeDisplayMaterial();
    disposeTierResources();
    if (nextTier === "gpu-storage") {
      fieldSystem = createFieldBakeSystem(renderer, {
        width: FIELD_EXTENT.width,
        height: FIELD_EXTENT.height,
        placementColumns: PLACEMENT_EXTENT.columns,
        placementRows: PLACEMENT_EXTENT.rows,
        seed,
      });
      const trace = await fieldSystem.dispatchFull();
      metrics.computeDispatchCount += trace.dispatchTrace.length;
    } else if (nextTier === "precomputed-minimum") {
      precomputedAsset = PRECOMPUTED_ASSETS[seed % PRECOMPUTED_ASSETS.length];
      precomputedTexture = await new TextureLoader().loadAsync(new URL(
        `../../assets/generated-variants/${precomputedAsset.file}`,
        import.meta.url,
      ).href);
      precomputedTexture.colorSpace = NoColorSpace;
      precomputedTexture.generateMipmaps = true;
      precomputedTexture.needsUpdate = true;
    }
    tier = nextTier;
    metrics.tierTransitions += 1;
    rebuildDisplayGraph();
  }

  async function renderOnce() {
    if (disposed) throw new Error("field lab is disposed");
    mesh.material = displayMaterial;
    renderer.setRenderTarget(displayTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    metrics.renderCount += 1;
  }

  async function readMaterial(material, probe) {
    const inputs = probeGpuInputs(probe);
    coordinateUniform.value.set(...inputs.coordinate);
    seedUniform.value = inputs.seed;
    warpStrengthUniform.value = inputs.warpStrength;
    for (let index = 0; index < 3; index += 1) {
      inputJacobianColumnUniforms[index].value.fromArray(inputs.inputJacobianColumns[index]);
    }
    mesh.material = material;
    renderer.setRenderTarget(probeTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const pixels = await renderer.readRenderTargetPixelsAsync(probeTarget, 0, 0, 1, 1);
    mesh.material = displayMaterial;
    return Array.from(pixels);
  }

  async function captureFieldReadback(probes = gpuParityProbes) {
    if (!Array.isArray(probes) || probes.length === 0) throw new Error("probes must be nonempty");
    const samples = [];
    try {
      for (const probe of probes) {
        const packed = await readMaterial(packedMaterial, probe);
        const derived = await readMaterial(derivedMaterial, probe);
        const gradient = await readMaterial(gradientMaterial, probe);
        samples.push({
          probe,
          values: {
            ...unpackVector(FIELD_PARITY_CHANNELS.slice(0, 4), packed),
            ...unpackVector(FIELD_PARITY_CHANNELS.slice(4, 8), derived),
            ...unpackVector(Object.values(FIELD_GRADIENT_CHANNELS).slice(0, 3), gradient),
          },
        });
      }
    } finally {
      seedUniform.value = seed;
      mesh.material = displayMaterial;
    }
    return {
      version: 2,
      contract: {
        classification: "canonical-lab",
        path: "direct-wgsl-f32-plus-tier-specific-resources",
        artifactBundle: [
          "field-readback.json",
          "field-storage-readback.json",
          "field-placement-readback.json",
        ],
        productionReady: false,
        probeSet: "gpuParityProbes-v3-original-domain-gradients",
        seedRepresentation: "u32-uniform",
      },
      renderer: {
        threeRevision: REVISION,
        isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
        outputBufferType: renderer.getOutputBufferType?.() ?? null,
      },
      constants: {
        coordinates: FIELD_ALGORITHM.coordinates,
        hash: FIELD_ALGORITHM.hash,
        bands: FIELD_ALGORITHM.bands,
        derived: FIELD_ALGORITHM.derived,
      },
      channels: FIELD_PARITY_CHANNELS,
      samples,
    };
  }

  function halfToFloat(value) {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >>> 10) & 0x1f;
    const fraction = value & 0x03ff;
    if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
    if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
    return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  }

  function resolveHalfReadbackLayout(readback, readWidth, readHeight) {
    const rowBytes = readWidth * 8;
    const alignedRowBytes = Math.ceil(rowBytes / 256) * 256;
    const tightLength = readWidth * readHeight * 4;
    const paddedTailLength = (alignedRowBytes * Math.max(readHeight - 1, 0) + rowBytes) /
      readback.BYTES_PER_ELEMENT;
    const fullyPaddedLength = alignedRowBytes * readHeight / readback.BYTES_PER_ELEMENT;
    let elementsPerRow;
    let encoding;
    if (readback.length === tightLength) {
      elementsPerRow = readWidth * 4;
      encoding = "tight";
    } else if (readback.length === paddedTailLength || readback.length === fullyPaddedLength) {
      elementsPerRow = alignedRowBytes / readback.BYTES_PER_ELEMENT;
      encoding = readback.length === paddedTailLength ? "aligned-tail-tight" : "aligned-full";
    } else {
      throw new Error(
        `unexpected WebGPU readback length ${readback.length}; expected ` +
        `${tightLength}, ${paddedTailLength}, or ${fullyPaddedLength}`,
      );
    }
    if (!Number.isInteger(elementsPerRow) || elementsPerRow < readWidth * 4) {
      throw new Error(`invalid WebGPU readback stride ${elementsPerRow}`);
    }
    return {
      encoding,
      rowBytes,
      alignedRowBytes,
      elementsPerRow,
      tightLength,
      paddedTailLength,
      fullyPaddedLength,
    };
  }

  function readHalfPixel(readback, x, y, layout) {
    const offset = y * layout.elementsPerRow + x * 4;
    return [0, 1, 2, 3].map((lane) => halfToFloat(readback[offset + lane]));
  }

  async function readStorage(storageTexture, readWidth, readHeight) {
    const readback = await renderer.backend.copyTextureToBuffer(
      storageTexture,
      0,
      0,
      readWidth,
      readHeight,
      0,
    );
    const layout = resolveHalfReadbackLayout(readback, readWidth, readHeight);
    return {
      constructor: readback.constructor.name,
      length: readback.length,
      layout,
      samples: [
        [0, 0],
        [Math.floor(readWidth / 2), Math.floor(readHeight / 2)],
        [readWidth - 1, readHeight - 1],
      ].map(([x, y]) => ({ x, y, value: readHalfPixel(readback, x, y, layout) })),
    };
  }

  function requireStorageTier(operation) {
    if (tier !== "gpu-storage" || !fieldSystem) {
      throw new Error(`${operation} requires the gpu-storage tier`);
    }
  }

  async function captureStoredReadback() {
    requireStorageTier("storage readback");
    const { resources } = fieldSystem;
    const packed = await readStorage(resources.packedTexture, resources.width, resources.height);
    const derived = await readStorage(resources.derivedTexture, resources.width, resources.height);
    const gradient = await readStorage(resources.gradientTexture, resources.width, resources.height);
    const mipChain = [];
    for (let level = 0; level < resources.packedMipTextures.length; level += 1) {
      const extent = resources.mipExtents[level];
      mipChain.push({
        level,
        extent,
        readback: await readStorage(resources.packedMipTextures[level], extent.width, extent.height),
      });
    }
    const center = packed.samples[1];
    const coordinate = [
      -4 + center.x / Math.max(resources.width - 1, 1) * 8,
      0.37,
      -4 + center.y / Math.max(resources.height - 1, 1) * 8,
    ];
    const cpu = sampleFieldCPU({ domain: "object", coordinate, seed });
    return {
      schemaVersion: 2,
      contract: validateStorageEvidenceContract({
        path: "rgba16float-storage-write-readback-with-explicit-box-mips",
        sampleCoverage: "three declared texels per resource",
        filteredConsumerValidated: false,
        filteredMipReadbackValidated: false,
        dirtyRegionExecutionValidated: false,
        performanceMeasured: false,
        productionReady: false,
      }),
      renderer: { threeRevision: REVISION, isWebGPUBackend: true },
      extent: { width: resources.width, height: resources.height },
      packed,
      derived,
      gradient,
      mipChain,
      centerCpuReference: {
        coordinate,
        packed: Object.values(cpu.packedChannels),
        derived: Object.values(cpu.derivedChannels),
        gradient: Object.values(cpu.gradientChannels),
      },
      resources: describeResources(),
    };
  }

  async function capturePlacementReadback() {
    requireStorageTier("placement readback");
    const recordBuffer = await fieldSystem.dispatchPlacement();
    metrics.computeDispatchCount += 1;
    const indexBuffer = await renderer.getArrayBufferAsync(fieldSystem.placement.acceptedIndices);
    const values = new Float32Array(recordBuffer);
    const acceptedIndices = Array.from(new Uint32Array(indexBuffer));
    const records = acceptedIndices.map((cellIndex, outputIndex) => [
      values[outputIndex * 4],
      values[outputIndex * 4 + 1],
      values[outputIndex * 4 + 2],
      cellIndex,
    ]);
    const masks = records.map((record) => record[2]);
    return {
      schemaVersion: 2,
      contract: {
        path: "deterministic-index-list-plus-storage-buffer-write-readback",
        artifactCoverage: "all-accepted-compacted-records-plus-index-list",
        rejectedRecordsRetained: false,
        performanceMeasured: false,
        productionReady: false,
      },
      cellCount: fieldSystem.placement.cellCount,
      accepted: fieldSystem.placement.acceptedCount,
      rejected: fieldSystem.placement.rejectedCount,
      acceptedIndices,
      minAcceptedMask: Math.min(...masks),
      maxAcceptedMask: Math.max(...masks),
      storageBytes: fieldSystem.placement.bytes,
      recordBytes: fieldSystem.placement.recordBytes,
      indexBytes: fieldSystem.placement.indexBytes,
      records,
    };
  }

  function describeResources() {
    const common = {
      probeTargets: 1,
      displayTargets: 1,
      outputExtent: { width, height, dpr },
    };
    if (tier === "gpu-storage") {
      return validateTierResourceDescription(tier, {
        tier,
        graph: "runtime-compute-storage-and-explicit-mips",
        common,
        ...fieldSystem.describeResources(),
        precomputedTextures: 0,
      });
    }
    if (tier === "gpu-direct-evaluate") {
      return validateTierResourceDescription(tier, {
        tier,
        graph: "direct-tsl-evaluation",
        common,
        textures: 0,
        storageBuffers: 0,
        storageBytes: 0,
        precomputedTextures: 0,
      });
    }
    return validateTierResourceDescription(tier, {
      tier,
      graph: "immutable-generated-field-texture",
      common,
      textures: 1,
      storageBuffers: 0,
      storageBytes: 0,
      precomputedTextures: 1,
      precomputedAsset,
      decodedTextureBytes: precomputedAsset.width * precomputedAsset.height * 4,
    });
  }

  function describePipeline() {
    return validateDisplaySubmissionCount({
      schemaVersion: 2,
      owners: {
        renderer: "webgpu-field-bake",
        finalOutput: "MeshBasicNodeMaterial.fragmentNode",
        fieldAlgorithm: "createFieldNodeBundle",
      },
      routeSelection: { scenario, tier, mode, camera: cameraId, seed, timeSeconds },
      sceneSubmissionCount: 2,
      sceneSubmissions: [
        { id: "field-evidence-target", count: 1 },
        { id: "field-canvas-presentation", count: 1 },
      ],
      computeDispatches: tier === "gpu-storage"
        ? fieldSystem.describeResources().lastDispatchTrace ?? []
        : [],
      resources: describeResources(),
      mechanismNode: `${scenario}:${mode}`,
      nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
      acceptanceStatus: "incomplete",
    });
  }

  const controller = {
    async ready() {
      if (!initialized) {
        await renderOnce();
        initialized = true;
      }
    },
    async setScenario(id) {
      requireKnown(id, SCENARIOS, "scenario");
      enforceLockedRouteSelection({ kind: routeKind, id: routeId }, "mechanism", id);
      scenario = id;
      metrics.scenarioTransitions += 1;
      rebuildDisplayGraph();
      await renderOnce();
    },
    async setMode(id) {
      requireKnown(id, MODES, "mode");
      mode = id;
      metrics.modeTransitions += 1;
      rebuildDisplayGraph();
      await renderOnce();
    },
    async setTier(id) {
      enforceLockedRouteSelection({ kind: routeKind, id: routeId }, "tier", id);
      await configureTierResources(id);
      await renderOnce();
    },
    async setSeed(nextSeed) {
      if (!Number.isInteger(nextSeed) || nextSeed < 0 || nextSeed > 0xffffffff) {
        throw new Error("seed must be a u32 integer");
      }
      seed = nextSeed >>> 0;
      seedUniform.value = seed;
      await configureTierResources(tier, { force: true });
      await renderOnce();
    },
    async setCamera(id) {
      if (!CAMERAS.has(id)) throw new Error(`Unknown camera "${id}"`);
      cameraId = id;
      viewScaleUniform.value = CAMERAS.get(id);
      await renderOnce();
    },
    async setTime(seconds) {
      timeSeconds = requireFinite(seconds, "time");
      timeUniform.value = timeSeconds;
      await renderOnce();
    },
    async step(deltaSeconds) {
      requireFinite(deltaSeconds, "deltaSeconds");
      if (deltaSeconds < 0) throw new Error("deltaSeconds must be non-negative");
      await controller.setTime(timeSeconds + deltaSeconds);
    },
    async resetHistory(cause) {
      if (typeof cause !== "string" || cause.length === 0) {
        throw new Error("history reset cause must be nonempty");
      }
      metrics.historyResetCount += 1;
      metrics.lastHistoryResetCause = cause;
      await renderOnce();
    },
    async resize(nextWidth, nextHeight, nextDpr) {
      if (!Number.isInteger(nextWidth) || !Number.isInteger(nextHeight) || nextWidth <= 0 || nextHeight <= 0) {
        throw new Error("resize dimensions must be positive integers");
      }
      requireFinite(nextDpr, "dpr");
      if (nextDpr <= 0) throw new Error("dpr must be positive");
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      displayTarget.setSize(Math.ceil(width * dpr), Math.ceil(height * dpr));
      metrics.resizeCount += 1;
      await renderOnce();
    },
    renderOnce,
    async capturePixels(targetName = "display") {
      requireKnown(targetName, PIXEL_TARGETS, "pixel target");
      await renderOnce();
      const captureWidth = displayTarget.width;
      const captureHeight = displayTarget.height;
      const pixels = await renderer.readRenderTargetPixelsAsync(
        displayTarget,
        0,
        0,
        captureWidth,
        captureHeight,
      );
      const layout = describeRgbaReadbackLayout(pixels, captureWidth, captureHeight);
      const tightPixels = compactRgbaRows(
        pixels,
        captureWidth,
        captureHeight,
        layout.sourceBytesPerRow,
      );
      return {
        target: targetName,
        width: captureWidth,
        height: captureHeight,
        format: "rgba8unorm",
        bytesPerPixel: 4,
        rowBytes: layout.rowBytes,
        bytesPerRow: layout.bytesPerRow,
        sourceBytesPerRow: layout.sourceBytesPerRow,
        sourceByteLength: pixels.byteLength,
        sourceElementBytes: 1,
        colorManaged: true,
        outputColorSpace: renderer.outputColorSpace,
        pixels: tightPixels,
        data: tightPixels,
        source: "render-target-readback",
        scenario,
        tier,
        mode,
      };
    },
    describePipeline,
    describeResources,
    getMetrics() {
      return {
        ...metrics,
        scenario,
        tier,
        mode,
        camera: cameraId,
        seed,
        timeSeconds,
        nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      disposeDisplayMaterial();
      disposeTierResources();
      probeTarget.dispose();
      displayTarget.dispose();
      mesh.geometry.dispose();
      packedMaterial.dispose();
      derivedMaterial.dispose();
      gradientMaterial.dispose();
      renderer.dispose();
    },
    captureFieldReadback,
    captureStoredReadback,
    capturePlacementReadback,
  };

  await configureTierResources(lockedTier);
  await controller.ready();
  return controller;
}

globalThis.__fieldBakeValidation = { ready: false, error: null };

createApp()
  .then((controller) => {
    const legacy = {
      ready: true,
      error: null,
      ...controller,
      getState: () => controller.getMetrics(),
    };
    globalThis.labController = controller;
    globalThis.__LAB_CONTROLLER__ = controller;
    globalThis.__fieldBakeValidation = legacy;
    globalThis.__LAB_READY__ = true;
    setStatus("ready");
  })
  .catch((error) => {
    globalThis.__fieldBakeValidation.error = error.stack ?? error.message;
    globalThis.__LAB_ERROR__ = error.stack ?? error.message;
    setStatus(error.message);
    console.error(error);
  });
