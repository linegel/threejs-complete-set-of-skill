import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  authoritativeSkillDirs,
  buildDemoRegistry,
  computeBuildRevision,
  computeManifestSourceHash,
  computeManifestSourceHashInputs,
  loadCanonicalTargets,
} from '../../scripts/lib/lab-registry.mjs';
import { computePublishedBundleHash } from '../../scripts/lib/published-pages.mjs';
import { validateLabManifest, validateRawLabManifest, validateRegistry } from '../../scripts/lib/lab-validation.mjs';
import {
  browserDependencyDrift,
  appendCaptureProfile,
  expandLocalPackageScript,
  manifestCommandPrefixDrift,
  obviousNoOpCommand,
  quickCommandStartsBrowser,
  quickCommandWritesTrackedSources,
  rootBrowserToolchainDrift,
} from '../../scripts/lib/lab-command-policy.mjs';

function retainedFixtureDirectory(...segments) {
  const directory = join(REPO_ROOT, 'artifacts', 'test-fixtures', 'foundation', ...segments);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function rawManifestFixture() {
  return {
    schemaVersion: 2,
    id: 'raw-fixture',
    skill: 'threejs-visual-validation',
    threeRevision: '0.185.1',
    kind: 'canonical-lab',
    status: 'incomplete',
    canonicalSource: ['threejs-visual-validation/examples/webgpu-validation-harness'],
    browserEntry: null,
    publishPath: '/demos/raw-fixture/',
    scenarios: [{ id: 'scene', acceptanceStatus: 'incomplete' }],
    mechanisms: [{ id: 'mechanism', acceptanceStatus: 'incomplete' }],
    tiers: [{
      id: 'full',
      targetClass: 'test',
      frameTargetMs: null,
      resolutionPolicy: {},
      mechanismLimits: {},
      resourceLimits: {},
      degradationFromPrevious: [],
      preservedInvariants: [],
      acceptanceStatus: 'incomplete',
    }],
    modes: ['final'],
    cameras: ['design'],
    seeds: [1],
    capabilityRequirements: [{ id: 'native-webgpu', required: true, status: 'incomplete' }],
    runtimeProof: [{ id: 'renderer-init', required: true, status: 'incomplete' }],
    evidenceContract: 'v2',
    validationCommand: null,
    sourceHash: null,
    proxyStatus: null,
  };
}
import {
  LAB_CONTROLLER_GLOBALS,
  assertPagesBrowserObservation,
  assertPagesRouteResponse,
  awaitLockedRouteController,
  lockedRouteContract,
  lockedRouteSelectionMatches,
  lockedRouteSelectionMatchesWithKeys,
  plannedPagesBrowserRoutes,
  plannedPagesSmokeRoutes,
  plannedPublishedRoutes,
} from '../../scripts/lib/page-routes.mjs';

test('inventory derives counts from the authored demo catalog', () => {
  const registry = buildDemoRegistry();
  const targetData = loadCanonicalTargets();
  assert.equal(registry.counts.skills, authoritativeSkillDirs(targetData).length);
  assert.equal(registry.primaryIds.length, registry.counts.primary);
  assert.equal(registry.integrationPrimaryIds.length, registry.counts.integrations);
  assert.equal(registry.flagshipIds.length, registry.counts.flagships);
  assert.deepEqual(registry.integrationIds, registry.flagshipIds);
  assert.equal(validateRegistry(registry).valid, true);
  assert.ok(registry.demos.every((demo) => Array.isArray(demo.sourceHashInputs) && demo.sourceHashInputs.length > 0));
});

test('build revision is source-content based and independent of informational git commit', () => {
  const registry = buildDemoRegistry();
  const revision = computeBuildRevision(registry.demos);
  assert.equal(registry.buildRevision, revision);
  const informationalOnly = { ...registry, gitCommit: 'f'.repeat(40) };
  assert.equal(computeBuildRevision(informationalOnly.demos), revision);
  const changed = structuredClone(registry.demos);
  const primary = changed.find((demo) => ['canonical-lab', 'integration-demo'].includes(demo.kind));
  primary.sourceHash = `sha256:${'0'.repeat(64)}`;
  assert.notEqual(computeBuildRevision(changed), revision);
  const generatedDocs = join(REPO_ROOT, 'docs', 'demos', '.test-fixtures', 'revision-only');
  mkdirSync(generatedDocs, { recursive: true });
  writeFileSync(join(generatedDocs, 'index.html'), '<p>generated-only change</p>\n');
  assert.equal(buildDemoRegistry().buildRevision, revision);
});

test('every current example directory is explicitly classified', () => {
  const registry = buildDemoRegistry();
  const origins = Object.values(registry.origins);
  const covered = new Set(origins.filter((origin) => origin.canonicalDir?.includes('/examples/')).map((origin) => origin.canonicalDir));
  const inferred = origins.filter((origin) => origin.type === 'inferred-secondary');
  assert.ok(covered.size >= 45);
  assert.ok(inferred.every((origin) => covered.has(origin.canonicalDir)));
});

test('demo status is descriptive regardless of demo kind', () => {
  const registry = buildDemoRegistry();
  const proxy = structuredClone(registry.demos.find((demo) => demo.kind === 'proxy-demo'));
  proxy.status = 'accepted';
  const result = validateLabManifest(proxy, { validateEvidence: false });
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('accepted demo status does not require a repository evidence bundle', () => {
  const registry = buildDemoRegistry();
  const lab = structuredClone(registry.demos.find((demo) => demo.kind === 'canonical-lab' && !demo.nonRenderingScenarioSuite));
  lab.status = 'accepted';
  lab.tiers = lab.tiers.map((tier) => ({ ...tier, acceptanceStatus: 'accepted' }));
  lab.browserEntry = lab.browserEntry ?? lab.canonicalSource[0];
  lab.validationCommand = 'node validate.mjs';
  lab.evidenceBundle = null;
  const result = validateLabManifest(lab, { validateEvidence: false });
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('raw manifest validation rejects every field hidden by registry normalization', () => {
  assert.equal(validateRawLabManifest(rawManifestFixture()).valid, true);

  const mutations = [
    ['top-level statusReason', (raw) => { raw.statusReason = 'masked'; }],
    ['top-level acceptanceBlockers', (raw) => { raw.acceptanceBlockers = []; }],
    ['top-level performanceVerdict', (raw) => { raw.performanceVerdict = 'pending'; }],
    ['top-level owners', (raw) => { raw.owners = {}; }],
    ['route path alias', (raw) => { raw.scenarios[0].path = 'scenario/scene/'; }],
    ['route owner', (raw) => { raw.mechanisms[0].owner = 'pipeline'; }],
    ['route status alias', (raw) => { raw.mechanisms[0].status = 'incomplete'; }],
    ['tier route', (raw) => { raw.tiers[0].route = 'tier/full/'; }],
    ['requirement prose alias', (raw) => { raw.runtimeProof[0].requirement = 'renderer'; }],
    ['requirement requiredFor', (raw) => { raw.runtimeProof[0].requiredFor = ['claim']; }],
    ['requirement failure', (raw) => { raw.runtimeProof[0].failure = 'block'; }],
    ['requirement minimum', (raw) => { raw.runtimeProof[0].minimum = 4; }],
    ['requirement verdict', (raw) => { raw.runtimeProof[0].verdict = 'PASS'; }],
    ['non-enum evidence contract', (raw) => { raw.evidenceContract = 'visual-validation-v2'; }],
    ['missing requirement.required', (raw) => { delete raw.runtimeProof[0].required; }],
    ['non-enum requirement status', (raw) => { raw.runtimeProof[0].status = 'pending-browser-capture'; }],
    ['null command', (raw) => { raw.commands = { capture: null }; }],
  ];

  for (const [label, mutate] of mutations) {
    const candidate = rawManifestFixture();
    mutate(candidate);
    const result = validateRawLabManifest(candidate);
    assert.equal(result.valid, false, `${label} unexpectedly passed`);
  }
});

test('generated route contract preserves locked startup state', () => {
  const routes = plannedPublishedRoutes({
    id: 'fixture-lab',
    publishPath: '/demos/fixture-lab/',
    scenarios: [{ id: 'shot', startup: { scenario: 'shot', camera: 'near', time: 2 } }],
    mechanisms: [{ id: 'velocity', startup: { mode: 'velocity', seed: 1 } }],
    tiers: [{ id: 'full' }],
  });
  assert.deepEqual(routes[0], {
    kind: 'scenario',
    id: 'shot',
    path: '/demos/fixture-lab/scenario/shot/',
    startup: { scenario: 'shot', camera: 'near', time: 2 },
  });
  assert.deepEqual(routes[1].startup, { mode: 'velocity', seed: 1 });
  assert.deepEqual(routes[2].startup, {});
});

test('empty-startup mechanism wrappers select by query without calling setMode', () => {
  const contract = lockedRouteContract({
    labId: 'fixture-lab',
    kind: 'mechanism',
    id: 'velocity-and-history',
    startup: {},
  });
  assert.equal(contract.query, '?mechanism=velocity-and-history');
  assert.deepEqual(contract.startup, {});
  assert.deepEqual(contract.setterCalls, []);
  assert.equal(lockedRouteSelectionMatches({ mechanism: 'velocity-and-history' }, 'mechanism', 'velocity-and-history'), true);
  assert.equal(lockedRouteSelectionMatches({ mode: 'velocity-and-history' }, 'mechanism', 'velocity-and-history'), false);
  assert.equal(lockedRouteSelectionMatches({ mode: 'final' }, 'mechanism', 'velocity-and-history'), false);
  assert.equal(lockedRouteSelectionMatches(
    { scenario: 'inventory-drift', mode: 'route' },
    'mechanism',
    'inventory-intersection',
    { scenario: 'inventory-drift' },
  ), false);
  assert.equal(lockedRouteSelectionMatches(
    { scenario: 'inventory-drift', mechanism: 'inventory-intersection', mode: 'route' },
    'mechanism',
    'inventory-intersection',
    { scenario: 'inventory-drift' },
  ), true);
  assert.equal(lockedRouteSelectionMatches(
    { scenario: 'default', mechanism: 'inventory-intersection' },
    'mechanism',
    'inventory-intersection',
    { scenario: 'inventory-drift' },
  ), false);
  assert.equal(lockedRouteSelectionMatches({ routeSelection: { kind: 'tier', id: 'full' } }, 'tier', 'full'), true);
  assert.throws(() => lockedRouteContract({
    labId: 'fixture-lab', kind: 'mechanism', id: 'velocity-and-history', startup: { mechanism: 'velocity' },
  }), /unsupported locked startup keys: mechanism/);
});

test('emitted locked-route matcher requires direct route identity and every startup field', () => {
  const emittedMatcher = Function(`return (${lockedRouteSelectionMatchesWithKeys.toString()})`)();
  const acknowledgementKeys = ['mechanism', 'mechanismId'];
  const startupAcknowledgementKeys = {
    mode: ['mode', 'modeId'],
    camera: ['camera', 'cameraId'],
  };
  const startup = { mode: 'velocity', camera: 'design' };

  assert.equal(emittedMatcher(
    { mechanism: 'temporal', mode: 'velocity', camera: 'design' },
    'mechanism',
    'temporal',
    startup,
    acknowledgementKeys,
    startupAcknowledgementKeys,
  ), true);
  assert.equal(emittedMatcher(
    { mode: 'velocity', camera: 'design' },
    'mechanism',
    'temporal',
    startup,
    acknowledgementKeys,
    startupAcknowledgementKeys,
  ), false);
  assert.equal(emittedMatcher(
    { mechanism: 'temporal', mode: 'velocity', camera: 'far' },
    'mechanism',
    'temporal',
    startup,
    acknowledgementKeys,
    startupAcknowledgementKeys,
  ), false);
});

test('Pages smoke plan enumerates every primary base and fixed route from the registry', () => {
  const registry = buildDemoRegistry();
  const routes = plannedPagesSmokeRoutes({
    registry,
    skillIds: [...new Set(registry.demos.map((demo) => demo.skill))],
    primaryDemoKinds: PRIMARY_DEMO_KINDS,
  });
  const primaryBase = routes.filter((route) => route.category === 'primary-base');
  const primaryFixed = routes.filter((route) => route.category === 'primary-fixed');

  assert.equal(primaryBase.length, registry.counts.primary);
  assert.equal(primaryFixed.length, registry.counts.fixedRoutes);
  assert.equal(new Set(routes.map((route) => route.path)).size, routes.length);
  const browserRoutes = plannedPagesBrowserRoutes(routes);
  assert.equal(browserRoutes.length, primaryBase.length + primaryFixed.length);
  assert.ok(browserRoutes.every((route) => ['primary-base', 'primary-fixed'].includes(route.category)));
});

test('Pages smoke uses the authoritative skill roster rather than filesystem discovery', () => {
  const source = readFileSync(new URL('../../scripts/pages-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /authoritativeSkillDirs\(loadCanonicalTargets\(\)\)/);
  assert.match(source, /Pages smoke failed for \$\{route\.path\}/);
  assert.doesNotMatch(source, /readdirSync|startsWith\(['"]threejs-/);
});

test('Pages route identity rejects a Vite homepage fallback with HTTP 200', () => {
  const route = {
    path: '/demos/missing-lab/',
    category: 'primary-base',
    responseKind: 'html',
    labId: 'missing-lab',
  };
  assert.throws(() => assertPagesRouteResponse(route, {
    status: 200,
    url: 'http://127.0.0.1:4173/demos/missing-lab/',
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><title>Three.js WebGPU Skill Pack</title></head><body><main>homepage</main></body></html>',
  }), /does not identify demo missing-lab/);
});

test('Pages route identity accepts exact base and fixed demo markers', () => {
  assert.doesNotThrow(() => assertPagesRouteResponse({
    path: '/demos/fixture-lab/',
    category: 'primary-base',
    responseKind: 'html',
    labId: 'fixture-lab',
  }, {
    status: 200,
    url: 'http://127.0.0.1:4173/demos/fixture-lab/',
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><body><aside data-demo-id="fixture-lab"></aside></body></html>',
  }));
  assert.doesNotThrow(() => assertPagesRouteResponse({
    path: '/demos/fixture-lab/mechanism/velocity/',
    category: 'primary-fixed',
    responseKind: 'html',
    labId: 'fixture-lab',
    routeKind: 'mechanism',
    routeId: 'velocity',
  }, {
    status: 200,
    url: 'http://127.0.0.1:4173/demos/fixture-lab/mechanism/velocity/',
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta name="lab-id" content="fixture-lab"><meta name="lab-mechanism" content="velocity"></head><body></body></html>',
  }));
  assert.throws(() => assertPagesRouteResponse({
    path: '/demos/fixture-lab/mechanism/velocity/',
    category: 'primary-fixed',
    responseKind: 'html',
    labId: 'fixture-lab',
    routeKind: 'mechanism',
    routeId: 'velocity',
  }, {
    status: 200,
    url: 'http://127.0.0.1:4173/demos/fixture-lab/mechanism/velocity/',
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta name="lab-id" content="other-lab"><meta name="lab-mechanism" content="velocity"></head><body></body></html>',
  }), /does not identify demo fixture-lab/);
});

test('Pages browser observations require readiness, lab identity, WebGPU, locks, and clean errors', () => {
  const route = {
    path: '/demos/fixture-lab/mechanism/velocity/',
    category: 'primary-fixed',
    labId: 'fixture-lab',
    routeKind: 'mechanism',
    routeId: 'velocity',
    startup: { mode: 'velocity' },
    acknowledgementKeys: ['mechanism', 'mechanismId'],
    startupAcknowledgementKeys: { mode: ['mode', 'modeId'] },
    nonRenderingScenarioSuite: false,
  };
  const observation = {
    url: 'http://127.0.0.1:4173/demos/fixture-lab/mechanism/velocity/',
    ready: true,
    documentLabId: 'fixture-lab',
    controllerLabId: 'fixture-lab',
    lockedKind: 'mechanism',
    lockedId: 'velocity',
    routeMetrics: { mechanism: 'velocity', mode: 'velocity' },
    backendProof: {
      direct: {
        source: 'controller.renderer',
        isWebGPUBackend: true,
        initialized: true,
        deviceIdentityObserved: true,
        lossPromiseObservedOnActualDevice: true,
      },
      structured: null,
    },
    disposed: true,
    pageErrors: [],
    consoleErrors: [],
    requestErrors: [],
    deviceErrors: [],
  };

  assert.doesNotThrow(() => assertPagesBrowserObservation(route, observation));
  assert.throws(
    () => assertPagesBrowserObservation(route, { ...observation, routeMetrics: { mode: 'velocity' } }),
    /did not acknowledge locked mechanism velocity/,
  );
  assert.throws(
    () => assertPagesBrowserObservation(route, { ...observation, backendProof: null, nativeWebGPU: true }),
    /did not prove a native WebGPU backend/,
  );
  assert.throws(
    () => assertPagesBrowserObservation(route, { ...observation, documentLabId: 'other-lab' }),
    /document did not identify lab fixture-lab/,
  );
  assert.throws(
    () => assertPagesBrowserObservation(route, { ...observation, controllerLabId: 'other-lab' }),
    /controller did not identify lab fixture-lab/,
  );
  assert.throws(
    () => assertPagesBrowserObservation(route, { ...observation, ready: false }),
    /controller did not become ready/,
  );
  assert.throws(
    () => assertPagesBrowserObservation(route, {
      ...observation,
      url: 'http://127.0.0.1:4173/demos/fixture-lab/',
    }),
    /browser resolved to unexpected path/,
  );
  assert.throws(
    () => assertPagesBrowserObservation(route, { ...observation, lockedId: 'other-mechanism' }),
    /browser metadata did not preserve locked mechanism velocity/,
  );
  assert.throws(
    () => assertPagesBrowserObservation(route, { ...observation, disposed: false }),
    /controller was not disposed/,
  );
  for (const [key, label] of [
    ['pageErrors', 'page'],
    ['consoleErrors', 'console'],
    ['requestErrors', 'request'],
    ['deviceErrors', 'device'],
  ]) {
    assert.throws(
      () => assertPagesBrowserObservation(route, { ...observation, [key]: [`${label} failed`] }),
      new RegExp(`${label} errors: ${label} failed`),
    );
  }
});

test('Pages browser observations allow an explicitly non-rendering primary without WebGPU', () => {
  assert.doesNotThrow(() => assertPagesBrowserObservation({
    path: '/demos/router-manifest-lab/',
    category: 'primary-base',
    labId: 'router-manifest-lab',
    nonRenderingScenarioSuite: true,
  }, {
    url: 'http://127.0.0.1:4173/demos/router-manifest-lab/',
    ready: true,
    documentLabId: 'router-manifest-lab',
    controllerLabId: 'router-manifest-lab',
    backendProof: null,
    disposed: true,
    pageErrors: [],
    consoleErrors: [],
    requestErrors: [],
    deviceErrors: [],
  }));
});

test('Pages browser observations accept only complete structured backend identity evidence', () => {
  const route = {
    path: '/demos/structured-backend-lab/',
    category: 'primary-base',
    labId: 'structured-backend-lab',
    nonRenderingScenarioSuite: false,
  };
  const structured = {
    rendererBackendEvidence: {
      isWebGPUBackend: true,
      initialized: true,
      deviceIdentityVerified: true,
      lossPromiseObservedOnActualDevice: true,
    },
    rendererDeviceStatus: 'active',
    deviceLossGeneration: 0,
    deviceLostObserved: false,
    uncapturedErrors: [],
    deviceErrors: [],
    deviceErrorCount: 0,
    lastDeviceError: null,
  };
  const observation = {
    url: 'http://127.0.0.1:4173/demos/structured-backend-lab/',
    ready: true,
    documentLabId: 'structured-backend-lab',
    controllerLabId: 'structured-backend-lab',
    backendProof: { direct: null, structured },
    disposed: true,
    pageErrors: [],
    consoleErrors: [],
    requestErrors: [],
    deviceErrors: [],
  };

  assert.doesNotThrow(() => assertPagesBrowserObservation(route, observation));
  assert.throws(() => assertPagesBrowserObservation(route, {
    ...observation,
    backendProof: {
      direct: null,
      structured: {
        ...structured,
        rendererBackendEvidence: {
          ...structured.rendererBackendEvidence,
          lossPromiseObservedOnActualDevice: false,
        },
      },
    },
  }), /did not prove a native WebGPU backend/);
});

test('locked scenario and tier routes always apply their declared controller state', () => {
  const tier = lockedRouteContract({
    labId: 'fixture-lab',
    kind: 'tier',
    id: 'minimum',
    startup: {},
  });
  assert.deepEqual(tier.startup, { tier: 'minimum' });
  assert.deepEqual(tier.setterCalls, [{ setter: 'setTier', value: 'minimum' }]);

  const scenario = lockedRouteContract({
    labId: 'fixture-lab',
    kind: 'scenario',
    id: 'stress',
    startup: { camera: 'far' },
  });
  assert.deepEqual(scenario.startup, { camera: 'far', scenario: 'stress' });
  assert.deepEqual(scenario.setterCalls, [
    { setter: 'setScenario', value: 'stress' },
    { setter: 'setCamera', value: 'far' },
  ]);
  const aliasedTier = lockedRouteContract({
    labId: 'fixture-lab',
    kind: 'tier',
    id: 'minimum-presentation',
    startup: { tier: 'full' },
  });
  assert.deepEqual(aliasedTier.startup, { tier: 'full' });
  assert.deepEqual(aliasedTier.setterCalls, [{ setter: 'setTier', value: 'full' }]);
});

test('locked route controller discovery accepts exposure after iframe load', async () => {
  const expected = { ready: async () => {} };
  const emittedWaiter = Function(`return (${awaitLockedRouteController.toString()})`)();
  let clockMs = 0;
  let reads = 0;
  const controller = await emittedWaiter(
    () => {
      reads += 1;
      return reads < 3 ? null : expected;
    },
    {
      timeoutMs: 120,
      pollIntervalMs: 50,
      now: () => clockMs,
      sleep: async (milliseconds) => { clockMs += milliseconds; },
    },
  );
  assert.equal(controller, expected);
  assert.equal(reads, 3);
  assert.equal(clockMs, 100);
});

test('locked route controller discovery resolves a promised controller', async () => {
  const expected = { ready: async () => {} };
  assert.equal(
    await awaitLockedRouteController(() => Promise.resolve(expected), { timeoutMs: 120 }),
    expected,
  );
});

test('locked route controller discovery fails closed at its exact deadline', async () => {
  let clockMs = 0;
  await assert.rejects(
    awaitLockedRouteController(
      () => null,
      {
        timeoutMs: 120,
        pollIntervalMs: 50,
        now: () => clockMs,
        sleep: async (milliseconds) => { clockMs += milliseconds; },
      },
    ),
    new RegExp(`LabController alias.*${LAB_CONTROLLER_GLOBALS.join(', ')}.*120 ms`),
  );
  assert.equal(clockMs, 120);
});

test('locked route controller discovery surfaces child blockers before polling', async () => {
  let sleepCalls = 0;
  await assert.rejects(
    awaitLockedRouteController(
      () => null,
      {
        resolveBlocker: () => 'renderer initialization failed',
        sleep: async () => { sleepCalls += 1; },
      },
    ),
    /initialization blocker: renderer initialization failed/,
  );
  assert.equal(sleepCalls, 0);
});

test('browser-free quick validation permits capture syntax checks but rejects execution', () => {
  assert.equal(quickCommandStartsBrowser('node --check capture.mjs'), false);
  assert.equal(quickCommandStartsBrowser('node --check scripts/browser-capture.mjs && node validate.mjs'), false);
  assert.equal(quickCommandStartsBrowser('node capture.mjs'), true);
  assert.equal(quickCommandStartsBrowser('playwright test'), true);
  assert.equal(quickCommandStartsBrowser('vite preview'), true);
  assert.equal(quickCommandStartsBrowser('npm run capture'), true);
  assert.equal(quickCommandStartsBrowser('npm --prefix . run capture'), true);
  assert.equal(quickCommandStartsBrowser('npm run labs:capture'), true);
  assert.equal(quickCommandStartsBrowser('bash capture.sh'), true);
  assert.equal(quickCommandStartsBrowser('node browser.mjs'), true);
  assert.equal(quickCommandStartsBrowser('node --input-type=module -e "await import(\'./browser-module.mjs\')"'), false);
});

test('check-only quick validation rejects tracked-source generators', () => {
  assert.equal(quickCommandWritesTrackedSources('node --check generate-routes.mjs && node validate-routes.mjs'), false);
  assert.equal(quickCommandWritesTrackedSources('node validate-generated-starfields.mjs'), false);
  assert.equal(quickCommandWritesTrackedSources('npm run generate:routes:check'), false);
  assert.equal(quickCommandWritesTrackedSources('node generate-routes.mjs --check'), false);
  assert.equal(quickCommandWritesTrackedSources('npm run generate:routes:check (node generate-routes.mjs)'), true);
  assert.equal(quickCommandWritesTrackedSources('npm run generate:routes && node validate-routes.mjs'), true);
  assert.equal(quickCommandWritesTrackedSources('node generate-routes.mjs'), true);
  assert.equal(quickCommandWritesTrackedSources('node scripts/generate-routes.mjs'), true);
  assert.equal(quickCommandWritesTrackedSources('node build-pages.mjs'), true);
  assert.equal(quickCommandWritesTrackedSources('node promote-runtime-evidence.mjs'), true);
});

test('canonical packages may omit root browser dependencies but cannot range or drift them', () => {
  const expected = { three: '0.185.1', playwright: '1.61.1', vite: '8.1.3' };
  assert.deepEqual(browserDependencyDrift({ scripts: {} }, expected), []);
  assert.deepEqual(browserDependencyDrift({
    dependencies: { three: '0.185.1' },
    devDependencies: { playwright: '1.61.1', vite: '8.1.3' },
  }, expected), []);
  assert.deepEqual(browserDependencyDrift({
    dependencies: { three: '^0.185.1' },
    devDependencies: { playwright: '^1.45.0' },
  }, expected), [
    'dependencies.three must equal root 0.185.1; received ^0.185.1',
    'devDependencies.playwright must equal root 1.61.1; received ^1.45.0',
  ]);
});

test('manifest npm prefixes cannot escape or broaden the canonical lab directory', () => {
  assert.deepEqual(manifestCommandPrefixDrift({
    test: 'npm --prefix integration-labs/final-image-flight run validate:unit',
    check: 'npm run check',
  }, 'integration-labs/final-image-flight'), []);
  assert.deepEqual(manifestCommandPrefixDrift({
    test: 'npm --prefix integration-labs run validate:unit',
  }, 'integration-labs/final-image-flight'), [
    'commands.test prefixes integration-labs instead of integration-labs/final-image-flight',
  ]);
  assert.deepEqual(manifestCommandPrefixDrift({
    test: 'npm --silent --prefix=.. run validate:unit',
  }, 'integration-labs/final-image-flight'), [
    'commands.test prefixes .. instead of integration-labs/final-image-flight',
  ]);
  assert.equal(obviousNoOpCommand('true'), true);
  assert.equal(obviousNoOpCommand('echo looks-valid'), true);
  assert.equal(obviousNoOpCommand('node validate.mjs'), false);
});

test('root browser toolchain is exact in package declarations and lock resolutions', () => {
  const versions = { three: '0.185.1', playwright: '1.61.1', vite: '8.1.3' };
  const packageJson = {
    dependencies: { three: '0.185.1' },
    devDependencies: { playwright: '1.61.1', vite: '8.1.3' },
  };
  const packageLock = {
    packages: {
      '': { dependencies: packageJson.dependencies, devDependencies: packageJson.devDependencies },
      'node_modules/three': { version: '0.185.1' },
      'node_modules/playwright': { version: '1.61.1' },
      'node_modules/vite': { version: '8.1.3' },
    },
  };
  assert.deepEqual(rootBrowserToolchainDrift(packageJson, packageLock, versions), []);
  packageLock.packages['node_modules/vite'].version = '8.1.2';
  assert.deepEqual(rootBrowserToolchainDrift(packageJson, packageLock, versions), [
    'root lock resolution vite must equal 8.1.3; received 8.1.2',
  ]);
});

test('external npm prefix delegation is not expanded as a local package cycle', () => {
  const packageDir = join(REPO_ROOT, 'threejs-image-pipeline/examples/webgpu-temporal-history');
  const delegated = {
    scripts: { capture: 'npm --prefix ../webgpu-image-pipeline run capture' },
  };
  assert.equal(
    expandLocalPackageScript(delegated, 'capture', packageDir),
    'npm --prefix ../webgpu-image-pipeline run capture',
  );
  const localCycle = {
    scripts: { capture: 'npm --prefix . run capture' },
  };
  assert.match(expandLocalPackageScript(localCycle, 'capture', packageDir), /recursive-script:capture/);
});

test('capture profiles pass through npm after the argument separator', () => {
  assert.deepEqual(
    appendCaptureProfile(['npm', '--prefix', 'lab', 'run', 'capture'], 'correctness'),
    ['npm', '--prefix', 'lab', 'run', 'capture', '--', '--profile', 'correctness'],
  );
  assert.deepEqual(
    appendCaptureProfile(['node', 'capture.mjs'], 'performance'),
    ['node', 'capture.mjs', '--profile', 'performance'],
  );
  assert.throws(
    () => appendCaptureProfile(['node', 'capture.mjs'], 'invented'),
    /unknown capture profile/,
  );
});

test('frozen-target hashing includes unlisted transitive imports in the canonical directory', () => {
  const fixtureDir = retainedFixtureDirectory('source-hash-mutation');
  const canonicalDir = relative(REPO_ROOT, fixtureDir).split(sep).join('/');
  const browserEntry = `${canonicalDir}/index.html`;
  const app = `${canonicalDir}/app.mjs`;
  const unlistedImport = join(fixtureDir, 'kernel.mjs');
  writeFileSync(join(fixtureDir, 'index.html'), '<script type="module" src="./app.mjs"></script>\n');
  writeFileSync(join(fixtureDir, 'app.mjs'), "import { value } from './kernel.mjs';\nwindow.value = value;\n");
  writeFileSync(unlistedImport, 'export const value = 1;\n');
  const manifest = {
    canonicalSource: [browserEntry, app],
    browserEntry,
  };
  manifest.sourceHashInputs = computeManifestSourceHashInputs(manifest, { canonicalDir });
  assert.deepEqual(manifest.sourceHashInputs, [canonicalDir]);
  assert.equal(manifest.canonicalSource.includes(`${canonicalDir}/kernel.mjs`), false);
  const before = computeManifestSourceHash(manifest);
  writeFileSync(unlistedImport, 'export const value = 2;\n');
  const after = computeManifestSourceHash(manifest);
  assert.notEqual(after, before);
});

test('frozen-target hashing follows browser imports outside the canonical directory', () => {
  const fixtureDir = retainedFixtureDirectory('source-hash-browser');
  const externalDir = retainedFixtureDirectory('source-hash-external');
  const canonicalDir = relative(REPO_ROOT, fixtureDir).split(sep).join('/');
  const browserEntry = `${canonicalDir}/index.html`;
  const externalFile = join(externalDir, 'shared-stage.mjs');
  let browserImport = relative(fixtureDir, externalFile).split(sep).join('/');
  if (!browserImport.startsWith('.')) browserImport = `./${browserImport}`;
  writeFileSync(join(fixtureDir, 'index.html'), '<script type="module" src="./app.mjs"></script>\n');
  writeFileSync(join(fixtureDir, 'app.mjs'), `import { stage } from '${browserImport}';\nwindow.stage = stage;\n`);
  writeFileSync(externalFile, 'export const stage = 1;\n');
  const manifest = {
    canonicalSource: [browserEntry],
    browserEntry,
  };
  manifest.sourceHashInputs = computeManifestSourceHashInputs(manifest, { canonicalDir });
  const externalRepoPath = relative(REPO_ROOT, externalFile).split(sep).join('/');
  assert.ok(manifest.sourceHashInputs.includes(canonicalDir));
  assert.ok(manifest.sourceHashInputs.includes(externalRepoPath));
  const before = computeManifestSourceHash(manifest);
  writeFileSync(externalFile, 'export const stage = 2;\n');
  assert.notEqual(computeManifestSourceHash(manifest), before);
});

test('published bundle hashing detects emitted output drift without hashing its own metadata', () => {
  const fixtureDir = retainedFixtureDirectory('published-hash-mutation');
  const input = relative(REPO_ROOT, fixtureDir).split(sep).join('/');
  writeFileSync(join(fixtureDir, 'index.html'), '<main>one</main>\n');
  writeFileSync(join(fixtureDir, 'source-manifest.json'), '{"publishedBundleHash":"placeholder"}\n');
  const before = computePublishedBundleHash(REPO_ROOT, [input]);
  writeFileSync(join(fixtureDir, 'source-manifest.json'), '{"publishedBundleHash":"changed-metadata"}\n');
  assert.equal(computePublishedBundleHash(REPO_ROOT, [input]), before);
  writeFileSync(join(fixtureDir, 'index.html'), '<main>two</main>\n');
  assert.notEqual(computePublishedBundleHash(REPO_ROOT, [input]), before);
});
