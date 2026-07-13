import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

const schemaUrl = new URL('../../labs/schema/evidence-bundle-v2.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, 'utf8'));

function resolvePointer(root, reference) {
  assert.match(reference, /^#\//, `test evaluator only supports local JSON pointers: ${reference}`);
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value[part], root);
}

function valueHasType(value, expected) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

function validateAgainstSchema(value, candidateSchema, path = '$') {
  if (candidateSchema === true) return [];
  if (candidateSchema === false) return [`${path} is forbidden`];

  const errors = [];
  if (candidateSchema.$ref) {
    errors.push(...validateAgainstSchema(value, resolvePointer(schema, candidateSchema.$ref), path));
  }
  if (candidateSchema.type) {
    const expectedTypes = Array.isArray(candidateSchema.type) ? candidateSchema.type : [candidateSchema.type];
    if (!expectedTypes.some((expected) => valueHasType(value, expected))) {
      errors.push(`${path} must have type ${expectedTypes.join('|')}`);
      return errors;
    }
  }
  if ('const' in candidateSchema && !isDeepStrictEqual(value, candidateSchema.const)) {
    errors.push(`${path} must equal ${JSON.stringify(candidateSchema.const)}`);
  }
  if (candidateSchema.enum && !candidateSchema.enum.some((entry) => isDeepStrictEqual(value, entry))) {
    errors.push(`${path} is not an allowed enum value`);
  }

  if (typeof value === 'string') {
    if (candidateSchema.minLength !== undefined && value.length < candidateSchema.minLength) {
      errors.push(`${path} is shorter than minLength`);
    }
    if (candidateSchema.maxLength !== undefined && value.length > candidateSchema.maxLength) {
      errors.push(`${path} is longer than maxLength`);
    }
    if (candidateSchema.pattern && !new RegExp(candidateSchema.pattern, 'u').test(value)) {
      errors.push(`${path} does not match ${candidateSchema.pattern}`);
    }
    if (candidateSchema.format === 'date-time') {
      const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
      if (!isoDateTime.test(value) || Number.isNaN(Date.parse(value))) errors.push(`${path} is not a date-time`);
    }
  }
  if (typeof value === 'number' && candidateSchema.minimum !== undefined && value < candidateSchema.minimum) {
    errors.push(`${path} is below minimum`);
  }

  if (Array.isArray(value)) {
    if (candidateSchema.minItems !== undefined && value.length < candidateSchema.minItems) {
      errors.push(`${path} has fewer than minItems`);
    }
    if (candidateSchema.maxItems !== undefined && value.length > candidateSchema.maxItems) {
      errors.push(`${path} has more than maxItems`);
    }
    if (candidateSchema.uniqueItems) {
      for (let index = 0; index < value.length; index += 1) {
        if (value.slice(index + 1).some((entry) => isDeepStrictEqual(value[index], entry))) {
          errors.push(`${path} contains duplicate items`);
          break;
        }
      }
    }
    const prefixLength = candidateSchema.prefixItems?.length ?? 0;
    candidateSchema.prefixItems?.forEach((itemSchema, index) => {
      if (index < value.length) errors.push(...validateAgainstSchema(value[index], itemSchema, `${path}[${index}]`));
    });
    if (candidateSchema.items) {
      value.slice(prefixLength).forEach((entry, offset) => {
        const index = prefixLength + offset;
        errors.push(...validateAgainstSchema(entry, candidateSchema.items, `${path}[${index}]`));
      });
    }
    if (candidateSchema.contains) {
      const matches = value.filter((entry, index) => (
        validateAgainstSchema(entry, candidateSchema.contains, `${path}[${index}]`).length === 0
      )).length;
      const minimum = candidateSchema.minContains ?? 1;
      const maximum = candidateSchema.maxContains ?? Number.POSITIVE_INFINITY;
      if (matches < minimum || matches > maximum) {
        errors.push(`${path} contains ${matches} matching items, expected ${minimum}..${maximum}`);
      }
    }
  }

  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (isObject) {
    for (const requiredKey of candidateSchema.required ?? []) {
      if (!Object.hasOwn(value, requiredKey)) errors.push(`${path}.${requiredKey} is required`);
    }
    for (const [key, propertySchema] of Object.entries(candidateSchema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        errors.push(...validateAgainstSchema(value[key], propertySchema, `${path}.${key}`));
      }
    }
    if (candidateSchema.additionalProperties === false) {
      const declaredKeys = new Set(Object.keys(candidateSchema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!declaredKeys.has(key)) errors.push(`${path}.${key} is an additional property`);
      }
    }
  }

  for (const part of candidateSchema.allOf ?? []) errors.push(...validateAgainstSchema(value, part, path));
  if (candidateSchema.anyOf) {
    const passing = candidateSchema.anyOf.filter((part) => validateAgainstSchema(value, part, path).length === 0);
    if (passing.length === 0) errors.push(`${path} must match at least one anyOf branch`);
  }
  if (candidateSchema.oneOf) {
    const passing = candidateSchema.oneOf.filter((part) => validateAgainstSchema(value, part, path).length === 0);
    if (passing.length !== 1) errors.push(`${path} must match exactly one oneOf branch; matched ${passing.length}`);
  }
  if (candidateSchema.not && validateAgainstSchema(value, candidateSchema.not, path).length === 0) {
    errors.push(`${path} matches a forbidden schema`);
  }
  if (candidateSchema.if) {
    const conditionMatches = validateAgainstSchema(value, candidateSchema.if, path).length === 0;
    if (conditionMatches && candidateSchema.then) {
      errors.push(...validateAgainstSchema(value, candidateSchema.then, path));
    } else if (!conditionMatches && candidateSchema.else) {
      errors.push(...validateAgainstSchema(value, candidateSchema.else, path));
    }
  }
  return errors;
}

const hash = (character) => `sha256:${character.repeat(64)}`;
const sourceClosureHash = hash('e');
const buildRevision = hash('f');
const routeDigest = hash('d');
const numeric = (value, unit, label, source) => ({ value, unit, label, source });
const normativeFiles = [
  'visual-contract.json',
  'evidence-manifest.json',
  'renderer-info.json',
  'pipeline-graph.json',
  'performance-envelope.json',
  'frame-trace.json',
  'quality-governor.json',
  'render-targets.json',
  'storage-resources.json',
  'resident-resources.json',
  'bandwidth-model.json',
  'visual-errors.json',
  'leak-loop.json',
  'mechanism-metrics.json',
];
const standardImages = [
  'final.design.png',
  'no-post.design.png',
  'diagnostics.mosaic.png',
  'camera.near.png',
  'camera.design.png',
  'camera.far.png',
  'seed-0001.final.png',
  'seed-9e3779b9.final.png',
  'temporal.t000.png',
  'temporal.t001.png',
];

function route() {
  return {
    path: '/demos/example-native-lab/tier/full/',
    scenario: 'design',
    mechanism: null,
    mode: 'final',
    tier: 'full',
    camera: 'design',
    seed: '0x00000001',
    timeSeconds: numeric(2, 'seconds', 'Authored', 'visual contract'),
    stateDigest: hash('c'),
  };
}

function claims({ performance = false, visualError = true } = {}) {
  const result = {
    visualCorrectness: 'PASS',
    mechanismCorrectness: 'PASS',
    performanceCompliance: performance ? 'PASS' : 'NOT_CLAIMED',
    gpuAttribution: performance ? 'PASS' : 'NOT_CLAIMED',
    lifecycleStability: 'PASS',
  };
  if (visualError) result.visualError = 'PASS';
  return result;
}

function session(profile, options = {}) {
  const defaults = {
    correctness: {
      automationSurface: 'playwright-headless-chromium',
      adapterClass: 'hardware',
      adapterHash: '1',
      deviceHash: '5',
      browserHash: '2',
      osHash: '6',
      refreshHash: '7',
      colorHash: '8',
      limitationsHash: '9',
      documentHash: '3',
      ledgerHash: '4',
    },
    'physical-route': {
      automationSurface: 'codex-in-app-browser',
      adapterClass: 'hardware',
      adapterHash: '5',
      deviceHash: '9',
      browserHash: '6',
      osHash: 'a',
      refreshHash: 'b',
      colorHash: 'c',
      limitationsHash: 'd',
      documentHash: '7',
      ledgerHash: '8',
    },
    performance: {
      automationSurface: 'codex-in-app-browser',
      adapterClass: 'hardware',
      adapterHash: '9',
      deviceHash: 'c',
      browserHash: 'a',
      osHash: 'd',
      refreshHash: 'e',
      colorHash: 'f',
      limitationsHash: '1',
      documentHash: 'b',
      ledgerHash: '0',
    },
  }[profile];
  const selected = { ...defaults, ...options };
  const stem = profile.replaceAll('-', '.');
  return {
    sessionId: `example-native-lab:${profile}:session`,
    profile,
    automationSurface: selected.automationSurface,
    adapterClass: selected.adapterClass,
    adapterIdentity: { kind: 'gpu-adapter', digest: hash(selected.adapterHash) },
    deviceIdentity: { kind: 'gpu-device', digest: hash(selected.deviceHash) },
    browserIdentity: { kind: 'browser', digest: hash(selected.browserHash) },
    osIdentity: { kind: 'operating-system', digest: hash(selected.osHash) },
    refreshIdentity: { kind: 'display-refresh', digest: hash(selected.refreshHash) },
    colorIdentity: { kind: 'color-pipeline', digest: hash(selected.colorHash) },
    limitationsDigest: hash(selected.limitationsHash),
    threeRevision: '0.185.1',
    sourceClosureHash,
    buildRevision,
    startedAt: '2026-07-12T12:00:00Z',
    finishedAt: '2026-07-12T12:01:00Z',
    routePath: route().path,
    routeDigest,
    stateDigest: route().stateDigest,
    document: {
      kind: 'capture-session-document',
      path: `sessions/${stem}.capture-session.json`,
      sha256: hash(selected.documentHash),
      byteLength: 2048,
    },
    writeLedger: {
      kind: 'capture-session-write-ledger',
      path: `sessions/${stem}.write-ledger.json`,
      sha256: hash(selected.ledgerHash),
      byteLength: 1024,
    },
    rendererInitialized: true,
    isWebGPUBackend: true,
    timestampQuerySupported: profile === 'performance',
  };
}

function selfManifestEntry() {
  return {
    path: 'evidence-manifest.json',
    status: 'self-excluded',
    kind: 'evidence-manifest',
    reason: 'The manifest cannot contain its own final byte hash.',
  };
}

function releaseFileLedger(sessions) {
  const normative = normativeFiles.map((path, index) => (
    path === 'evidence-manifest.json'
      ? selfManifestEntry()
      : {
          path,
          status: 'captured',
          kind: 'normative-json',
          sha256: hash(index.toString(16)),
          byteLength: 512 + index,
        }
  ));
  return [
    ...normative,
    ...sessions.flatMap((captureSession) => ([
      {
        path: captureSession.document.path,
        status: 'captured',
        kind: 'capture-session-document',
        sha256: captureSession.document.sha256,
        byteLength: captureSession.document.byteLength,
      },
      {
        path: captureSession.writeLedger.path,
        status: 'captured',
        kind: 'capture-session-write-ledger',
        sha256: captureSession.writeLedger.sha256,
        byteLength: captureSession.writeLedger.byteLength,
      },
    ])),
  ];
}

function directImage(path, index) {
  return {
    path,
    status: 'captured',
    kind: 'direct-capture',
    role: path.slice(0, -'.png'.length),
    mediaType: 'image/png',
    sha256: hash(index.toString(16)),
    byteLength: 1024 + index,
  };
}

function notApplicableImage(path) {
  return {
    path,
    status: 'not-applicable',
    kind: 'not-applicable',
    role: path.slice(0, -'.png'.length),
    notApplicableProof: {
      reason: `${path} is structurally inapplicable to this non-temporal lab.`,
      pipelineGraphPath: 'pipeline-graph.json',
      pipelineGraphDigest: hash('6'),
    },
  };
}

function releaseImageLedger() {
  const images = standardImages.map((path, index) => (
    ['no-post.design.png', 'temporal.t000.png', 'temporal.t001.png'].includes(path)
      ? notApplicableImage(path)
      : directImage(path, index)
  ));
  images[2] = {
    ...directImage('diagnostics.mosaic.png', 2),
    kind: 'derived-image',
    derivation: {
      method: 'deterministic diagnostics contact sheet',
      implementation: 'scripts/compose-diagnostics.mjs',
      parametersDigest: hash('7'),
    },
    sourceCaptures: ['diagnostic.normal.png', 'diagnostic.emissive.png'],
  };
  return [
    ...images,
    directImage('diagnostic.normal.png', 10),
    directImage('diagnostic.emissive.png', 11),
  ];
}

function noVisualSignoff() {
  return {
    status: 'NOT_REVIEWED',
    reviewer: null,
    reviewedAt: null,
    reviewDigest: null,
    reviewedImages: [],
    notes: [],
  };
}

function promotionBinding(record) {
  return {
    manifestCoreDigest: hash('1'),
    sourceClosureHash: record.sourceClosureHash,
    buildRevision: record.buildRevision,
    threeRevision: record.threeRevision,
    route: structuredClone(record.route),
    routeDigest,
    limitations: structuredClone(record.limitations),
    limitationsDigest: hash('2'),
    claimVerdicts: structuredClone(record.claimVerdicts),
    claimVerdictsDigest: hash('3'),
    captureSessions: structuredClone(record.captureSessions),
    captureSessionSetDigest: hash('4'),
    artifactLedgerDigest: hash('5'),
    imageLedgerDigest: hash('6'),
  };
}

function commonRecord() {
  return {
    schemaVersion: 2,
    labId: 'example-native-lab',
    bundleId: 'example-native-lab:v2',
    bundleKind: 'contract-fixture',
    publishable: false,
    skill: 'threejs-visual-validation',
    threeRevision: '0.185.1',
    sourceClosureHash,
    buildRevision,
    route: route(),
    limitations: [],
    claimVerdicts: {
      visualCorrectness: 'INSUFFICIENT_EVIDENCE',
      mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
      performanceCompliance: 'NOT_CLAIMED',
      gpuAttribution: 'NOT_CLAIMED',
      lifecycleStability: 'INSUFFICIENT_EVIDENCE',
    },
    captureSessions: [],
    files: [selfManifestEntry()],
    images: [],
    promotion: {
      status: 'NOT_ELIGIBLE',
      binding: null,
      bindingDigest: null,
      visualSignoff: noVisualSignoff(),
    },
  };
}

function contractFixture() {
  return commonRecord();
}

function rawPerformanceSession() {
  const record = commonRecord();
  const captureSession = session('performance', {
    adapterClass: 'software',
    adapterHash: 'c',
  });
  Object.assign(record, {
    bundleId: 'example-native-lab:raw-performance:v2',
    bundleKind: 'raw-capture-session',
    captureSessions: [captureSession],
    files: [
      selfManifestEntry(),
      {
        path: captureSession.document.path,
        status: 'captured',
        kind: 'capture-session-document',
        sha256: captureSession.document.sha256,
        byteLength: captureSession.document.byteLength,
      },
      {
        path: captureSession.writeLedger.path,
        status: 'captured',
        kind: 'capture-session-write-ledger',
        sha256: captureSession.writeLedger.sha256,
        byteLength: captureSession.writeLedger.byteLength,
      },
    ],
  });
  return record;
}

function releaseRecord({ performance = false, visualError = true } = {}) {
  const record = commonRecord();
  const sessions = [session('correctness'), session('physical-route')];
  if (performance) sessions.push(session('performance'));
  Object.assign(record, {
    bundleId: `example-native-lab:release:${performance ? 'performance' : 'correctness'}:v2`,
    bundleKind: 'release-bundle',
    publishable: true,
    claimVerdicts: claims({ performance, visualError }),
    captureSessions: sessions,
    files: releaseFileLedger(sessions),
    images: releaseImageLedger(),
  });
  record.promotion = {
    status: 'APPROVED',
    binding: promotionBinding(record),
    bindingDigest: hash('8'),
    visualSignoff: {
      status: 'APPROVED',
      candidateBinding: promotionBinding(record),
      candidateBindingDigest: hash('7'),
      reviewer: 'graphics-reviewer',
      reviewedAt: '2026-07-12T12:00:00Z',
      reviewDigest: hash('9'),
      reviewedImages: ['final.design.png', 'diagnostics.mosaic.png'],
      notes: ['Final and diagnostic captures are readable, distinct, and mechanism-consistent.'],
    },
  };
  return record;
}

function schemaErrors(record) {
  return validateAgainstSchema(record, schema);
}

// Cross-record equality is deliberately kept out of JSON Schema. The production
// validator must apply this projection after structural validation.
function semanticJoinErrors(record) {
  if (record.bundleKind !== 'release-bundle') return [];
  const errors = [];
  const fileByPath = new Map(record.files.map((entry) => [entry.path, entry]));
  const binding = record.promotion?.binding;
  for (const captureSession of record.captureSessions) {
    if (captureSession.sourceClosureHash !== record.sourceClosureHash) errors.push('session source closure mismatch');
    if (captureSession.buildRevision !== record.buildRevision) errors.push('session build revision mismatch');
    if (captureSession.threeRevision !== record.threeRevision) errors.push('session Three revision mismatch');
    if (captureSession.routePath !== record.route.path) errors.push('session route path mismatch');
    if (captureSession.stateDigest !== record.route.stateDigest) errors.push('session state digest mismatch');
    if (binding && captureSession.routeDigest !== binding.routeDigest) errors.push('session route digest mismatch');
    for (const [label, reference, expectedKind] of [
      ['document', captureSession.document, 'capture-session-document'],
      ['write ledger', captureSession.writeLedger, 'capture-session-write-ledger'],
    ]) {
      const ledgerEntry = fileByPath.get(reference.path);
      if (
        !ledgerEntry
        || ledgerEntry.kind !== expectedKind
        || ledgerEntry.sha256 !== reference.sha256
        || ledgerEntry.byteLength !== reference.byteLength
      ) {
        errors.push(`session ${label} ledger mismatch`);
      }
    }
  }
  if (binding) {
    if (!isDeepStrictEqual(binding.captureSessions, record.captureSessions)) errors.push('promotion session join mismatch');
    if (!isDeepStrictEqual(binding.claimVerdicts, record.claimVerdicts)) errors.push('promotion claim mismatch');
    if (!isDeepStrictEqual(binding.route, record.route)) errors.push('promotion route mismatch');
    if (binding.sourceClosureHash !== record.sourceClosureHash) errors.push('promotion source closure mismatch');
    if (binding.buildRevision !== record.buildRevision) errors.push('promotion build revision mismatch');
  }
  return errors;
}

function assertSchemaValid(record, label) {
  const errors = schemaErrors(record);
  assert.deepEqual(errors, [], `${label} failed:\n${errors.join('\n')}`);
}

function assertSchemaInvalid(record, label) {
  assert.ok(schemaErrors(record).length > 0, `${label} unexpectedly passed structural validation`);
}

function assertSemanticInvalid(record, label) {
  assertSchemaValid(record, `${label} structural prerequisite`);
  assert.ok(semanticJoinErrors(record).length > 0, `${label} unexpectedly passed semantic reconciliation`);
}

test('schema keeps five required claims closed while allowing optional visualError', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.claimVerdicts.additionalProperties, false);
  assert.deepEqual(
    [...schema.$defs.claimVerdicts.required].sort(),
    [
      'gpuAttribution',
      'lifecycleStability',
      'mechanismCorrectness',
      'performanceCompliance',
      'visualCorrectness',
    ],
  );
  assert.ok(Object.hasOwn(schema.$defs.claimVerdicts.properties, 'visualError'));

  const withoutVisualError = releaseRecord({ visualError: false });
  assertSchemaValid(withoutVisualError, 'release without optional visualError claim');
  const extra = contractFixture();
  extra.claimVerdicts.inventedClaim = 'PASS';
  assertSchemaInvalid(extra, 'release with unknown claim');

  const missingRequired = releaseRecord();
  delete missingRequired.claimVerdicts.lifecycleStability;
  assertSchemaInvalid(missingRequired, 'release missing required lifecycle claim');

  const failingVisualError = releaseRecord();
  failingVisualError.claimVerdicts.visualError = 'FAIL';
  assertSchemaInvalid(failingVisualError, 'publishable release with failing optional visualError claim');
});

