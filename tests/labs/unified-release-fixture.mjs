import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  artifactLedgerDigest,
  canonicalSha256,
  captureSessionSetDigest,
  imageLedgerDigest,
  manifestCoreDigest,
  NORMATIVE_JSON_PATHS,
  routeStateDigest,
  STANDARD_IMAGE_PATHS,
  visualReviewDigest,
} from '../../scripts/lib/evidence-manifest-contract.mjs';
import { encodeRgbaPng } from '../../scripts/lib/png-rgba.mjs';

const imageCache = new Map();

export function fixtureSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function numeric(value, unit, label, source) {
  return { value, unit, label, source };
}

function numericArray(values, unit, label, source) {
  return { values, unit, label, source };
}

function traceSegment(cpuValues, presentationValues, source) {
  return {
    cpuSamples: numericArray(cpuValues, 'ms', 'Measured', `${source} CPU population`),
    presentationSamples: numericArray(presentationValues, 'ms', 'Measured', `${source} rAF population`),
    cpuP50: numeric(cpuValues[0], 'ms', 'Measured', `${source} CPU p50`),
    cpuP95: numeric(cpuValues[0], 'ms', 'Measured', `${source} CPU p95`),
    presentationP95: numeric(presentationValues[0], 'ms', 'Measured', `${source} presentation p95`),
    deadlineMissRatio: numeric(0, 'ratio', 'Measured', `${source} measured deadline misses`),
  };
}

function fixtureGovernor() {
  const windows = Array.from({ length: 6 }, (_, index) => {
    const gpuValue = index === 0 ? 14 : 8;
    const sceneValue = index === 0 ? 6 : 3;
    const outputValue = gpuValue - sceneValue;
    return {
      window: numeric(index, 'window', 'Measured', 'fixture governor window'),
      measuredTier: index === 0 ? 'full' : 'balanced',
      resultingTier: index === 0 ? 'balanced' : 'balanced',
      gpuSamples: numericArray(Array(30).fill(gpuValue), 'ms', 'Derived', 'fixture governor timestamp totals'),
      gpuP95: numeric(gpuValue, 'ms', 'Derived', 'fixture governor p95'),
      timestampRows: Array.from({ length: 30 }, (_, frame) => ({
        frameId: numeric(frame, 'frame', 'Measured', 'fixture governor timestamp row'),
        sceneMs: numeric(sceneValue, 'ms', 'Measured', 'fixture governor scene timestamp'),
        outputMs: numeric(outputValue, 'ms', 'Measured', 'fixture governor output timestamp'),
        totalMs: numeric(gpuValue, 'ms', 'Derived', 'fixture governor stage sum'),
      })),
      lastFrameResolveResidual: numeric(0, 'ms', 'Derived', 'fixture governor timestamp reconciliation'),
      visualError: numeric(1, 'mean-rgb-byte-difference', 'Measured', 'fixture tier comparison'),
      visualErrorGate: numeric(8, 'mean-rgb-byte-difference', 'Gated', 'fixture visual gate'),
      edgeMaskPixels: numeric(10, 'pixel', 'Measured', 'fixture nonempty edge mask'),
      edgeMeanVisualError: numeric(1, 'mean-rgb-byte-difference', 'Measured', 'fixture edge comparison'),
      edgeP95VisualError: numeric(2, 'mean-rgb-byte-difference', 'Measured', 'fixture edge comparison'),
      edgeP95VisualErrorGate: numeric(32, 'mean-rgb-byte-difference', 'Gated', 'fixture edge gate'),
      decision: index === 0 ? 'degrade' : 'hold',
      residence: numeric(index === 0 ? 0 : index, 'window', 'Measured', 'fixture residence counter'),
      cooldown: numeric(index < 2 ? 2 - index : 0, 'window', 'Measured', 'fixture cooldown counter'),
    };
  });
  return {
    schemaVersion: 2,
    enabled: true,
    states: ['full', 'balanced'],
    inputMetric: 'resolved total-render GPU timestamp p95',
    filter: '30-frame percentile window',
    target: numeric(12, 'ms', 'Gated', 'fixture 60 Hz GPU target'),
    hysteresis: numeric(2, 'ms', 'Gated', 'fixture upgrade margin'),
    minimumResidence: numeric(2, 'window', 'Gated', 'fixture transition residence'),
    cooldown: numeric(2, 'window', 'Gated', 'fixture post-transition cooldown'),
    windows,
    transitions: [{
      window: numeric(0, 'window', 'Measured', 'fixture transition record'),
      from: 'full',
      to: 'balanced',
      cause: 'gpu-p95-over-budget',
      gpuP95: numeric(14, 'ms', 'Measured', 'fixture triggering governor window'),
      rebuildCpuSubmission: numeric(2, 'ms', 'Measured', 'fixture tier rebuild CPU submission'),
      rebuildGpu: numeric(6, 'ms', 'Measured', 'fixture tier rebuild GPU timestamp'),
      rebuildTimestampRow: {
        sceneMs: numeric(2, 'ms', 'Measured', 'fixture rebuild scene timestamp'),
        outputMs: numeric(4, 'ms', 'Measured', 'fixture rebuild output timestamp'),
        totalMs: numeric(6, 'ms', 'Derived', 'fixture rebuild stage sum'),
      },
      lastFrameResolveResidual: numeric(0, 'ms', 'Derived', 'fixture rebuild timestamp reconciliation'),
      fromResourceBytes: numeric(16_000_000, 'byte', 'Measured', 'fixture full-tier resource ledger'),
      toResourceBytes: numeric(8_000_000, 'byte', 'Measured', 'fixture balanced-tier resource ledger'),
    }],
    finalStableGpuP95: numeric(8, 'ms', 'Measured', 'fixture final governor window'),
    finalStableVisualError: numeric(1, 'mean-rgb-byte-difference', 'Measured', 'fixture settled tier'),
    visualErrorGate: numeric(8, 'mean-rgb-byte-difference', 'Gated', 'fixture visual gate'),
    finalStableEdgeP95VisualError: numeric(2, 'mean-rgb-byte-difference', 'Measured', 'fixture settled edge domain'),
    edgeP95VisualErrorGate: numeric(32, 'mean-rgb-byte-difference', 'Gated', 'fixture edge gate'),
    settledState: 'balanced',
    oscillationDetected: false,
    verdict: 'PASS',
  };
}

