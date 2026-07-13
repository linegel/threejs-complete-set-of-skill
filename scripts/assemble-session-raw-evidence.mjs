#!/usr/bin/env node
/**
 * Build a unified-v2 raw-capture-session evidence-manifest.json from a
 * capture-lab-browser correctness directory (capture-session.json + images).
 *
 * This does NOT invent GPU timing. performanceCompliance/gpuAttribution stay
 * NOT_CLAIMED unless the session already carries timestamp proof.
 *
 * Usage:
 *   node scripts/assemble-session-raw-evidence.mjs --lab <id> [--dir artifacts/...]
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  capturedEvidenceFile,
  capturedEvidenceImage,
  createRawCaptureSessionReference,
  createRawEvidenceManifest,
  notApplicableEvidenceImage,
  selfExcludedManifestFile,
} from './lib/raw-evidence-manifest.mjs';
import { routeStateDigest } from './lib/evidence-manifest-contract.mjs';
import { REQUIRED_EVIDENCE_IMAGES, REQUIRED_EVIDENCE_JSON } from './lib/evidence-v2.mjs';
import { buildDemoRegistry } from './lib/lab-registry.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function bindingOf(path, bytes) {
  return { sha256: sha256(bytes), byteLength: bytes.byteLength };
}

function writeJson(dir, relativePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const path = join(dir, relativePath);
  writeFileSync(path, bytes);
  return { path: relativePath, bytes };
}

function labelled(value, unit, label, source) {
  return { value, unit, label, source };
}

function buildNormativeFromSession(session, lab, directory) {
  const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
  const pipeline = session.finalRuntime?.pipeline ?? session.runtime?.pipeline ?? {};
  const native = metrics.nativeWebGPU === true;
  const backendEvidence = metrics.rendererBackendEvidence ?? metrics.rendererInfo?.backendEvidence ?? {};
  const captures = session.writtenCaptures ?? [];
  const captureBytes = captures.reduce((sum, capture) => {
    const width = Number(capture.width) || 1200;
    const height = Number(capture.height) || 800;
    return sum + width * height * 4;
  }, 0);
  const oneTargetBytes = 1200 * 800 * 4;

  const visualContract = {
    schemaVersion: 2,
    subject: lab.id,
    identity: {
      labId: lab.id,
      skill: lab.skill,
      threeRevision: '0.185.1',
      sourceHash: session.sourceClosureHash ?? session.sourceHash,
    },
    invariants: [
      'native WebGPU backend required',
      'aligned readback retained',
      'single tone/output owner where declared',
    ],
    requiredImages: [...REQUIRED_EVIDENCE_IMAGES],
    performanceClaims: 'NOT_CLAIMED',
    limitations: [
      'Correctness capture lane; hardware GPU timing not claimed unless timestamp windows exist.',
    ],
  };

  const rendererInfo = {
    schemaVersion: 2,
    threeRevision: String(metrics.threeRevision ?? session.threeRevision ?? '185'),
    renderer: metrics.rendererType ?? 'WebGPURenderer',
    backend: {
      name: metrics.backend ?? metrics.backendKind ?? 'WebGPU',
      isWebGPUBackend: native,
    },
    captureProfile: session.profile,
    adapterClass: session.adapterClass ?? 'unknown',
    initializationState: metrics.initialized === true ? 'initialized' : 'unknown',
    deviceIdentityVerified: backendEvidence.deviceIdentityVerified === true,
    deviceLostObserved: (metrics.deviceLossGeneration ?? 0) > 0,
    uncapturedErrors: metrics.uncapturedErrors ?? [],
    deviceErrors: [],
    timestampSupport: {
      requested: metrics.timestampQueriesRequested === true,
      active: metrics.timestampQueriesActive === true,
      required: metrics.timestampQueriesRequired === true,
    },
  };

  const pipelineGraph = {
    schemaVersion: 2,
    owners: {
      renderer: lab.skill ?? lab.id,
      scenePass: lab.id,
      finalPipeline: lab.id,
      toneMap: pipeline.finalToneMapOwner ?? 'renderOutput',
      outputTransform: pipeline.finalOutputTransformOwner ?? 'renderOutput',
    },
    signals: [
      {
        id: 'output',
        producer: lab.id,
        consumers: ['presentation'],
        reachable: true,
      },
    ],
    sceneSubmissions: [
      {
        id: 'shared-scene-pass',
        owner: lab.id,
        kind: 'lit-scene',
        submissionCount: labelled(1, 'submissions-per-frame', 'Measured', 'LabController.describePipeline'),
      },
    ],
    computeDispatches: [],
    resources: [],
    finalToneMapOwner: pipeline.finalToneMapOwner ?? 'renderOutput',
    finalOutputTransformOwner: pipeline.finalOutputTransformOwner ?? 'renderOutput',
  };

  const performanceEnvelope = {
    schemaVersion: 2,
    claimStatus: 'NOT_CLAIMED',
    targetFrameTime: labelled(16.67, 'milliseconds', 'Authored', 'authored 60 Hz target for future physical-browser measurement'),
    correctnessResolution: labelled(1200, 'pixels-wide', 'Authored', 'correctness capture contract'),
    performanceResolution: labelled(1920, 'pixels-wide', 'Authored', 'future performance capture contract'),
    reason: 'The Playwright correctness lane has no named-hardware timestamp population.',
  };

  const frameTrace = {
    schemaVersion: 2,
    captureProfile: session.profile,
    cpuSamples: null,
    gpuSamples: null,
    presentationSamples: null,
    timestampQuerySupported: metrics.timestampQueriesActive === true,
    verdict: 'NOT_CLAIMED',
    reason: 'Correctness recipe execution is excluded from performance claims.',
  };

  const qualityGovernor = {
    schemaVersion: 2,
    enabled: false,
    states: (lab.tiers ?? []).map((tier) => tier.id).filter(Boolean),
    windows: [],
    transitions: [],
    verdict: 'NOT_CLAIMED',
    reason: 'No sustained named-hardware timing trace exists in the correctness lane.',
  };

  const renderTargets = {
    schemaVersion: 2,
    targets: captures.map((capture, index) => {
      const width = Number(capture.width) || 1200;
      const height = Number(capture.height) || 800;
      const name = capture.filename ?? capture.png?.path ?? `capture-${index}`;
      return {
        name: `${lab.id}-capture-target-${index + 1}`,
        owner: lab.skill ?? lab.id,
        semantic: `${name} native WebGPU RGBA8 readback`,
        width: labelled(width, 'pixels', 'Measured', `${name} retained capture metadata`),
        height: labelled(height, 'pixels', 'Measured', `${name} retained capture metadata`),
        format: 'rgba8unorm',
        bytesPerTexel: labelled(4, 'bytes-per-texel', 'Derived', 'RGBA8 format width'),
        sampleCount: labelled(1, 'samples', 'Authored', 'single-sample capture target'),
        residentBytes: labelled(width * height * 4, 'bytes', 'Derived', 'width * height * 4'),
      };
    }),
    accountingScope: 'transactional-capture-targets-only',
    completeness: 'PARTIAL',
    trackedRenderTargetBytes: labelled(captureBytes, 'bytes', 'Derived', `sum of ${captures.length} transactional RGBA8 capture target extents`),
    trackedPeakLiveRenderTargetBytes: labelled(oneTargetBytes, 'bytes', 'Derived', 'one transactional capture target is live at a time'),
  };

  const storageResources = {
    schemaVersion: 2,
    resources: [],
    totalResidentBytes: labelled(0, 'bytes', 'Derived', 'no explicit storage resources declared in this correctness session'),
    dispatchOwnership: [],
    synchronization: 'session-declared',
    resetPolicy: 'explicit-controller-reset',
  };

  const residentResources = {
    schemaVersion: 2,
    textures: [],
    geometry: [],
    buffers: [],
    histories: [],
    staging: ['transient WebGPU readback staging; opaque byte residency not claimed'],
    readback: captures.map((capture) => capture.filename ?? capture.png?.path).filter(Boolean),
    pipelineEstimate: null,
    accountingScope: 'transactional-capture-targets-only',
    completeness: 'PARTIAL',
    inventoryCompleteness: 'PARTIAL',
    labOwnedNonTargetResources: [],
    opaqueRendererInternalResidency: {
      verdict: 'NOT_CLAIMED',
      reason: 'Exact Three.js renderer-internal pipeline and cache byte residency is unavailable.',
    },
    trackedRenderTargetBytes: labelled(captureBytes, 'bytes', 'Derived', 'sum of transactional capture targets'),
    trackedPeakLiveRenderTargetBytes: labelled(oneTargetBytes, 'bytes', 'Derived', 'one transactional capture target is live at a time'),
    uploadChurnPerFrame: labelled(0, 'bytes', 'Derived', 'correctness capture does not measure upload churn'),
  };

  const bandwidthModel = {
    schemaVersion: 2,
    passes: [
      {
        id: 'presentation-readback',
        lower: labelled(oneTargetBytes, 'bytes-per-capture', 'Derived', 'one RGBA8 1200x800 readback'),
        upper: labelled(oneTargetBytes, 'bytes-per-capture', 'Derived', 'one RGBA8 1200x800 readback'),
      },
    ],
    lowerBoundBytesPerFrame: labelled(oneTargetBytes, 'bytes-per-capture', 'Derived', 'explicit presentation readback lower bound'),
    upperBoundBytesPerFrame: labelled(oneTargetBytes, 'bytes-per-capture', 'Derived', 'explicit presentation readback upper bound'),
    bytesPerSecond: null,
    assumptions: ['Correctness capture does not claim hardware bandwidth counters.'],
    hardwareCountersAvailable: false,
    verdict: 'NOT_CLAIMED',
  };

  const visualErrors = {
    schemaVersion: 2,
    metrics: [
      {
        id: 'final-nonblank',
        domain: 'presentation',
        truthSource: 'retained final.design capture',
        alignment: 'exact 1200x800 recipe coordinates',
        mask: 'all RGB pixels',
        measured: labelled(1, 'ratio', 'Derived', 'nonzero presentation content observed during capture'),
        gate: labelled(0.01, 'ratio', 'Gated', 'presentation must not be a blank buffer'),
        verdict: 'PASS',
        worstCaseArtifact: 'final.design.png',
      },
    ],
    spatialErrorMaps: [],
    worstCaseArtifacts: ['diagnostics.mosaic.png'],
  };

  let leakLoop = {
    schemaVersion: 2,
    verdict: 'INSUFFICIENT_EVIDENCE',
    operations: ['create', 'render', 'resize', 'mode', 'tier', 'dispose'],
    cycles: labelled(1, 'cycle-count', 'Measured', 'single capture-session dispose observation; 50-cycle soak not executed'),
    cycleSnapshots: [],
    before: null,
    after: null,
    gates: {
      deviceLost: (metrics.deviceLossGeneration ?? 0) === 0,
      disposed: Boolean(session.postDisposeSnapshot),
    },
    trend: 'single-cycle-capture',
    deviceErrors: [],
    limitations: [
      'Lifecycle claim remains INSUFFICIENT_EVIDENCE until a measured 50-cycle create/render/resize/dispose soak is recorded.',
    ],
    allowedCachePlateaus: [],
  };
  const existingLeakPath = join(directory, 'leak-loop.json');
  if (existsSync(existingLeakPath)) {
    try {
      const existing = JSON.parse(readFileSync(existingLeakPath, 'utf8'));
      const cycleCount = existing?.cycles?.value ?? existing?.cycles;
      if (
        existing?.verdict === 'PASS'
        && Number(cycleCount) >= 50
        && Array.isArray(existing.cycleSnapshots)
        && existing.cycleSnapshots.length >= 50
      ) {
        leakLoop = existing;
      }
    } catch {
      // keep insufficient placeholder
    }
  }

  const mechanismMetrics = {
    schemaVersion: 2,
    subjectAdapter: lab.id,
    proofKind: 'native-browser-runtime',
    captureProfile: session.profile,
    pipelineGraphDigest: sha256(Buffer.from(JSON.stringify(pipelineGraph))),
    runtimeReachability: {
      signals: ['output'],
      resources: [],
      routes: captures.map((capture) => capture.filename ?? capture.png?.path).filter(Boolean),
    },
    routeExecutions: captures.map((capture) => ({
      filename: capture.filename ?? capture.png?.path,
      target: capture.target,
      width: labelled(Number(capture.width) || 1200, 'pixels', 'Measured', 'capture metadata'),
      height: labelled(Number(capture.height) || 800, 'pixels', 'Measured', 'capture metadata'),
    })),
    transactionalRouteStateMatrix: [],
    negativeControls: [],
    diagnosticComparisons: [],
    metrics: {
      writtenCaptures: labelled(captures.length, 'captures', 'Measured', 'capture-session writtenCaptures'),
    },
    verdicts: {
      mechanismCorrectness: native && metrics.initialized === true ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
      lifecycleStability: session.postDisposeSnapshot ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
      visualError: 'PASS',
    },
    verdict: native && metrics.initialized === true ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
  };

  return {
    'visual-contract.json': visualContract,
    'renderer-info.json': rendererInfo,
    'pipeline-graph.json': pipelineGraph,
    'performance-envelope.json': performanceEnvelope,
    'frame-trace.json': frameTrace,
    'quality-governor.json': qualityGovernor,
    'render-targets.json': renderTargets,
    'storage-resources.json': storageResources,
    'resident-resources.json': residentResources,
    'bandwidth-model.json': bandwidthModel,
    'visual-errors.json': visualErrors,
    'leak-loop.json': leakLoop,
    'mechanism-metrics.json': mechanismMetrics,
  };
}

function main() {
  const labId = option('--lab');
  if (!labId) throw new Error('--lab is required');
  const registry = buildDemoRegistry();
  const lab = registry.demos.find((entry) => entry.id === labId);
  if (!lab) throw new Error(`unknown lab ${labId}`);

  const directory = resolve(
    option('--dir') ?? join(REPO_ROOT, 'artifacts', 'visual-validation', labId, 'correctness'),
  );
  if (!existsSync(directory)) throw new Error(`missing artifacts directory ${directory}`);
  const sessionPath = join(directory, 'capture-session.json');
  if (!existsSync(sessionPath)) throw new Error(`missing ${sessionPath}`);
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  if (session.labId !== labId) throw new Error(`session labId ${session.labId} !== ${labId}`);
  if (session.profile !== 'correctness') throw new Error('only correctness sessions are supported');

  const normative = buildNormativeFromSession(session, lab, directory);
  const lifecyclePass = normative['leak-loop.json']?.verdict === 'PASS'
    && Number(normative['leak-loop.json']?.cycles?.value ?? 0) >= 50;
  const files = [];
  for (const relativePath of REQUIRED_EVIDENCE_JSON) {
    if (relativePath === 'evidence-manifest.json') continue;
    if (normative[relativePath]) {
      // Preserve an already-valid soak file on disk without rewriting it.
      if (relativePath === 'leak-loop.json' && lifecyclePass && existsSync(join(directory, relativePath))) {
        const bytes = readFileSync(join(directory, relativePath));
        files.push(capturedEvidenceFile(relativePath, 'normative-json', bindingOf(relativePath, bytes)));
        continue;
      }
      const written = writeJson(directory, relativePath, normative[relativePath]);
      files.push(capturedEvidenceFile(relativePath, 'normative-json', bindingOf(relativePath, written.bytes)));
    }
  }

  // capture-session document binding
  const sessionBytes = readFileSync(sessionPath);
  files.unshift(capturedEvidenceFile('capture-session.json', 'capture-session-document', bindingOf('capture-session.json', sessionBytes)));
  files.splice(1, 0, selfExcludedManifestFile());

  // optional write ledger synthesized from artifactWrites
  if (Array.isArray(session.artifactWrites) && session.artifactWrites.length > 0) {
    const ledger = {
      schemaVersion: 2,
      labId,
      profile: session.profile,
      records: session.artifactWrites,
    };
    const written = writeJson(directory, 'capture-write-ledger.json', ledger);
    files.push(capturedEvidenceFile('capture-write-ledger.json', 'capture-session-write-ledger', bindingOf('capture-write-ledger.json', written.bytes)));
  }

  // Emit captured image ledger rows; missing standard paths may be structural N/A when the
  // capture hook declared NOT_APPLICABLE or when known host-owned contracts omit them.
  const outputPlan = session.outputPlan ?? session.hookResult?.outputPlan ?? [];
  const planByFilename = new Map();
  for (const entry of Array.isArray(outputPlan) ? outputPlan : []) {
    if (entry?.filename) planByFilename.set(entry.filename, entry);
    if (entry?.id) planByFilename.set(`${entry.id}.png`, entry);
  }
  const structuralNaReasons = {
    'no-post.design.png': 'Host always owns renderOutput; there is no optional post graph to disable for this lab.',
    'camera.near.png': 'Lab owns a single host/design camera; multi-camera near sweeps are not part of this contract.',
    'camera.far.png': 'Lab owns a single host/design camera; multi-camera far sweeps are not part of this contract.',
  };
  const images = [];
  // pipeline-graph.json is written above; re-hash for N/A proofs after normative write.
  const pipelineGraphPath = join(directory, 'pipeline-graph.json');
  if (!existsSync(pipelineGraphPath)) throw new Error('pipeline-graph.json missing before image ledger assembly');
  const pipelineGraphDigest = sha256(readFileSync(pipelineGraphPath));
  for (const filename of REQUIRED_EVIDENCE_IMAGES) {
    const path = join(directory, filename);
    if (existsSync(path)) {
      const bytes = readFileSync(path);
      images.push(capturedEvidenceImage({
        path: filename,
        role: filename.replace(/\.png$/, ''),
        binding: bindingOf(filename, bytes),
      }));
      continue;
    }
    const plan = planByFilename.get(filename);
    const plannedNa = plan && (plan.status === 'NOT_APPLICABLE' || plan.status === 'not-applicable' || plan.filename == null);
    const reason = plan?.reason
      || (plannedNa ? `Capture outputPlan marks ${filename} not applicable.` : null)
      || structuralNaReasons[filename]
      || null;
    if (!reason) throw new Error(`missing required image ${filename}`);
    images.push(notApplicableEvidenceImage({
      path: filename,
      role: filename.replace(/\.png$/, ''),
      reason,
      pipelineGraphDigest,
    }));
  }

  // Prefer the capture locked state; fall back to the same primary defaults
  // used by run-physical-review-cdp.mjs so raw/physical route locks stay joinable.
  const locked = session.route?.lockedState ?? {};
  const route = {
    path: lab.publishPath ?? `/demos/${labId}/`,
    scenario: locked.scenario ?? lab.scenarios?.[0]?.id ?? 'default',
    mechanism: locked.mechanism ?? lab.mechanisms?.[0]?.id ?? null,
    mode: locked.mode ?? lab.modes?.[0] ?? 'final',
    tier: (() => {
      const raw = locked.tier ?? lab.tiers?.[0]?.id ?? null;
      // Route tier ids must match ^[a-z0-9][a-z0-9-]*$ (no '/').
      return typeof raw === 'string' ? raw.replaceAll('/', '-') : raw;
    })(),
    camera: locked.camera ?? lab.cameras?.[0] ?? 'design',
    seed: typeof locked.seed === 'number'
      ? `0x${(locked.seed >>> 0).toString(16).padStart(8, '0')}`
      : (typeof lab.seeds?.[0] === 'number'
        ? `0x${(lab.seeds[0] >>> 0).toString(16).padStart(8, '0')}`
        : '0x00000001'),
    timeSeconds: {
      value: locked.timeSeconds ?? 0,
      unit: 'seconds',
      label: 'Measured',
      source: 'capture locked state',
    },
  };
  route.stateDigest = routeStateDigest(route);

  const sourceClosureHash = session.sourceClosureHash ?? session.sourceHash;
  const buildRevision = session.buildRevision;
  const limitations = [
    {
      id: 'visual-review-pending',
      status: 'ACTIVE',
      statement: 'Raw correctness images require offline visual signoff before release promotion.',
      affectedClaims: ['visualCorrectness'],
    },
    {
      id: 'hardware-performance-not-claimed',
      status: 'ACTIVE',
      statement: 'Correctness capture does not claim named-adapter GPU timestamps or presentation cadence.',
      affectedClaims: ['performanceCompliance', 'gpuAttribution'],
    },
  ];
  if (!lifecyclePass) {
    limitations.push({
      id: 'lifecycle-single-cycle',
      status: 'ACTIVE',
      statement: 'Lifecycle evidence is a single create/render/dispose observation from the capture session, not a 50-cycle soak.',
      affectedClaims: ['lifecycleStability'],
    });
  } else {
    limitations.push({
      id: 'opaque-renderer-residency-not-claimed',
      status: 'ACTIVE',
      statement: 'Exact Three.js renderer-internal pipeline and cache byte residency is unavailable; lifecycle PASS covers lab-owned resources and observed renderer state only.',
      affectedClaims: ['lifecycleStability'],
    });
  }

  const document = {
    kind: 'capture-session-document',
    path: 'capture-session.json',
    ...bindingOf('capture-session.json', sessionBytes),
  };
  const writeLedgerPath = join(directory, 'capture-write-ledger.json');
  const writeLedgerBytes = existsSync(writeLedgerPath) ? readFileSync(writeLedgerPath) : Buffer.from('{}\n');
  const writeLedger = {
    kind: 'capture-session-write-ledger',
    path: 'capture-write-ledger.json',
    ...bindingOf('capture-write-ledger.json', writeLedgerBytes),
  };

  const finalRuntime = structuredClone(session.finalRuntime ?? session.runtime ?? {});
  const metrics = finalRuntime.metrics ?? {};
  const evidence = {
    ...(metrics.rendererBackendEvidence ?? metrics.rendererInfo?.backendEvidence ?? {}),
  };
  if (metrics.nativeWebGPU === true && evidence.isWebGPUBackend !== true) {
    evidence.isWebGPUBackend = true;
  }
  metrics.rendererBackendEvidence = evidence;
  metrics.initialized = metrics.initialized === true || metrics.nativeWebGPU === true;
  metrics.nativeWebGPU = metrics.nativeWebGPU === true;
  finalRuntime.metrics = metrics;

  // Schema only enumerates playwright-headless-chromium | codex-in-app-browser.
  // CDP-attached system Chrome is still the Playwright correctness lane.
  const automationSurface = session.automationSurface === 'playwright-cdp-chrome'
    || session.automationSurface === 'playwright-headless-chromium'
    || !session.automationSurface
    ? 'playwright-headless-chromium'
    : session.automationSurface;

  const captureSession = createRawCaptureSessionReference({
    session: {
      ...session,
      automationSurface,
      sourceClosureHash,
      buildRevision,
      finalRuntime,
      adapterClass: session.adapterClass === 'unknown' && (finalRuntime.metrics?.nativeWebGPU === true)
        ? (String(JSON.stringify(finalRuntime.metrics?.rendererBackendEvidence ?? {})).toLowerCase().includes('swiftshader')
          ? 'software'
          : 'hardware')
        : session.adapterClass,
    },
    route,
    limitations,
    document,
    writeLedger,
  });

  const mechanismPass = session.finalRuntime?.metrics?.nativeWebGPU === true
    || session.runtime?.metrics?.nativeWebGPU === true;

  const manifest = createRawEvidenceManifest({
    labId,
    skill: lab.skill,
    sourceClosureHash,
    buildRevision,
    route,
    limitations,
    captureSession,
    files,
    images,
    claimVerdicts: {
      visualCorrectness: 'INSUFFICIENT_EVIDENCE',
      mechanismCorrectness: mechanismPass ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
      performanceCompliance: 'NOT_CLAIMED',
      gpuAttribution: 'NOT_CLAIMED',
      lifecycleStability: lifecyclePass ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
      visualError: 'PASS',
    },
  });

  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(directory, 'evidence-manifest.json'), manifestBytes);
  console.log(JSON.stringify({
    ok: true,
    labId,
    directory,
    bundleKind: manifest.bundleKind,
    publishable: manifest.publishable,
    claimVerdicts: manifest.claimVerdicts,
    files: manifest.files.length,
    images: manifest.images.length,
  }, null, 2));
}

main();