test('fixtures, raw sessions, correctness releases, and performance releases validate truthfully', () => {
  assertSchemaValid(contractFixture(), 'contract fixture');
  assertSchemaValid(rawPerformanceSession(), 'nonpublishable raw performance session');
  assertSchemaValid(releaseRecord(), 'correctness plus physical-route release');
  assertSchemaValid(releaseRecord({ performance: true }), 'hardware performance release');
});

test('release bundles require correctness only; physical-route is optional', () => {
  const missingCorrectness = releaseRecord();
  missingCorrectness.captureSessions = missingCorrectness.captureSessions.filter((entry) => entry.profile !== 'correctness');
  assertSchemaInvalid(missingCorrectness, 'release missing correctness lane');

  const correctnessOnly = releaseRecord();
  correctnessOnly.captureSessions = correctnessOnly.captureSessions.filter((entry) => entry.profile === 'correctness');
  // Binding/session digests must match the reduced session set for a full contract check;
  // schema-level releaseBundleRequirements only requires correctness presence.
  assertSchemaValid(correctnessOnly, 'release with correctness lane only (no physical-route QA tooling)');

  const softwareCorrectness = releaseRecord();
  softwareCorrectness.captureSessions.find((entry) => entry.profile === 'correctness').adapterClass = 'software';
  assertSchemaValid(softwareCorrectness, 'release correctness lane on a software adapter');

  const softwarePhysical = releaseRecord();
  softwarePhysical.captureSessions.find((entry) => entry.profile === 'physical-route').adapterClass = 'software';
  // Optional physical-route, if present on a release, still cannot claim hardware while software-classed
  // when semantic contract runs — schema alone may still accept; semantic contract rejects.
  assertSchemaValid(softwarePhysical, 'schema allows optional physical-route entry even if adapter is software');
});