function fixtureLeakLoop() {
  const cycleSnapshots = Array.from({ length: 50 }, (_, index) => ({
    rowType: 'settled-lifecycle-cycle-v2',
    cycle: numeric(index, 'cycle', 'Measured', 'fixture lifecycle runner'),
    beforeRendererBytes: numeric(1000, 'byte', 'Measured', 'fixture pre-dispose renderer bytes'),
    afterRendererBytes: numeric(0, 'byte', 'Measured', 'fixture post-dispose renderer bytes'),
    targetBytes: numeric(800, 'byte', 'Measured', 'fixture pre-dispose targets'),
    storageBytes: numeric(200, 'byte', 'Measured', 'fixture pre-dispose storage'),
    retainedTargetBytes: numeric(0, 'byte', 'Measured', 'fixture settled target inventory'),
    retainedStorageBytes: numeric(0, 'byte', 'Measured', 'fixture settled storage inventory'),
    retainedListenerCount: numeric(0, 'listener', 'Measured', 'fixture settled listener registry'),
    retainedControlCount: numeric(0, 'control', 'Measured', 'fixture settled control registry'),
    retainedMaterialCount: numeric(0, 'material', 'Measured', 'fixture settled material registry'),
    postDisposeErrorCount: numeric(0, 'error', 'Measured', 'fixture post-disposal observation'),
    rendererStateRestored: true,
    deviceLossObserved: false,
    settleAnimationFrames: numeric(2, 'frame', 'Measured', 'fixture post-disposal observation'),
    disposeStatus: 'PASS',
  }));
  return {
    schemaVersion: 2,
    operations: ['create', 'resize', 'change mode', 'change tier', 'dispose'],
    cycles: numeric(50, 'cycle', 'Measured', 'fixture lifecycle loop'),
    before: {
      targetBytes: numeric(800, 'byte', 'Measured', 'fixture pre-dispose maximum'),
      storageBytes: numeric(200, 'byte', 'Measured', 'fixture pre-dispose maximum'),
    },
    after: {
      targetBytes: numeric(0, 'byte', 'Measured', 'fixture settled target inventory'),
      storageBytes: numeric(0, 'byte', 'Measured', 'fixture settled storage inventory'),
    },
    trend: {
      targetBytesPerCycle: numeric(0, 'byte/cycle', 'Measured', 'recomputed retained target slope'),
      storageBytesPerCycle: numeric(0, 'byte/cycle', 'Measured', 'recomputed retained storage slope'),
    },
    gates: {
      targetBytes: numeric(0, 'byte', 'Gated', 'fixture retained target gate'),
      storageBytes: numeric(0, 'byte', 'Gated', 'fixture retained storage gate'),
    },
    allowedCachePlateaus: [],
    deviceErrors: [],
    verdict: 'PASS',
    cycleSnapshots,
  };
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function writeBytes(directory, relativePath, bytes) {
  const outputPath = join(directory, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return {
    sha256: fixtureSha256(bytes),
    byteLength: bytes.byteLength,
  };
}

function selfManifestFile() {
  return {
    path: 'evidence-manifest.json',
    status: 'self-excluded',
    kind: 'evidence-manifest',
    reason: 'The manifest cannot bind its own final serialized bytes.',
  };
}

function releaseRoute() {
  const route = {
    path: '/demos/webgpu-validation-harness/tier/release/',
    scenario: 'browser-capture',
    mechanism: null,
    mode: 'final',
    tier: 'release',
    camera: 'design',
    seed: '0x00000001',
    timeSeconds: numeric(2, 'seconds', 'Authored', 'release fixture visual contract'),
  };
  route.stateDigest = routeStateDigest(route);
  return route;
}

function normativeArtifacts() {
  return {
    'visual-contract.json': {
      schemaVersion: 2,
      width: numeric(1200, 'pixels', 'Authored', 'correctness capture contract'),
      height: numeric(800, 'pixels', 'Authored', 'correctness capture contract'),
      dpr: numeric(1, 'ratio', 'Authored', 'correctness capture contract'),
      verdict: 'PASS',
    },
    'renderer-info.json': {
      schemaVersion: 2,
      renderer: 'WebGPURenderer',
      backend: { isWebGPUBackend: true },
      threeRevision: '0.185.1',
      verdict: 'PASS',
    },
    'pipeline-graph.json': {
      schemaVersion: 2,
      owners: {
        renderer: 'renderer-owner',
        renderPipeline: 'pipeline-owner',
        toneMap: 'output-owner',
        outputTransform: 'output-owner',
      },
      signals: [{
        id: 'sceneLinearHDR',
        producer: 'scene-pass',
        consumers: ['present-pass'],
        reachable: true,
        encoding: 'scene-linear-hdr',
      }],
      sceneSubmissions: [
        { id: 'scene-pass', owner: 'pipeline-owner', kind: 'lit-scene' },
        { id: 'present-pass', owner: 'output-owner', kind: 'present' },
      ],
      computeDispatches: [],
      resources: [{
        id: 'scene-color',
        owner: 'pipeline-owner',
        kind: 'render-target',
        residentBytes: numeric(7_680_000, 'bytes', 'Derived', '1200x800 RGBA16F fixture target'),
      }],
      finalToneMapOwner: 'output-owner',
      finalOutputTransformOwner: 'output-owner',
    },
    'performance-envelope.json': {
      schemaVersion: 2,
      gpuTimingRequirement: 'required',
      refreshPeriod: numeric(16, 'ms', 'Derived', 'fixture refresh period'),
      browserMainThreadReserve: numeric(1, 'ms', 'Authored', 'fixture envelope'),
      compositorGpuReserve: numeric(1, 'ms', 'Authored', 'fixture envelope'),
      cpuSafetyReserve: numeric(1, 'ms', 'Authored', 'fixture envelope'),
      gpuSafetyReserve: numeric(1, 'ms', 'Authored', 'fixture envelope'),
      cpuSceneEnvelope: numeric(15, 'ms', 'Derived', 'refresh period minus reserve'),
      gpuSceneEnvelope: numeric(15, 'ms', 'Derived', 'refresh period minus reserve'),
      cpuP95Gate: numeric(12, 'ms', 'Gated', 'fixture 60 Hz CPU stage gate'),
      gpuP95Gate: numeric(12, 'ms', 'Gated', 'fixture 60 Hz GPU stage gate'),
      deadlineMissRatioGate: numeric(0.01, 'ratio', 'Gated', 'fixture sustained cadence gate'),
      verdict: 'PASS',
    },
    'frame-trace.json': {
      schemaVersion: 2,
      clockSource: 'performance.now around RenderPipeline.render calls',
      warmup: traceSegment(Array(30).fill(1), [8], 'fixture warmup'),
      cold: traceSegment([2], [8], 'fixture cold frame'),
      sustained: traceSegment(Array(120).fill(2), Array(120).fill(8), 'fixture sustained trace'),
      gpuTimingAvailable: true,
      renderTimestamp: numeric(7, 'ms', 'Measured', 'sustained WebGPU render timestamp p95'),
      computeTimestamp: null,
      presentationCadence: numeric(125, 'frame/s', 'Measured', 'inverse measured requestAnimationFrame interval p50'),
      sampleFrames: numeric(120, 'frame', 'Measured', 'fixture sustained batch population'),
      timestampResolveCount: numeric(4, 'resolve', 'Measured', 'fixture batched timestamp resolves'),
      timestampMappingCadence: 'mapping deferred until each 30-frame batch completes',
      gpuSamples: numericArray(Array(120).fill(7), 'ms', 'Derived', 'sum of attributed timestamp stages'),
      gpuP50: numeric(7, 'ms', 'Derived', 'p50 of fixture GPU timestamp totals'),
      gpuP95: numeric(7, 'ms', 'Derived', 'p95 of fixture GPU timestamp totals'),
      gpuStageAttribution: {
        'scene-mrt': {
          samples: numericArray(Array(120).fill(3), 'ms', 'Measured', 'fixture scene timestamps'),
          p50: numeric(3, 'ms', 'Derived', 'fixture scene timestamp p50'),
          p95: numeric(3, 'ms', 'Derived', 'fixture scene timestamp p95'),
        },
        'final-output': {
          samples: numericArray(Array(120).fill(4), 'ms', 'Measured', 'fixture output timestamps'),
          p50: numeric(4, 'ms', 'Derived', 'fixture output timestamp p50'),
          p95: numeric(4, 'ms', 'Derived', 'fixture output timestamp p95'),
        },
        lastFrameResolveResidual: numeric(0, 'ms', 'Derived', 'fixture final timestamp reconciliation'),
        reconciliationGate: numeric(0.001, 'ms', 'Gated', 'fixture reconciliation gate'),
        reconciliationScope: 'sum of every declared timestamp stage per sustained frame',
        independentPerFrameTotalsAvailable: false,
        verdict: 'PASS',
      },
      excludedPhases: ['renderer initialization', 'pipeline compilation', 'PNG encoding'],
      verdict: 'PASS',
    },
    'quality-governor.json': fixtureGovernor(),
    'render-targets.json': {
      schemaVersion: 2,
      readbacks: [{
        id: 'final',
        width: numeric(1200, 'pixels', 'Measured', 'fixture retained readback'),
        height: numeric(800, 'pixels', 'Measured', 'fixture retained readback'),
        bytesPerRow: numeric(4864, 'bytes', 'Derived', '256-byte aligned RGBA8 row stride'),
      }],
      verdict: 'PASS',
    },
    'storage-resources.json': { schemaVersion: 2, verdict: 'PASS' },
    'resident-resources.json': { schemaVersion: 2, verdict: 'PASS' },
    'bandwidth-model.json': { schemaVersion: 2, verdict: 'PASS' },
    'visual-errors.json': { schemaVersion: 2, verdict: 'PASS' },
    'leak-loop.json': fixtureLeakLoop(),
    'mechanism-metrics.json': { schemaVersion: 2, verdict: 'PASS' },
  };
}

function writeNormativeFiles(directory) {
  const artifacts = normativeArtifacts();
  return NORMATIVE_JSON_PATHS
    .filter((relativePath) => relativePath !== 'evidence-manifest.json')
    .map((relativePath) => {
      const bytes = jsonBytes(artifacts[relativePath]);
      return {
        path: relativePath,
        status: 'captured',
        kind: 'normative-json',
        ...writeBytes(directory, relativePath, bytes),
      };
    });
}

function writeSessionFiles(directory, profile) {
  const documentPath = `sessions/${profile}.capture-session.json`;
  const ledgerPath = `sessions/${profile}.write-ledger.json`;
  const document = writeBytes(directory, documentPath, jsonBytes({ schemaVersion: 2, profile }));
  const writeLedger = writeBytes(directory, ledgerPath, jsonBytes({ schemaVersion: 2, profile, sealed: true }));
  return {
    document: {
      kind: 'capture-session-document',
      path: documentPath,
      ...document,
    },
    writeLedger: {
      kind: 'capture-session-write-ledger',
      path: ledgerPath,
      ...writeLedger,
    },
    files: [
      {
        path: documentPath,
        status: 'captured',
        kind: 'capture-session-document',
        ...document,
      },
      {
        path: ledgerPath,
        status: 'captured',
        kind: 'capture-session-write-ledger',
        ...writeLedger,
      },
    ],
  };
}

function captureSession(profile, route, sourceClosureHash, buildRevision, refs) {
  const physical = profile !== 'correctness';
  const physicalHash = (label) => canonicalSha256({ label: `physical-${label}` });
  const correctnessHash = (label) => canonicalSha256({ label: `correctness-${label}` });
  const identityHash = physical ? physicalHash : correctnessHash;
  return {
    sessionId: `webgpu-validation-harness:${profile}:fixture-release`,
    profile,
    automationSurface: physical ? 'codex-in-app-browser' : 'playwright-headless-chromium',
    adapterClass: 'hardware',
    adapterIdentity: { kind: 'gpu-adapter', digest: identityHash('adapter') },
    deviceIdentity: { kind: 'gpu-device', digest: identityHash('device') },
    browserIdentity: { kind: 'browser', digest: identityHash('browser') },
    osIdentity: { kind: 'operating-system', digest: identityHash('os') },
    refreshIdentity: { kind: 'display-refresh', digest: identityHash('refresh') },
    colorIdentity: { kind: 'color-pipeline', digest: identityHash('color') },
    limitationsDigest: identityHash('limitations'),
    threeRevision: '0.185.1',
    sourceClosureHash,
    buildRevision,
    startedAt: '2026-07-12T12:00:00Z',
    finishedAt: '2026-07-12T12:01:00Z',
    routePath: route.path,
    routeDigest: canonicalSha256(route),
    stateDigest: route.stateDigest,
    document: refs.document,
    writeLedger: refs.writeLedger,
    rendererInitialized: true,
    isWebGPUBackend: true,
    timestampQuerySupported: profile === 'performance',
  };
}

function imageBytes(marker) {
  if (imageCache.has(marker)) return imageCache.get(marker);
  const width = 1200;
  const height = 800;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x + marker * 19) & 0xff;
      data[offset + 1] = (y + marker * 31) & 0xff;
      data[offset + 2] = ((x >> 3) ^ (y >> 2) ^ (marker * 7)) & 0xff;
      data[offset + 3] = 255;
    }
  }
  const bytes = encodeRgbaPng({ width, height, data });
  imageCache.set(marker, bytes);
  return bytes;
}

