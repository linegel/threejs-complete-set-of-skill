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
  floor,
  normalize,
  positionLocal,
  renderOutput,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import {
  FIELD_ALGORITHM,
  FIELD_GRADIENT_CHANNELS,
  FIELD_PARITY_CHANNELS,
  createFieldCauseBindings,
  createFieldNodeBundle,
  fieldInputTransform,
  gpuParityProbes,
  sampleFieldF32CPU,
} from "./field-bundle.mjs";
import {
  compareFieldStorageMutation,
  createFieldBakeSystem,
  createFieldProbeComputeNode,
  createFieldProbeResources,
  createScopedFieldResourceLedger,
  disposeFieldProbeResources,
  fieldMipExtents,
  propagateDirtyRegion,
  validateFieldStorageConfinement,
  validatePlacementReadbackSeparation,
} from "./field-bake.mjs";
import {
  FIELD_PROBE_CORPUS,
  FIELD_PROBE_CORPUS_COUNTS,
  createStressProbeCorpus,
} from "./field-probe-corpus.mjs";
import {
  FIELD_MECHANISM_OUTPUTS,
  enforceLockedRouteSelection,
  validateDisplaySubmissionCount,
  validateStorageEvidenceContract,
  validateTierResourceDescription,
} from "./route-contract.mjs";
import PRECOMPUTED_ASSET_MANIFEST from "../../assets/generated-variants/manifest.json" with { type: "json" };

const canvas = document.getElementById("view");
const status = document.getElementById("status");

const FIELD_EXTENT = Object.freeze({ width: 641, height: 359 });
const THREE_PACKAGE_VERSION = "0.185.1";
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
const PRECOMPUTED_ASSETS = Object.freeze(PRECOMPUTED_ASSET_MANIFEST.assets.map((asset) => {
  const mipExtents = fieldMipExtents(asset.width, asset.height);
  return Object.freeze({
    ...asset,
    sourceByteLength: asset.byteLength,
    mipExtents,
    mipLevelCount: mipExtents.length,
    decodedBaseBytes: asset.width * asset.height * asset.channels,
    decodedMipChainBytes: mipExtents.reduce(
      (sum, extent) => sum + extent.width * extent.height * asset.channels,
      0,
    ),
  });
}));

