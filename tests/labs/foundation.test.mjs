import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  REPO_ROOT,
  buildDemoRegistry,
  computeBuildRevision,
  computeManifestSourceHash,
  computeManifestSourceHashInputs,
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
  rootBrowserToolchainDrift,
} from '../../scripts/lib/lab-command-policy.mjs';

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
  lockedRouteContract,
  lockedRouteSelectionMatches,
  plannedPublishedRoutes,
} from '../../scripts/lib/page-routes.mjs';

test('inventory freezes exactly 26 skills and all five integrations', () => {
  const registry = buildDemoRegistry();
  assert.equal(registry.skillsExpected, 26);
  assert.equal(registry.counts.skills, registry.skillsExpected);
  assert.deepEqual(
    [...registry.integrationIds].sort(),
    ['creature-habitat', 'final-image-flight', 'procedural-district', 'relativistic-space-shot', 'weathered-world'],
  );
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
  const generatedDocs = mkdtempSync(join(REPO_ROOT, 'docs', 'demos', '.revision-only-'));
  try {
    writeFileSync(join(generatedDocs, 'index.html'), '<p>generated-only change</p>\n');
    assert.equal(buildDemoRegistry().buildRevision, revision);
  } finally {
    rmSync(generatedDocs, { recursive: true, force: true });
  }
});

test('every current example directory is explicitly classified', () => {
  const registry = buildDemoRegistry();
  const origins = Object.values(registry.origins);
  const covered = new Set(origins.filter((origin) => origin.canonicalDir?.includes('/examples/')).map((origin) => origin.canonicalDir));
  const inferred = origins.filter((origin) => origin.type === 'inferred-secondary');
  assert.ok(covered.size >= 45);
  assert.ok(inferred.every((origin) => covered.has(origin.canonicalDir)));
});

test('secondary and proxy demos can never be accepted', () => {
  const registry = buildDemoRegistry();
  const proxy = structuredClone(registry.demos.find((demo) => demo.kind === 'proxy-demo'));
  proxy.status = 'accepted';
  const result = validateLabManifest(proxy, { validateEvidence: false });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('cannot have accepted status')));
});

test('accepted rendering claims require real bundle and runtime proof', () => {
  const registry = buildDemoRegistry();
  const lab = structuredClone(registry.demos.find((demo) => demo.kind === 'canonical-lab' && !demo.nonRenderingScenarioSuite));
  lab.status = 'accepted';
  lab.tiers = lab.tiers.map((tier) => ({ ...tier, acceptanceStatus: 'accepted' }));
  lab.browserEntry = lab.browserEntry ?? lab.canonicalSource[0];
  lab.validationCommand = 'node validate.mjs';
  lab.evidenceBundle = null;
  const result = validateLabManifest(lab, { validateEvidence: false });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('evidenceBundle')));
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
  assert.equal(lockedRouteSelectionMatches({ mode: 'velocity-and-history' }, 'mechanism', 'velocity-and-history'), true);
  assert.equal(lockedRouteSelectionMatches({ mode: 'final' }, 'mechanism', 'velocity-and-history'), false);
  assert.equal(lockedRouteSelectionMatches(
    { scenario: 'inventory-drift', mode: 'route' },
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
  const fixtureDir = mkdtempSync(join(REPO_ROOT, '.source-hash-mutation-'));
  const canonicalDir = relative(REPO_ROOT, fixtureDir).split(sep).join('/');
  const browserEntry = `${canonicalDir}/index.html`;
  const app = `${canonicalDir}/app.mjs`;
  const unlistedImport = join(fixtureDir, 'kernel.mjs');
  try {
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
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('frozen-target hashing follows browser imports outside the canonical directory', () => {
  const fixtureDir = mkdtempSync(join(REPO_ROOT, '.source-hash-browser-'));
  const externalDir = mkdtempSync(join(REPO_ROOT, '.source-hash-external-'));
  const canonicalDir = relative(REPO_ROOT, fixtureDir).split(sep).join('/');
  const browserEntry = `${canonicalDir}/index.html`;
  const externalFile = join(externalDir, 'shared-stage.mjs');
  let browserImport = relative(fixtureDir, externalFile).split(sep).join('/');
  if (!browserImport.startsWith('.')) browserImport = `./${browserImport}`;
  try {
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
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  }
});

test('published bundle hashing detects emitted output drift without hashing its own metadata', () => {
  const fixtureDir = mkdtempSync(join(REPO_ROOT, '.published-hash-mutation-'));
  const input = relative(REPO_ROOT, fixtureDir).split(sep).join('/');
  try {
    writeFileSync(join(fixtureDir, 'index.html'), '<main>one</main>\n');
    writeFileSync(join(fixtureDir, 'source-manifest.json'), '{"publishedBundleHash":"placeholder"}\n');
    const before = computePublishedBundleHash(REPO_ROOT, [input]);
    writeFileSync(join(fixtureDir, 'source-manifest.json'), '{"publishedBundleHash":"changed-metadata"}\n');
    assert.equal(computePublishedBundleHash(REPO_ROOT, [input]), before);
    writeFileSync(join(fixtureDir, 'index.html'), '<main>two</main>\n');
    assert.notEqual(computePublishedBundleHash(REPO_ROOT, [input]), before);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