export function fixtureImageBytes(marker) {
  return imageBytes(marker);
}

function writeImages(directory) {
  return STANDARD_IMAGE_PATHS.map((relativePath, index) => {
    const bytes = imageBytes(index + 1);
    return {
      path: relativePath,
      status: 'captured',
      kind: 'direct-capture',
      role: relativePath.slice(0, -'.png'.length),
      mediaType: 'image/png',
      ...writeBytes(directory, relativePath, bytes),
    };
  });
}

export function rebindFixturePromotion(manifest) {
  const binding = {
    manifestCoreDigest: manifestCoreDigest(manifest),
    sourceClosureHash: manifest.sourceClosureHash,
    buildRevision: manifest.buildRevision,
    threeRevision: manifest.threeRevision,
    route: structuredClone(manifest.route),
    routeDigest: canonicalSha256(manifest.route),
    limitations: structuredClone(manifest.limitations),
    limitationsDigest: canonicalSha256(manifest.limitations),
    claimVerdicts: structuredClone(manifest.claimVerdicts),
    claimVerdictsDigest: canonicalSha256(manifest.claimVerdicts),
    captureSessions: structuredClone(manifest.captureSessions),
    captureSessionSetDigest: captureSessionSetDigest(manifest.captureSessions),
    artifactLedgerDigest: artifactLedgerDigest(manifest.files),
    imageLedgerDigest: imageLedgerDigest(manifest.images),
  };
  const visualSignoff = {
    status: 'APPROVED',
    reviewer: 'fixture-graphics-reviewer',
    reviewedAt: '2026-07-12T12:02:00Z',
    reviewedImages: manifest.images
      .filter((image) => image.status === 'captured')
      .map((image) => image.path),
    notes: ['Fixture review binds every captured standard image by path.'],
  };
  visualSignoff.reviewDigest = visualReviewDigest(visualSignoff);
  manifest.promotion = {
    status: 'APPROVED',
    binding,
    bindingDigest: canonicalSha256(binding),
    visualSignoff,
  };
  return manifest;
}