function setStatus(message) {
  status.textContent = message;
  if (globalThis.__fieldBakeValidation) globalThis.__fieldBakeValidation.phase = message;
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
  const runtimeProfile = globalThis.__LAB_CAPTURE_PROFILE__?.id ?? "correctness";
  const timestampQueriesRequested = runtimeProfile === "performance";
  const routeKind = document.documentElement.dataset.routeKind ?? null;
  const routeId = document.documentElement.dataset.routeId ?? null;
  const lockedTier = routeKind === "tier" ? routeId : "gpu-storage";
  const lockedScenario = routeKind === "mechanism" ? routeId : "field-and-gradient-gallery";
  requireKnown(lockedTier, TIERS, "tier route");
  requireKnown(lockedScenario, SCENARIOS, "scenario route");
  const initialSeed = lockedTier === "precomputed-minimum"
    ? PRECOMPUTED_ASSETS[0].seed
    : FIELD_ALGORITHM.defaultSeed;

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    outputBufferType: FloatType,
    trackTimestamp: timestampQueriesRequested,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(FIELD_EXTENT.width, FIELD_EXTENT.height, false);
  await renderer.init();
  if (REVISION !== "185") throw new Error(`expected Three r185, received r${REVISION}`);
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("threejs-procedural-fields requires a native WebGPU backend.");
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
  const timestampQueriesActive = timestampQueriesRequested &&
    renderer.hasFeature?.("timestamp-query") === true;
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

  const coordinateUniform = uniform(new Vector3(1, 0, 0));
  const seedUniform = uniform(initialSeed >>> 0, "uint");
  const warpStrengthUniform = uniform(FIELD_ALGORITHM.warp.amplitude);
  const viewScaleUniform = uniform(1);
  const timeUniform = uniform(0);
  const inputJacobianColumnUniforms = [0, 1, 2].map((index) => uniform(
    new Vector3(index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0),
  ));

  // Probe materials write raw data to the FloatType readback target. Object
  // and world probes use a separately constructed warp-free graph, so origin
  // probes cannot execute normalize(0) behind a numeric zero multiplier.
  function createProbeMaterials(warpEnabled) {
    const bundle = createFieldNodeBundle({
      coordinate: coordinateUniform,
      seed: seedUniform,
      warpEnabled,
      warpStrength: warpEnabled ? warpStrengthUniform : undefined,
      inputJacobianColumns: inputJacobianColumnUniforms,
      varPrefix: warpEnabled ? "probeWarpedField" : "probeWarpFreeField",
    });
    const packed = new MeshBasicNodeMaterial();
    packed.fragmentNode = bundle.packedChannels;
    const derived = new MeshBasicNodeMaterial();
    derived.fragmentNode = bundle.derivedChannels;
    const gradient = new MeshBasicNodeMaterial();
    gradient.fragmentNode = bundle.gradientChannels;
    return Object.freeze({ packed, derived, gradient, warpEnabled, warpMode: bundle.warpMode });
  }
  const warpFreeProbeMaterials = createProbeMaterials(false);
  const warpedProbeMaterials = createProbeMaterials(true);
  const allProbeMaterials = Object.freeze([
    warpFreeProbeMaterials.packed,
    warpFreeProbeMaterials.derived,
    warpFreeProbeMaterials.gradient,
    warpedProbeMaterials.packed,
    warpedProbeMaterials.derived,
    warpedProbeMaterials.gradient,
  ]);

  const mesh = new Mesh(new PlaneGeometry(2, 2), warpFreeProbeMaterials.packed);
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
  let seed = initialSeed >>> 0;
  let timeSeconds = 0;
  let width = FIELD_EXTENT.width;
  let height = FIELD_EXTENT.height;
  let dpr = 1;
  let fieldSystem = null;
  let precomputedTexture = null;
  let precomputedAsset = null;
  let displayMaterial = null;
  let causeGraph = null;
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
      warpEnabled: false,
      varPrefix: "displayObjectField",
    });
    const objectCauses = createFieldCauseBindings(objectBundle);
    const sphereCoordinate = normalize(vec3(
      displayUv.x.sub(0.5).mul(2),
      displayUv.y.sub(0.5).mul(2),
      1,
    ));
    const sphereBundle = createFieldNodeBundle({
      coordinate: sphereCoordinate,
      seed: seedUniform,
      warpEnabled: true,
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
    const comparisonPixelWidth = Math.ceil(width * dpr);
    const comparisonHalfWidth = Math.floor(comparisonPixelWidth / 2);
    const comparisonRightStart = comparisonPixelWidth - comparisonHalfWidth;
    const comparisonLeftBoundary = comparisonHalfWidth / comparisonPixelWidth;
    const comparisonRightBoundary = comparisonRightStart / comparisonPixelWidth;
    const comparisonScale = comparisonPixelWidth / comparisonHalfWidth;
    const comparisonX = select(
      displayUv.x.lessThan(comparisonLeftBoundary),
      displayUv.x.mul(comparisonScale),
      displayUv.x.sub(comparisonRightBoundary).mul(comparisonScale),
    );
    const comparisonUv = vec2(comparisonX, displayUv.y);
    const storageExtentNode = vec2(FIELD_EXTENT.width, FIELD_EXTENT.height);
    const comparisonCell = floor(comparisonUv.mul(storageExtentNode)).min(
      storageExtentNode.sub(1),
    );
    const alignedStorageUv = comparisonCell.add(0.5).div(storageExtentNode);
    const alignedFieldUv = comparisonCell.div(vec2(
      FIELD_EXTENT.width - 1,
      FIELD_EXTENT.height - 1,
    ));
    const comparisonCoordinate = vec3(
      alignedFieldUv.x.sub(0.5).mul(8).mul(viewScaleUniform),
      float(0.37).add(timeUniform.mul(0.01)),
      alignedFieldUv.y.sub(0.5).mul(8).mul(viewScaleUniform),
    );
    const comparisonBundle = createFieldNodeBundle({
      coordinate: comparisonCoordinate,
      seed: seedUniform,
      warpEnabled: false,
      varPrefix: "comparisonObjectField",
    });
    const comparisonStored = fieldSystem
      ? texture(fieldSystem.resources.packedTexture, alignedStorageUv)
      : comparisonBundle.packedChannels;
    const comparisonTier = tier === "gpu-storage"
      ? comparisonStored
      : tier === "precomputed-minimum" ? texture(precomputedTexture, comparisonUv) : comparisonBundle.packedChannels;
    const directVsBaked = select(
      displayUv.x.lessThan(comparisonLeftBoundary),
      comparisonBundle.packedChannels,
      select(
        displayUv.x.greaterThanEqual(comparisonRightBoundary),
        comparisonTier,
        vec4(0.5, 0.5, 0.5, 1),
      ),
    );
    const acceptedColor = vec3(0.12, 0.92, 0.32);
    const rejectedColor = vec3(0.2, 0.035, 0.03);
    const placementColor = select(
      objectCauses.placement.mask.greaterThanEqual(0.5),
      acceptedColor,
      rejectedColor,
    ).mul(objectCauses.placement.mask.mul(0.65).add(0.35));

    const named = {
      coordinates: vec4(displayUv.x, displayUv.y, 0, 1),
      warp: vec4(sphereBundle.tangentWarp.mul(0.5).add(0.5), 1),
      "macro-height": vec4(vec3(objectCauses.displacement.height), 1),
      gradient: vec4(objectCauses.diagnostics.gradient.mul(0.5).add(0.5), 1),
      slope: vec4(vec3(objectCauses.material.slope), 1),
      packed: tierPacked,
      "direct-vs-baked": directVsBaked,
      placement: vec4(placementColor, 1),
    };
    const scenarioNodes = {
      "macro-slope-roughness-gallery": vec4(
        objectCauses.displacement.height,
        objectCauses.material.slope,
        objectCauses.material.roughness,
        1,
      ),
      "tangent-warp-vector": named.warp,
      "storage-packed-sample": storagePacked,
      "split-direct-storage-comparison": directVsBaked,
      "accepted-rejected-placement-mask": named.placement,
      "height-moisture-roughness-causes": vec4(
        objectCauses.material.height,
        objectCauses.material.moisture,
        objectCauses.material.roughness,
        1,
      ),
    };
    const scenarioNode = scenarioNodes[FIELD_MECHANISM_OUTPUTS[scenario].outputNodeId];
    return {
      selected: mode === "final" ? scenarioNode : named[mode],
      displacedPosition: positionLocal.add(vec3(
        0,
        0,
        objectCauses.displacement.height.mul(-0.05),
      )),
      causeGraph: Object.freeze({
        producer: objectCauses.producerId,
        consumers: Object.freeze({
          displacement: "macroHeight",
          material: Object.freeze(["macroHeight", "moisture", "roughness", "slope"]),
          placement: "placementMask",
          diagnostics: Object.freeze(["macroHeight", "moisture", "roughness", "slope", "macroGradient"]),
        }),
      }),
      named,
    };
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
    displayMaterial.positionNode = nodes.displacedPosition;
    causeGraph = nodes.causeGraph;
    displayMaterial.name = `field-display:${scenario}:${tier}:${mode}`;
    mesh.material = displayMaterial;
  }

  async function configureTierResources(nextTier, { force = false } = {}) {
    requireKnown(nextTier, TIERS, "tier");
    if (!force && tier === nextTier) return;
    disposeDisplayMaterial();
    disposeTierResources();
    if (nextTier === "gpu-storage") {
      setStatus("initializing gpu-storage field bake");
      fieldSystem = createFieldBakeSystem(renderer, {
        width: FIELD_EXTENT.width,
        height: FIELD_EXTENT.height,
        placementColumns: PLACEMENT_EXTENT.columns,
        placementRows: PLACEMENT_EXTENT.rows,
        seed,
      });
      const trace = await fieldSystem.dispatchFull();
      metrics.computeDispatchCount += trace.dispatchTrace.length;
      setStatus("gpu-storage field bake submitted");
    } else if (nextTier === "precomputed-minimum") {
      precomputedAsset = PRECOMPUTED_ASSETS.find((asset) => asset.seed === seed) ?? null;
      if (!precomputedAsset) {
        throw new Error(
          `precomputed-minimum has no asset for seed ${seed}; supported seeds are ` +
          PRECOMPUTED_ASSETS.map((asset) => asset.seed).join(", "),
        );
      }
      precomputedTexture = await new TextureLoader().loadAsync(new URL(
        `../../assets/generated-variants/${precomputedAsset.path}`,
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
        const materials = probe.domain === "sphere"
          ? warpedProbeMaterials
          : warpFreeProbeMaterials;
        const packed = await readMaterial(materials.packed, probe);
        const derived = await readMaterial(materials.derived, probe);
        const gradient = await readMaterial(materials.gradient, probe);
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
          "field-mechanism-diagnostics.json",
          "field-probe-corpus.json",
          "field-dirty-region.json",
        ],
        productionReady: false,
        probeSet: "gpuParityProbes-v4-f32-origin-and-threshold-gradients",
        seedRepresentation: "u32-uniform",
      },
      renderer: {
        threePackageVersion: THREE_PACKAGE_VERSION,
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

  function compactHalfRows(readback, readWidth, readHeight, layout) {
    const tight = new Uint16Array(readWidth * readHeight * 4);
    const elementsPerTightRow = readWidth * 4;
    for (let y = 0; y < readHeight; y += 1) {
      tight.set(
        readback.subarray(
          y * layout.elementsPerRow,
          y * layout.elementsPerRow + elementsPerTightRow,
        ),
        y * elementsPerTightRow,
      );
    }
    return tight;
  }

  async function sha256TypedArray(array) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function readStorageRaw(storageTexture, readWidth, readHeight) {
    const readback = await renderer.backend.copyTextureToBuffer(
      storageTexture,
      0,
      0,
      readWidth,
      readHeight,
      0,
    );
    const layout = resolveHalfReadbackLayout(readback, readWidth, readHeight);
    const tight = compactHalfRows(readback, readWidth, readHeight, layout);
    return {
      constructor: readback.constructor.name,
      length: readback.length,
      layout,
      tight,
      tightByteLength: tight.byteLength,
      tightSha256: await sha256TypedArray(tight),
    };
  }

  async function readStorage(storageTexture, readWidth, readHeight) {
    const raw = await readStorageRaw(storageTexture, readWidth, readHeight);
    return {
      constructor: raw.constructor,
      length: raw.length,
      layout: raw.layout,
      tightByteLength: raw.tightByteLength,
      tightSha256: raw.tightSha256,
      samples: [
        [0, 0],
        [Math.floor(readWidth / 2), Math.floor(readHeight / 2)],
        [readWidth - 1, readHeight - 1],
      ].map(([x, y]) => ({
        x,
        y,
        value: [0, 1, 2, 3].map(
          (lane) => halfToFloat(raw.tight[(y * readWidth + x) * 4 + lane]),
        ),
      })),
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
    const cpu = sampleFieldF32CPU({ domain: "object", coordinate, seed });
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
      renderer: {
        threePackageVersion: THREE_PACKAGE_VERSION,
        threeRevision: REVISION,
        isWebGPUBackend: true,
      },
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
    const rawGpuRecords = acceptedIndices.map((_, outputIndex) => [
      values[outputIndex * 4],
      values[outputIndex * 4 + 1],
      values[outputIndex * 4 + 2],
      values[outputIndex * 4 + 3],
    ]);
    const decodedRecords = acceptedIndices.map((cellIndex, outputIndex) => ({
      outputIndex,
      cpuAcceptedCellIndex: cellIndex,
      gpu: rawGpuRecords[outputIndex],
    }));
    const masks = rawGpuRecords.map((record) => record[2]);
    const rawGpuW = rawGpuRecords.map((record) => record[3]);
    return validatePlacementReadbackSeparation({
      schemaVersion: 2,
      contract: {
        path: "raw-gpu-vec4-lane-plus-separate-deterministic-cpu-index-list",
        artifactCoverage: "all-accepted-raw-gpu-records-plus-separate-index-identity",
        rawGpuLaneWMeaning: "authored-live-record-sentinel-one",
        cpuIndexIdentityStoredInGpuRecord: false,
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
      minRawGpuW: Math.min(...rawGpuW),
      maxRawGpuW: Math.max(...rawGpuW),
      storageBytes: fieldSystem.placement.bytes,
      recordBytes: fieldSystem.placement.recordBytes,
      indexBytes: fieldSystem.placement.indexBytes,
      rawGpuRecords,
      decodedRecords,
    });
  }

  async function readProbeOutputs(resources) {
    const [packedBuffer, derivedBuffer, gradientBuffer] = await Promise.all([
      renderer.getArrayBufferAsync(resources.packed),
      renderer.getArrayBufferAsync(resources.derived),
      renderer.getArrayBufferAsync(resources.gradient),
    ]);
    const packed = new Float32Array(packedBuffer);
    const derived = new Float32Array(derivedBuffer);
    const gradient = new Float32Array(gradientBuffer);
    const combined = new Uint8Array(packed.byteLength + derived.byteLength + gradient.byteLength);
    let byteOffset = 0;
    for (const array of [packed, derived, gradient]) {
      combined.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), byteOffset);
      byteOffset += array.byteLength;
    }
    return {
      packed,
      derived,
      gradient,
      sha256: await sha256TypedArray(combined),
    };
  }

  async function hashProbeOutputArrays(outputs) {
    const combined = new Uint8Array(
      outputs.packed.byteLength + outputs.derived.byteLength + outputs.gradient.byteLength,
    );
    let byteOffset = 0;
    for (const array of [outputs.packed, outputs.derived, outputs.gradient]) {
      combined.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), byteOffset);
      byteOffset += array.byteLength;
    }
    return sha256TypedArray(combined);
  }

  function createProbePartitions(probes) {
    const groups = [
      { warpMode: "disabled", entries: [] },
      { warpMode: "tangential", entries: [] },
    ];
    probes.forEach((probe, index) => {
      groups[probe.domain === "sphere" ? 1 : 0].entries.push({ probe, index });
    });
    return groups.filter((group) => group.entries.length > 0).map((group) => ({
      ...group,
      resources: createFieldProbeResources(group.entries.map((entry) => entry.probe)),
    }));
  }

  async function dispatchProbePartitions(partitions, outputCount) {
    const outputs = {
      packed: new Float32Array(outputCount * 4),
      derived: new Float32Array(outputCount * 4),
      gradient: new Float32Array(outputCount * 4),
    };
    for (const partition of partitions) {
      renderer.compute(createFieldProbeComputeNode(partition.resources));
      metrics.computeDispatchCount += 1;
      const partitionOutputs = await readProbeOutputs(partition.resources);
      partition.entries.forEach(({ index }, partitionIndex) => {
        for (const key of ["packed", "derived", "gradient"]) {
          outputs[key].set(
            partitionOutputs[key].subarray(partitionIndex * 4, partitionIndex * 4 + 4),
            index * 4,
          );
        }
      });
    }
    outputs.sha256 = await hashProbeOutputArrays(outputs);
    return outputs;
  }

  function probeOutputRecords(probes, outputs) {
    return probes.map((probe, index) => ({
      probe,
      packed: Array.from(outputs.packed.subarray(index * 4, index * 4 + 4)),
      derived: Array.from(outputs.derived.subarray(index * 4, index * 4 + 4)),
      gradient: Array.from(outputs.gradient.subarray(index * 4, index * 4 + 4)),
    }));
  }

  async function captureProbeCorpusReadback() {
    requireStorageTier("probe-corpus readback");
    const deviceLimit = renderer.backend.device.limits.maxStorageBuffersPerShaderStage;
    if (deviceLimit < 8) {
      throw new Error(`field probe corpus requires 8 storage buffers; adapter exposes ${deviceLimit}`);
    }
    const partitions = createProbePartitions(FIELD_PROBE_CORPUS.probes);
    let baseline;
    let repeated;
    try {
      baseline = await dispatchProbePartitions(partitions, FIELD_PROBE_CORPUS.probes.length);
      repeated = await dispatchProbePartitions(partitions, FIELD_PROBE_CORPUS.probes.length);
    } finally {
      for (const partition of partitions) disposeFieldProbeResources(partition.resources);
    }
    if (baseline.sha256 !== repeated.sha256) {
      throw new Error("same-seed field probe dispatch was not bitwise deterministic");
    }

    const stressProbes = createStressProbeCorpus();
    const stressPartitions = createProbePartitions(stressProbes);
    let stress;
    try {
      stress = await dispatchProbePartitions(stressPartitions, stressProbes.length);
    } finally {
      for (const partition of stressPartitions) disposeFieldProbeResources(partition.resources);
    }
    if (stress.sha256 === baseline.sha256) {
      throw new Error("stress-seed field probe corpus did not change its storage hash");
    }

    const records = probeOutputRecords(FIELD_PROBE_CORPUS.probes, baseline);
    const packedStorage = await readStorageRaw(
      fieldSystem.resources.packedTexture,
      fieldSystem.resources.width,
      fieldSystem.resources.height,
    );
    let directVsBakedMaxAbsError = 0;
    let directVsBakedSumAbsError = 0;
    let directVsBakedValueCount = 0;
    let directVsBakedSampleCount = 0;
    for (let index = 0; index < FIELD_PROBE_CORPUS_COUNTS.object; index += 1) {
      if (!records[index].probe.storageCell) continue;
      const { x, y } = records[index].probe.storageCell;
      directVsBakedSampleCount += 1;
      const offset = (y * fieldSystem.resources.width + x) * 4;
      for (let lane = 0; lane < 4; lane += 1) {
        const stored = halfToFloat(packedStorage.tight[offset + lane]);
        const error = Math.abs(records[index].packed[lane] - stored);
        directVsBakedMaxAbsError = Math.max(directVsBakedMaxAbsError, error);
        directVsBakedSumAbsError += error;
        directVsBakedValueCount += 1;
      }
    }

    return {
      schemaVersion: 2,
      contract: {
        path: "storage-buffer-tsl-corpus-plus-rgba16float-direct-comparison",
        corpusId: FIELD_PROBE_CORPUS.id,
        corpusSha256: FIELD_PROBE_CORPUS.expectedSha256,
        sameSeedBitwiseStable: true,
        stressSeedHashDistinct: true,
        performanceMeasured: false,
        productionReady: false,
      },
      renderer: {
        threePackageVersion: THREE_PACKAGE_VERSION,
        threeRevision: REVISION,
        isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
        maxStorageBuffersPerShaderStage: deviceLimit,
      },
      counts: FIELD_PROBE_CORPUS_COUNTS,
      dispatches: partitions.map((partition) => ({
        warpMode: partition.warpMode,
        probeCount: partition.resources.count,
        workgroupSize: [64, 1, 1],
        workgroupCount: [Math.ceil(partition.resources.count / 64), 1, 1],
        resourceBytes: partition.resources.bytes,
      })),
      resourceBytes: partitions.reduce((sum, partition) => sum + partition.resources.bytes, 0),
      inputBytes: partitions.reduce((sum, partition) => sum + partition.resources.inputBytes, 0),
      outputBytes: partitions.reduce((sum, partition) => sum + partition.resources.outputBytes, 0),
      baselineSha256: baseline.sha256,
      repeatedSha256: repeated.sha256,
      stressSha256: stress.sha256,
      packedStorageSha256: packedStorage.tightSha256,
      directVsBaked: {
        sampleCount: directVsBakedSampleCount,
        valueCount: directVsBakedValueCount,
        maxAbsError: directVsBakedMaxAbsError,
        meanAbsError: directVsBakedSumAbsError / directVsBakedValueCount,
      },
      records,
    };
  }

  async function captureStorageSnapshot() {
    const snapshotResources = [];
    for (let level = 0; level < fieldSystem.resources.packedMipTextures.length; level += 1) {
      const extent = fieldSystem.resources.mipExtents[level];
      snapshotResources.push({
        id: `packed-mip-${level}`,
        extent,
        raw: await readStorageRaw(
          fieldSystem.resources.packedMipTextures[level],
          extent.width,
          extent.height,
        ),
      });
    }
    for (const [id, textureResource] of [
      ["derived-base", fieldSystem.resources.derivedTexture],
      ["gradient-base", fieldSystem.resources.gradientTexture],
    ]) {
      snapshotResources.push({
        id,
        extent: { width: fieldSystem.resources.width, height: fieldSystem.resources.height },
        raw: await readStorageRaw(
          textureResource,
          fieldSystem.resources.width,
          fieldSystem.resources.height,
        ),
      });
    }
    const hashPayload = new TextEncoder().encode(JSON.stringify(
      snapshotResources.map(({ id, extent, raw }) => ({ id, extent, sha256: raw.tightSha256 })),
    ));
    return {
      resources: snapshotResources,
      sha256: await sha256TypedArray(hashPayload),
    };
  }

  function requireSnapshotIdentity(reference, candidate, label) {
    if (reference.sha256 !== candidate.sha256) {
      throw new Error(`${label} storage snapshot hash drifted`);
    }
    for (let index = 0; index < reference.resources.length; index += 1) {
      if (
        reference.resources[index].id !== candidate.resources[index]?.id ||
        reference.resources[index].raw.tightSha256 !== candidate.resources[index].raw.tightSha256
      ) {
        throw new Error(`${label} resource ${reference.resources[index].id} drifted`);
      }
    }
  }

  async function captureDirtyRegionReadback() {
    requireStorageTier("dirty-region readback");
    const dirtyRegion = Object.freeze({ x: 71, y: 43, width: 257, height: 181 });
    const stressSeed = (seed ^ 0x9e3779b9) >>> 0;
    const baseline = await captureStorageSnapshot();

    const repeatedTrace = await fieldSystem.dispatchFull({ seed });
    metrics.computeDispatchCount += repeatedTrace.dispatchTrace.length;
    const repeated = await captureStorageSnapshot();
    requireSnapshotIdentity(baseline, repeated, "same-seed repeat");

    const dirtyTrace = await fieldSystem.dispatchRegion(dirtyRegion, { seed: stressSeed });
    metrics.computeDispatchCount += dirtyTrace.dispatchTrace.length;
    const mutated = await captureStorageSnapshot();
    if (mutated.sha256 === baseline.sha256) {
      throw new Error("dirty-region stress seed did not change storage");
    }

    const mipRegions = propagateDirtyRegion(dirtyRegion, fieldSystem.resources.mipExtents);
    const comparisons = baseline.resources.map((beforeResource, index) => {
      const afterResource = mutated.resources[index];
      if (afterResource.id !== beforeResource.id) {
        throw new Error("field storage snapshot resource order drifted");
      }
      const levelMatch = /^packed-mip-(\d+)$/.exec(beforeResource.id);
      const allowedRegion = levelMatch ? mipRegions[Number(levelMatch[1])] : dirtyRegion;
      const comparison = compareFieldStorageMutation({
        before: beforeResource.raw.tight,
        after: afterResource.raw.tight,
        width: beforeResource.extent.width,
        height: beforeResource.extent.height,
        allowedRegion,
      });
      validateFieldStorageConfinement(comparison);
      return {
        id: beforeResource.id,
        extent: beforeResource.extent,
        beforeSha256: beforeResource.raw.tightSha256,
        afterSha256: afterResource.raw.tightSha256,
        ...comparison,
      };
    });

    const restoreTrace = await fieldSystem.dispatchFull({ seed });
    metrics.computeDispatchCount += restoreTrace.dispatchTrace.length;
    const restored = await captureStorageSnapshot();
    requireSnapshotIdentity(baseline, restored, "canonical restore");

    const resources = fieldSystem.describeResources();
    return {
      schemaVersion: 2,
      contract: {
        path: "bitwise-full-storage-before-after-dirty-update",
        sameSeedBitwiseStable: true,
        stressSeedHashDistinct: true,
        dirtyRegionExecutionValidated: true,
        dependentMipConfinementValidated: true,
        canonicalRestoreBitwiseStable: true,
        performanceMeasured: false,
        productionReady: false,
      },
      renderer: {
        threePackageVersion: THREE_PACKAGE_VERSION,
        threeRevision: REVISION,
        isWebGPUBackend: true,
      },
      extent: { width: fieldSystem.resources.width, height: fieldSystem.resources.height },
      canonicalSeed: seed,
      stressSeed,
      dirtyRegion,
      baselineSha256: baseline.sha256,
      repeatedSha256: repeated.sha256,
      mutatedSha256: mutated.sha256,
      restoredSha256: restored.sha256,
      comparisons,
      dirtyDispatchTrace: dirtyTrace.dispatchTrace,
      repeatedDispatchTrace: repeatedTrace.dispatchTrace,
      restoreDispatchTrace: restoreTrace.dispatchTrace,
      resourceLedger: resources.resourceLedger,
      dispatchTotals: resources.dispatchTotals,
    };
  }

  function describeResources() {
    const physicalWidth = Math.ceil(width * dpr);
    const physicalHeight = Math.ceil(height * dpr);
    const commonEntries = [
      {
        id: "display-evidence-target",
        kind: "render-target",
        format: "rgba8unorm",
        extent: { width: physicalWidth, height: physicalHeight },
        bytesPerTexel: 4,
        bytes: physicalWidth * physicalHeight * 4,
        scope: "resident-common",
        residency: "resident",
        ownership: "lab-owned",
      },
      {
        id: "raw-probe-target",
        kind: "render-target",
        format: "rgba32float",
        extent: { width: 1, height: 1 },
        bytesPerTexel: 16,
        bytes: 16,
        scope: "resident-common",
        residency: "resident",
        ownership: "lab-owned",
      },
      {
        id: "display-readback-request",
        kind: "readback-request",
        rowBytes: physicalWidth * 4,
        alignedBytesPerRow: Math.ceil(physicalWidth * 4 / 256) * 256,
        rowCount: physicalHeight,
        bytes: Math.ceil(physicalWidth * 4 / 256) * 256 * physicalHeight,
        scope: "transient-display-readback",
        residency: "transient",
        ownership: "capture-request",
      },
      {
        id: "display-normalized-rgba",
        kind: "cpu-buffer",
        elementCount: physicalWidth * physicalHeight * 4,
        bytesPerElement: 1,
        bytes: physicalWidth * physicalHeight * 4,
        scope: "transient-display-readback",
        residency: "transient",
        ownership: "lab-owned",
      },
      {
        id: "probe-readback-request",
        kind: "readback-request",
        rowBytes: 16,
        alignedBytesPerRow: 256,
        rowCount: 1,
        bytes: 256,
        scope: "transient-single-probe-readback",
        residency: "transient",
        ownership: "capture-request",
      },
      {
        id: "probe-normalized-rgba32float",
        kind: "cpu-buffer",
        elementCount: 4,
        bytesPerElement: 4,
        bytes: 16,
        scope: "transient-single-probe-readback",
        residency: "transient",
        ownership: "lab-owned",
      },
    ];
    let tierEntries = [];
    if (tier === "gpu-storage") {
      const fieldLedger = fieldSystem.describeResources().resourceLedger;
      tierEntries = [
        ...fieldLedger.resources,
        ...[
          "coordinates",
          "seeds",
          "jacobian-0",
          "jacobian-1",
          "jacobian-2",
          "packed-output",
          "derived-output",
          "gradient-output",
        ].map((id) => ({
          id: `probe-corpus-${id}`,
          kind: "storage-buffer",
          format: id === "seeds" ? "uvec4u32" : "vec4f32",
          elementCount: FIELD_PROBE_CORPUS_COUNTS.total,
          itemSize: 4,
          bytesPerElement: 4,
          bytes: FIELD_PROBE_CORPUS_COUNTS.total * 16,
          scope: "transient-probe-corpus",
          residency: "transient",
          ownership: "lab-owned",
        })),
        {
          id: "storage-readback-request",
          kind: "readback-request",
          rowBytes: FIELD_EXTENT.width * 8,
          alignedBytesPerRow: Math.ceil(FIELD_EXTENT.width * 8 / 256) * 256,
          rowCount: FIELD_EXTENT.height,
          bytes: Math.ceil(FIELD_EXTENT.width * 8 / 256) * 256 * FIELD_EXTENT.height,
          scope: "transient-storage-readback",
          residency: "transient",
          ownership: "capture-request",
        },
        {
          id: "storage-normalized-rgba16float",
          kind: "cpu-buffer",
          elementCount: FIELD_EXTENT.width * FIELD_EXTENT.height * 4,
          bytesPerElement: 2,
          bytes: FIELD_EXTENT.width * FIELD_EXTENT.height * 8,
          scope: "transient-storage-readback",
          residency: "transient",
          ownership: "lab-owned",
        },
      ];
    } else if (tier === "precomputed-minimum") {
      tierEntries = [{
        id: "precomputed-field-texture",
        kind: "sampled-texture",
        format: "rgba8unorm",
        mipExtents: precomputedAsset.mipExtents,
        bytesPerTexel: precomputedAsset.channels,
        bytes: precomputedAsset.decodedMipChainBytes,
        scope: "resident-tier",
        residency: "resident",
        ownership: "lab-owned",
      }];
    }
    const completeResourceLedger = createScopedFieldResourceLedger([
      ...commonEntries,
      ...tierEntries,
    ]);
    const common = {
      probeTargets: 1,
      displayTargets: 1,
      outputExtent: { width, height, dpr },
      physicalOutputExtent: { width: physicalWidth, height: physicalHeight },
      completeResourceLedger,
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
      precomputedManifestId: PRECOMPUTED_ASSET_MANIFEST.id,
      precomputedManifestVersion: PRECOMPUTED_ASSET_MANIFEST.version,
      decodedTextureBytes: precomputedAsset.decodedMipChainBytes,
      decodedBaseBytes: precomputedAsset.decodedBaseBytes,
      decodedMipChainBytes: precomputedAsset.decodedMipChainBytes,
      mipLevelCount: precomputedAsset.mipLevelCount,
      mipExtents: precomputedAsset.mipExtents,
      sourceAssetBytes: precomputedAsset.sourceByteLength,
      sourceAssetSha256: precomputedAsset.sha256,
      seed,
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
      causeGraph,
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
      runtimeProfile,
      performanceTimestampMode: timestampQueriesRequested ? "auto" : "disabled",
      timestampQueriesRequired: timestampQueriesRequested,
      timestampQueriesRequested,
      timestampQueriesActive,
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
      rebuildDisplayGraph();
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
        labId: "webgpu-field-bake",
        threePackageVersion: THREE_PACKAGE_VERSION,
        threeRevision: REVISION,
        ...metrics,
        scenario,
        tier,
        mode,
        camera: cameraId,
        seed,
        timeSeconds,
        nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
        backend: renderer.backend?.isWebGPUBackend === true ? "webgpu" : "unknown",
        rendererBackend: "WebGPUBackend",
        rendererType: "WebGPURenderer",
        initialized: true,
        runtimeProfile,
        performanceTimestampMode: timestampQueriesRequested ? "auto" : "disabled",
        timestampQueriesRequired: timestampQueriesRequested,
        timestampQueriesRequested,
        timestampQueriesActive,
        rendererBackendEvidence: rendererBackendEvidence(),
        rendererDeviceStatus,
        rendererDeviceGeneration,
        deviceLossGeneration,
        deviceLossDetails,
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
      for (const material of allProbeMaterials) material.dispose();
      disposingRenderer = true;
      renderer.dispose();
    },
    captureFieldReadback,
    captureStoredReadback,
    capturePlacementReadback,
    captureProbeCorpusReadback,
    captureDirtyRegionReadback,
  };

  await configureTierResources(lockedTier);
  setStatus("compiling field presentation graph");
  await controller.ready();
  return controller;
}

globalThis.__fieldBakeValidation = { ready: false, error: null, phase: "initializing renderer" };

createApp()
  .then((controller) => {
    const legacy = {
      ...controller,
      ready: true,
      error: null,
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
