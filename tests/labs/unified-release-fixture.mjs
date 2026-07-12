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
      gpuP95Gate: numeric(12, 'ms', 'Gated', 'fixture 60 Hz GPU stage gate'),
      deadlineMissRatioGate: numeric(0.01, 'ratio', 'Gated', 'fixture sustained cadence gate'),
      verdict: 'PASS',
    },
    'frame-trace.json': {
      schemaVersion: 2,
      summary: {
        gpuP50: numeric(7, 'ms', 'Measured', 'resolved GPU timestamp query population'),
        gpuP95: numeric(8, 'ms', 'Measured', 'resolved GPU timestamp query population'),
      },
      sustained: {
        deadlineMissRatio: numeric(0, 'ratio', 'Measured', 'fixture sustained cadence population'),
        warmupSamples: numeric(120, 'frames', 'Measured', 'excluded fixture warmup population'),
        measuredSamples: numeric(600, 'frames', 'Measured', 'fixture sustained cadence population'),
      },
      verdict: 'PASS',
    },
    'quality-governor.json': {
      schemaVersion: 2,
      hysteresis: {
        downshiftDwell: numeric(0.25, 'seconds', 'Authored', 'fixture governor contract'),
        upshiftDwell: numeric(1.5, 'seconds', 'Authored', 'fixture governor contract'),
        cooldown: numeric(1, 'seconds', 'Authored', 'fixture governor contract'),
      },
      verdict: 'PASS',
    },
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
    'leak-loop.json': {
      schemaVersion: 2,
      cycles: numeric(50, 'cycles', 'Measured', 'fixture lifecycle loop'),
      verdict: 'PASS',
    },
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