test('capture sessions reject unknown automation surfaces', () => {
  const candidate = releaseRecord();
  candidate.captureSessions.find((entry) => entry.profile === 'correctness').automationSurface = 'chrome';
  assertSchemaInvalid(candidate, 'correctness lane on unknown surface chrome');
});

test('publishable automation surfaces include playwright and optional codex', () => {
  assert.deepEqual(
    schema.$defs.captureSessionRef.properties.automationSurface.enum,
    ['playwright-headless-chromium', 'playwright-cdp-chrome', 'codex-in-app-browser'],
  );
  const candidate = releaseRecord({ performance: true });
  assert.ok(candidate.captureSessions.some((entry) => entry.profile === 'correctness'
    && entry.automationSurface === 'playwright-headless-chromium'));
  // codex-in-app-browser may still appear on optional lanes in fixtures, but is not required
  for (const entry of candidate.captureSessions) {
    const expectedSurface = entry.automationSurface;
    entry.automationSurface = 'chrome';
    assertSchemaInvalid(candidate, `${entry.profile} lane on Chrome`);
    entry.automationSurface = expectedSurface;
  }
});

test('performance PASS requires a hardware timestamped performance lane', () => {
  const missingPerformance = releaseRecord({ performance: true });
  missingPerformance.captureSessions = missingPerformance.captureSessions.filter((entry) => entry.profile !== 'performance');
  assertSchemaInvalid(missingPerformance, 'performance claim without performance lane');

  const pendingWithoutPerformance = releaseRecord({ performance: true });
  pendingWithoutPerformance.publishable = false;
  pendingWithoutPerformance.captureSessions = pendingWithoutPerformance.captureSessions.filter((entry) => entry.profile !== 'performance');
  pendingWithoutPerformance.promotion = {
    status: 'PENDING_VISUAL_SIGNOFF',
    binding: promotionBinding(pendingWithoutPerformance),
    bindingDigest: hash('8'),
    visualSignoff: {
      status: 'PENDING', reviewer: null, reviewedAt: null, reviewDigest: null, reviewedImages: [], notes: [],
    },
  };
  assertSchemaInvalid(pendingWithoutPerformance, 'pending release claims performance PASS without a performance lane');

  for (const mutation of [
    (entry) => { entry.adapterClass = 'software'; },
    (entry) => { entry.adapterClass = 'unknown'; },
    (entry) => { entry.timestampQuerySupported = false; },
  ]) {
    const candidate = releaseRecord({ performance: true });
    mutation(candidate.captureSessions.find((entry) => entry.profile === 'performance'));
    assertSchemaInvalid(candidate, 'performance claim with insufficient hardware timing identity');
  }
});