export function readFixtureManifest(directory) {
  return JSON.parse(readFileSync(join(directory, 'evidence-manifest.json'), 'utf8'));
}

export function writeFixtureManifest(directory, manifest) {
  writeFileSync(join(directory, 'evidence-manifest.json'), jsonBytes(manifest));
}

export function rewriteBoundFixtureJson(directory, relativePath, mutate) {
  const artifactPath = join(directory, relativePath);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  mutate(artifact);
  const bytes = jsonBytes(artifact);
  writeFileSync(artifactPath, bytes);
  const manifest = readFixtureManifest(directory);
  const entry = manifest.files.find((file) => file.path === relativePath);
  entry.sha256 = fixtureSha256(bytes);
  entry.byteLength = bytes.byteLength;
  rebindFixturePromotion(manifest);
  writeFixtureManifest(directory, manifest);
}

export function rewriteBoundFixtureImage(directory, relativePath, bytes) {
  writeFileSync(join(directory, relativePath), bytes);
  const manifest = readFixtureManifest(directory);
  const entry = manifest.images.find((image) => image.path === relativePath);
  entry.sha256 = fixtureSha256(bytes);
  entry.byteLength = bytes.byteLength;
  rebindFixturePromotion(manifest);
  writeFixtureManifest(directory, manifest);
}

export function createUnifiedReleaseBundleFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'threejs-unified-release-v2-'));
  const route = releaseRoute();
  const sourceClosureHash = canonicalSha256({ source: 'release fixture source closure' });
  const buildRevision = canonicalSha256({ build: 'release fixture revision' });
  const profiles = ['correctness', 'physical-route', 'performance'];
  const sessionData = profiles.map((profile) => {
    const refs = writeSessionFiles(directory, profile);
    return {
      session: captureSession(profile, route, sourceClosureHash, buildRevision, refs),
      files: refs.files,
    };
  });
  const normativeFiles = writeNormativeFiles(directory);
  const manifest = {
    schemaVersion: 2,
    labId: 'webgpu-validation-harness',
    bundleId: 'webgpu-validation-harness:release:fixture:v2',
    bundleKind: 'release-bundle',
    publishable: true,
    skill: 'threejs-visual-validation',
    threeRevision: '0.185.1',
    sourceClosureHash,
    buildRevision,
    route,
    limitations: [],
    claimVerdicts: {
      visualCorrectness: 'PASS',
      mechanismCorrectness: 'PASS',
      performanceCompliance: 'PASS',
      gpuAttribution: 'PASS',
      lifecycleStability: 'PASS',
      visualError: 'PASS',
    },
    captureSessions: sessionData.map(({ session }) => session),
    files: [
      normativeFiles[0],
      selfManifestFile(),
      ...normativeFiles.slice(1),
      ...sessionData.flatMap(({ files }) => files),
    ],
    images: writeImages(directory),
    promotion: null,
  };
  rebindFixturePromotion(manifest);
  writeFixtureManifest(directory, manifest);
  return directory;
}