test('raw sessions can never become publishable by relabeling performance evidence', () => {
  const candidate = rawPerformanceSession();
  candidate.publishable = true;
  assertSchemaInvalid(candidate, 'raw performance session marked publishable');
});

test('typed identity and session-hash roles reject structural swaps', () => {
  const swappedArtifacts = releaseRecord();
  const captureSession = swappedArtifacts.captureSessions[0];
  [captureSession.document, captureSession.writeLedger] = [captureSession.writeLedger, captureSession.document];
  assertSchemaInvalid(swappedArtifacts, 'capture-session document and write-ledger refs swapped');

  const swappedIdentityKinds = releaseRecord();
  const identitySession = swappedIdentityKinds.captureSessions[0];
  [identitySession.adapterIdentity, identitySession.browserIdentity] = [
    identitySession.browserIdentity,
    identitySession.adapterIdentity,
  ];
  assertSchemaInvalid(swappedIdentityKinds, 'adapter and browser identity refs swapped');

  const swappedEnvironmentKinds = releaseRecord();
  const environmentSession = swappedEnvironmentKinds.captureSessions[0];
  [environmentSession.deviceIdentity, environmentSession.osIdentity] = [
    environmentSession.osIdentity,
    environmentSession.deviceIdentity,
  ];
  assertSchemaInvalid(swappedEnvironmentKinds, 'device and OS identity refs swapped');
});

test('valid-form hash and identity substitutions are rejected by separate semantic reconciliation', () => {
  const swappedHashes = releaseRecord();
  const sessionRef = swappedHashes.captureSessions[0];
  [sessionRef.document.sha256, sessionRef.writeLedger.sha256] = [
    sessionRef.writeLedger.sha256,
    sessionRef.document.sha256,
  ];
  assertSemanticInvalid(swappedHashes, 'valid-form document and write-ledger hash substitution');

  const swappedIdentities = releaseRecord();
  const [first, second] = swappedIdentities.captureSessions;
  [first.adapterIdentity.digest, second.adapterIdentity.digest] = [
    second.adapterIdentity.digest,
    first.adapterIdentity.digest,
  ];
  assertSemanticInvalid(swappedIdentities, 'promotion-bound session identity substitution');

  const swappedColorIdentities = releaseRecord();
  const [colorFirst, colorSecond] = swappedColorIdentities.captureSessions;
  [colorFirst.colorIdentity.digest, colorSecond.colorIdentity.digest] = [
    colorSecond.colorIdentity.digest,
    colorFirst.colorIdentity.digest,
  ];
  assertSemanticInvalid(swappedColorIdentities, 'promotion-bound color identity substitution');
});

test('canonical standard-image slots accept explicit structural N/A records', () => {
  const candidate = releaseRecord();
  for (const path of ['no-post.design.png', 'temporal.t000.png', 'temporal.t001.png']) {
    const entry = candidate.images.find((image) => image.path === path);
    assert.equal(entry.status, 'not-applicable');
    assert.equal(entry.kind, 'not-applicable');
    assert.equal(entry.notApplicableProof.pipelineGraphPath, 'pipeline-graph.json');
  }
  assertSchemaValid(candidate, 'release with structurally inapplicable standard images');

  const missingSlot = releaseRecord();
  missingSlot.images.splice(5, 1);
  assertSchemaInvalid(missingSlot, 'release missing a canonical standard-image slot');
});

test('promotion joins the release sessions and requires approved visual review', () => {
  const weakSignoff = releaseRecord();
  delete weakSignoff.promotion.visualSignoff.reviewDigest;
  assertSchemaInvalid(weakSignoff, 'release with incomplete visual signoff');

  const pending = releaseRecord();
  pending.publishable = false;
  pending.promotion = {
    status: 'PENDING_VISUAL_SIGNOFF',
    binding: promotionBinding(pending),
    bindingDigest: hash('8'),
    visualSignoff: {
      status: 'PENDING',
      reviewer: null,
      reviewedAt: null,
      reviewDigest: null,
      reviewedImages: [],
      notes: [],
    },
  };
  assertSchemaValid(pending, 'release awaiting visual signoff');

  const substitutedBinding = releaseRecord();
  substitutedBinding.promotion.binding.captureSessions[0].document.sha256 = hash('a');
  assertSemanticInvalid(substitutedBinding, 'promotion join with substituted session document hash');
});
