import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertImagePipelineGraph,
  createImagePipelineHost,
} from '../../labs/runtime/image-pipeline-host.mjs';
import { numericDatum } from '../../labs/runtime/numeric-evidence.mjs';
import {
  assertEnvironmentForcingSnapshot,
  assertPhysicsContext,
  assertPhysicsGraph,
  createEnvironmentForcingSnapshot,
  createPhysicsContext,
  createPhysicsGraph,
  createPhysicsStateSnapshot,
  PHYSICS_INTEGRATION_CONTRACT_SCOPE,
} from '../../labs/runtime/physics-integration-contracts.mjs';

class FakeWebGPURenderer {
  constructor({ native = true, compatibilityMode = false } = {}) {
    this.samples = 1;
    this.initCount = 0;
    this.backend = {
      isWebGPUBackend: native,
      compatibilityMode,
      device: { limits: { maxColorAttachments: 8 } },
    };
  }

  async init() {
    this.initCount += 1;
  }
}

function imagePipelineGraph() {
  return {
    schemaVersion: 2,
    owners: {
      renderer: 'renderer-owner',
      renderPipeline: 'pipeline-owner',
      toneMap: 'output-owner',
      outputTransform: 'output-owner',
    },
    signals: [
      {
        id: 'sceneLinearHDR',
        producer: 'lit-pass',
        consumers: ['present'],
        reachable: true,
        encoding: 'scene-linear-hdr',
      },
      {
        id: 'depth',
        producer: 'gbuffer-pass',
        consumers: ['ao-pass', 'lit-pass'],
        reachable: true,
        encoding: 'renderer-depth',
      },
      {
        id: 'normal',
        producer: 'gbuffer-pass',
        consumers: ['ao-pass', 'lit-pass'],
        reachable: true,
        encoding: 'view-normal',
      },
      {
        id: 'emissive',
        producer: 'lit-pass',
        consumers: ['present'],
        reachable: true,
        encoding: 'scene-linear-hdr-contribution',
      },
      {
        id: 'ambientVisibility',
        producer: 'ao-pass',
        consumers: ['lit-pass'],
        reachable: true,
        encoding: 'ambient-visibility',
      },
    ],
    sceneSubmissions: [
      {
        id: 'gbuffer-pass',
        owner: 'pipeline-owner',
        sequence: 0,
        kind: 'prepass',
        reads: [],
        writes: ['depth', 'normal'],
        aoRole: 'gbuffer-prepass',
        fullLitOutput: false,
      },
      {
        id: 'ao-pass',
        owner: 'ao-owner',
        sequence: 1,
        kind: 'post',
        reads: ['depth', 'normal'],
        writes: ['ambientVisibility'],
      },
      {
        id: 'lit-pass',
        owner: 'pipeline-owner',
        sequence: 2,
        kind: 'lit-scene',
        reads: ['depth', 'normal', 'ambientVisibility'],
        writes: ['sceneLinearHDR', 'emissive'],
        aoRole: 'lit-pass',
        fullLitOutput: true,
        aoArchitecture: {
          gbufferPrepassCount: 1,
          litScenePassCount: 1,
          sceneSubmissionCount: 2,
          fullLitOutputCount: 1,
        },
      },
      {
        id: 'present',
        owner: 'output-owner',
        sequence: 3,
        kind: 'present',
        reads: ['sceneLinearHDR', 'emissive'],
        writes: [],
        outputTransformMode: 'render-output-node',
        toneMapOwner: 'output-owner',
        outputTransformOwner: 'output-owner',
      },
    ],
    computeDispatches: [],
    resources: [
      {
        id: 'gbuffer-targets',
        owner: 'pipeline-owner',
        kind: 'render-targets',
        consumers: ['gbuffer-pass', 'ao-pass', 'lit-pass'],
        residentBytes: numericDatum(4096, 'bytes', 'Derived', 'declared test target layout'),
      },
      {
        id: 'present-target',
        owner: 'output-owner',
        kind: 'presentation-target',
        consumers: ['present'],
        residentBytes: numericDatum(2048, 'bytes', 'Derived', 'declared test target layout'),
      },
    ],
    finalToneMapOwner: 'output-owner',
    finalOutputTransformOwner: 'output-owner',
  };
}

function imageHostOptions(overrides = {}) {
  const renderer = overrides.renderer ?? new FakeWebGPURenderer();
  const graph = overrides.graph ?? imagePipelineGraph();
  const renderPipeline = { renderer, outputColorTransform: false, needsUpdate: true };
  return {
    renderer,
    renderPipeline,
    signals: {
      sceneLinearHDR: {},
      depth: {},
      normal: {},
      emissive: {},
    },
    rendererOwner: 'renderer-owner',
    renderPipelineOwner: 'pipeline-owner',
    finalToneMapOwner: 'output-owner',
    finalOutputTransformOwner: 'output-owner',
    setDiagnosticMode: async (id) => {
      graph.signals.find((signal) => signal.id === 'sceneLinearHDR').encoding = `scene-linear-hdr:${id}`;
      renderPipeline.needsUpdate = true;
    },
    resetHistory: async () => {},
    describePipeline: () => graph,
    diagnosticModes: ['final', 'normal'],
    initialDiagnosticMode: 'final',
    aoMode: 'material-context-screen-space',
    threeRevision: '185',
    ...overrides.options,
  };
}

function physicsFixture() {
  const fixedStepSeconds = 0.5;
  const previousState = createPhysicsStateSnapshot({
    tick: 1,
    fixedStepSeconds,
    state: { waterHeightMeters: 0.1 },
    stateUnits: { waterHeightMeters: 'meter' },
  });
  const currentState = createPhysicsStateSnapshot({
    tick: 2,
    fixedStepSeconds,
    state: { waterHeightMeters: 0.12 },
    stateUnits: { waterHeightMeters: 'meter' },
  });
  const forcing = createEnvironmentForcingSnapshot({
    source: 'fixture-authored environment coordinator',
    seed: 1,
    timeSeconds: 1,
    wind: [2, 0, 1],
    temperatureK: 289,
    precipitationRate: 0.001,
    cloudForcing: 0.4,
    waterForcing: 0.25,
  });
  const context = createPhysicsContext({
    worldUnitsPerMeter: 10,
    fixedStepSeconds,
    currentTick: 2,
    previousState,
    currentState,
    forcing,
  });
  const graphInput = {
    context,
    producers: {
      forcing: 'environment',
      waterState: 'water',
      committedWater: 'water',
    },
    consumers: {
      forcing: ['advance-water'],
      waterState: ['commit-water'],
      committedWater: ['present-water'],
    },
    coordination: [
      {
        id: 'publish-forcing',
        owner: 'environment',
        reads: [],
        writes: ['forcing'],
        costId: 'cost-publish-forcing',
      },
      {
        id: 'advance-water',
        owner: 'water',
        reads: ['forcing'],
        writes: ['waterState'],
        costId: 'cost-advance-water',
      },
    ],
    commits: [
      {
        id: 'commit-water',
        owner: 'water',
        reads: ['waterState'],
        writes: ['committedWater'],
        costId: 'cost-commit-water',
      },
    ],
    presentation: [
      {
        id: 'present-water',
        owner: 'presentation',
        reads: ['committedWater'],
        writes: [],
        costId: 'cost-present-water',
      },
    ],
    costs: [
      {
        id: 'cost-publish-forcing',
        owner: 'environment',
        scope: 'coordination',
        accounting: 'unmeasured-contract',
        includes: ['publish-forcing'],
      },
      {
        id: 'cost-advance-water',
        owner: 'water',
        scope: 'coordination',
        accounting: 'unmeasured-contract',
        includes: ['advance-water'],
      },
      {
        id: 'cost-commit-water',
        owner: 'water',
        scope: 'commit',
        accounting: 'unmeasured-contract',
        includes: ['commit-water'],
      },
      {
        id: 'cost-present-water',
        owner: 'presentation',
        scope: 'presentation',
        accounting: 'unmeasured-contract',
        includes: ['present-water'],
      },
    ],
  };
  return { forcing, context, graphInput };
}

test('image pipeline host binds one initialized native-WebGPU renderer and owner graph', async () => {
  const options = imageHostOptions();
  const host = await createImagePipelineHost(options);

  assert.equal(options.renderer.initCount, 1);
  assert.equal(host.backendPolicy.unsupported, 'block');
  assert.equal(host.backendPolicy.fallback, 'forbidden');
  assert.equal(host.renderPipeline.renderer, host.renderer);
  assert(Object.isFrozen(host));

  const graph = host.describePipeline();
  assert(Object.isFrozen(graph));
  assert(Object.isFrozen(graph.signals));
  assert.equal(assertImagePipelineGraph(graph), true);
  await host.setDiagnosticMode('normal');
  await assert.rejects(host.setDiagnosticMode('missing'), /unknown diagnostic mode/);
  await host.resetHistory('camera-cut');

  host.renderPipeline.outputColorTransform = true;
  assert.throws(() => host.describePipeline(), /outputColorTransform conflicts/);
  host.renderPipeline.outputColorTransform = false;
});

test('image pipeline graph rejects duplicate owners, producers, and private replacements', () => {
  const ambiguousOwner = imagePipelineGraph();
  ambiguousOwner.owners.renderer = 'renderer-one,renderer-two';
  assert.throws(() => assertImagePipelineGraph(ambiguousOwner), /one unambiguous identifier/);

  const duplicateProducer = imagePipelineGraph();
  duplicateProducer.signals.push({ ...duplicateProducer.signals[0] });
  assert.throws(() => assertImagePipelineGraph(duplicateProducer), /duplicate producer declarations/);

  const privateReplacement = imagePipelineGraph();
  privateReplacement.sceneSubmissions[1].privateSignalSubstitutions = ['normal'];
  assert.throws(() => assertImagePipelineGraph(privateReplacement), /private shared-signal substitution/);

  const ownerWildcard = imagePipelineGraph();
  ownerWildcard.signals.find((signal) => signal.id === 'normal').consumers = ['pipeline-owner'];
  assert.throws(() => assertImagePipelineGraph(ownerWildcard), /consumer pipeline-owner is not reachable/);

  const hiddenProperty = imagePipelineGraph();
  Object.defineProperty(hiddenProperty.sceneSubmissions[1], 'privateSignalSubstitutions', {
    value: ['normal'],
    enumerable: false,
  });
  assert.throws(() => assertImagePipelineGraph(hiddenProperty), /must be enumerable/);

  const duplicateWriter = imagePipelineGraph();
  duplicateWriter.sceneSubmissions.push({
    id: 'foreign-depth-writer',
    owner: 'post-owner',
    sequence: 4,
    kind: 'post',
    reads: ['sceneLinearHDR'],
    writes: ['depth'],
  });
  duplicateWriter.signals.find((signal) => signal.id === 'sceneLinearHDR')
    .consumers.push('foreign-depth-writer');
  assert.throws(() => assertImagePipelineGraph(duplicateWriter), /exactly one reachable declared producer/);
});

test('material-context AO rejects a false one-submission architecture claim', () => {
  const graph = imagePipelineGraph();
  graph.sceneSubmissions = graph.sceneSubmissions.filter((pass) => pass.id !== 'gbuffer-pass');
  assert.throws(
    () => assertImagePipelineGraph(graph),
    /one g-buffer prepass, one lit pass, two scene submissions/,
  );

  const hiddenTraversal = imagePipelineGraph();
  hiddenTraversal.sceneSubmissions.splice(2, 0, {
    id: 'hidden-lit-pass',
    owner: 'pipeline-owner',
    sequence: 2,
    kind: 'lit-scene',
    reads: ['depth', 'normal'],
    writes: [],
  });
  hiddenTraversal.sceneSubmissions
    .filter((pass) => pass.sequence >= 2 && pass.id !== 'hidden-lit-pass')
    .forEach((pass) => { pass.sequence += 1; });
  assert.throws(
    () => assertImagePipelineGraph(hiddenTraversal),
    /one g-buffer prepass, one lit pass, two scene submissions/,
  );

  const omittedDeclaration = imagePipelineGraph();
  for (const pass of omittedDeclaration.sceneSubmissions) {
    delete pass.aoRole;
    delete pass.aoArchitecture;
    delete pass.fullLitOutput;
  }
  assert.throws(
    () => assertImagePipelineGraph(omittedDeclaration),
    /one g-buffer prepass, one lit pass, two scene submissions/,
  );
});

test('image graph rejects malformed runtime fields and incomplete presentation closure', () => {
  const badEncoding = imagePipelineGraph();
  badEncoding.signals[0].encoding = 42;
  assert.throws(() => assertImagePipelineGraph(badEncoding), /encoding must be a non-empty string/);

  const emptySource = imagePipelineGraph();
  emptySource.resources[0].residentBytes = {
    ...emptySource.resources[0].residentBytes,
    source: '',
  };
  assert.throws(() => assertImagePipelineGraph(emptySource), /residentBytes/);

  const zeroDispatch = imagePipelineGraph();
  zeroDispatch.signals.push({
    id: 'computedMask',
    producer: 'zero-dispatch',
    consumers: ['present'],
    reachable: true,
    encoding: 'data-mask',
  });
  zeroDispatch.computeDispatches.push({
    id: 'zero-dispatch',
    owner: 'compute-owner',
    sequence: 4,
    workgroups: {
      values: [0, 1, 1],
      unit: 'workgroups',
      label: 'Derived',
      source: 'test dispatch extent',
    },
    reads: [],
    writes: ['computedMask'],
  });
  zeroDispatch.sceneSubmissions.find((pass) => pass.id === 'present').reads.push('computedMask');
  assert.throws(() => assertImagePipelineGraph(zeroDispatch), /zero-work dispatch/);

  const missingFinal = imagePipelineGraph();
  const present = missingFinal.sceneSubmissions.find((pass) => pass.id === 'present');
  present.reads = present.reads.filter((signalId) => signalId !== 'sceneLinearHDR');
  present.sequence = 4;
  missingFinal.sceneSubmissions.splice(missingFinal.sceneSubmissions.length - 1, 0, {
    id: 'diagnostic-hdr-consumer',
    owner: 'diagnostic-owner',
    sequence: 3,
    kind: 'diagnostic',
    reads: ['sceneLinearHDR'],
    writes: [],
  });
  missingFinal.signals.find((signal) => signal.id === 'sceneLinearHDR').consumers = [
    'diagnostic-hdr-consumer',
  ];
  assert.throws(() => assertImagePipelineGraph(missingFinal), /must consume sceneLinearHDR/);
});

test('canonical image host blocks unsupported WebGPU and hidden fallback options', async () => {
  await assert.rejects(
    createImagePipelineHost(imageHostOptions({ renderer: new FakeWebGPURenderer({ native: false }) })),
    /Unsupported WebGPU is a blocker; no fallback was activated/,
  );

  const hiddenFallback = imageHostOptions();
  hiddenFallback.allowFallback = true;
  await assert.rejects(
    createImagePipelineHost(hiddenFallback),
    /forbids hidden fallback option allowFallback/,
  );

  await assert.rejects(
    createImagePipelineHost(imageHostOptions({
      renderer: new FakeWebGPURenderer({ compatibilityMode: true }),
    })),
    /compatibility fallback is blocked/,
  );

  const dirtyWitness = imageHostOptions();
  dirtyWitness.setDiagnosticMode = async (id) => {
    dirtyWitness.describePipeline()
      .signals.find((signal) => signal.id === 'sceneLinearHDR').encoding = `scene-linear-hdr:${id}`;
  };
  const dirtyHost = await createImagePipelineHost(dirtyWitness);
  await assert.rejects(
    dirtyHost.setDiagnosticMode('normal'),
    /must set renderPipeline.needsUpdate = true/,
  );
});

test('forcing and physics context freeze exact SI, unit-scale, fixed-step, and tick state', () => {
  const { forcing, context } = physicsFixture();
  assert.equal(assertEnvironmentForcingSnapshot(forcing), true);
  assert.equal(assertPhysicsContext(context), true);
  assert(Object.isFrozen(forcing.wind));
  assert(Object.isFrozen(context.currentState.state));
  assert.equal(forcing.provenance.claim, 'not-meteorological-synthesis');
  assert.equal(context.unitConvention, 'world-units-per-meter');
  assert.equal(context.contractScope, PHYSICS_INTEGRATION_CONTRACT_SCOPE.id);
  assert.equal(context.previousState.tick, context.currentTick - 1);
  assert.equal(context.currentState.tick, context.currentTick);
});

test('forcing and physics context reject malformed units, values, and ticks', () => {
  assert.throws(() => createEnvironmentForcingSnapshot({
    source: 'invalid temperature fixture',
    seed: 1,
    timeSeconds: 0,
    wind: [0, 0, 0],
    temperatureK: -1,
    precipitationRate: 0,
    cloudForcing: 0,
    waterForcing: 0,
  }), /temperatureK/);

  assert.throws(() => createEnvironmentForcingSnapshot({
    source: 'invalid wind fixture',
    seed: 1,
    timeSeconds: 0,
    wind: [0, 0],
    temperatureK: 273,
    precipitationRate: 0,
    cloudForcing: 0,
    waterForcing: 0,
  }), /exactly three components/);

  const { forcing } = physicsFixture();
  const fixedStepSeconds = 0.5;
  assert.throws(() => createPhysicsContext({
    worldUnitsPerMeter: 0,
    fixedStepSeconds,
    currentTick: 2,
    previousState: createPhysicsStateSnapshot({
      tick: 1, fixedStepSeconds, state: {}, stateUnits: {},
    }),
    currentState: createPhysicsStateSnapshot({
      tick: 2, fixedStepSeconds, state: {}, stateUnits: {},
    }),
    forcing,
  }), /worldUnitsPerMeter/);

  assert.throws(() => createPhysicsContext({
    worldUnitsPerMeter: 1,
    fixedStepSeconds,
    currentTick: 2,
    previousState: createPhysicsStateSnapshot({
      tick: 0, fixedStepSeconds, state: {}, stateUnits: {},
    }),
    currentState: createPhysicsStateSnapshot({
      tick: 2, fixedStepSeconds, state: {}, stateUnits: {},
    }),
    forcing,
  }), /exactly bracket currentTick/);

  assert.throws(() => createPhysicsStateSnapshot({
    tick: 1,
    fixedStepSeconds,
    state: { screenPixels: 1200 },
    stateUnits: { screenPixels: 'pixel' },
  }), /supported SI unit/);
});

test('PhysicsGraph closes producer, consumer, work, and contractual cost ownership', () => {
  const { graphInput } = physicsFixture();
  const graph = createPhysicsGraph(graphInput);
  assert.equal(assertPhysicsGraph(graph), true);
  assert(Object.isFrozen(graph));
  assert(Object.isFrozen(graph.coordination));
  assert(graph.costs.every((cost) => cost.accounting === 'unmeasured-contract'));
  assert.equal(graph.contractScope, 'physics-integration-ownership-shell-v1');

  graphInput.producers.forcing = 'mutated-owner';
  assert.equal(graph.producers.forcing, 'environment');

  const directPresentation = createPhysicsGraph({
    context: graph.context,
    producers: { sceneState: 'source' },
    consumers: { sceneState: ['present-scene'] },
    coordination: [],
    commits: [],
    presentation: [
      {
        id: 'publish-scene',
        owner: 'source',
        reads: [],
        writes: ['sceneState'],
        costId: 'cost-publish-scene',
      },
      {
        id: 'present-scene',
        owner: 'presentation',
        reads: ['sceneState'],
        writes: [],
        costId: 'cost-present-scene',
      },
    ],
    costs: [
      {
        id: 'cost-publish-scene',
        owner: 'source',
        scope: 'presentation',
        accounting: 'unmeasured-contract',
        includes: ['publish-scene'],
      },
      {
        id: 'cost-present-scene',
        owner: 'presentation',
        scope: 'presentation',
        accounting: 'unmeasured-contract',
        includes: ['present-scene'],
      },
    ],
  });
  assert.equal(directPresentation.coordination.length, 0);
  assert.equal(directPresentation.commits.length, 0);
});

test('PhysicsGraph rejects duplicate producers, private replacements, and missing cost closure', () => {
  const duplicate = physicsFixture().graphInput;
  duplicate.coordination[1].owner = 'rain';
  duplicate.costs[1].owner = 'rain';
  assert.throws(() => createPhysicsGraph(duplicate), /duplicate or undeclared producer rain/);

  const privateReplacement = physicsFixture().graphInput;
  privateReplacement.coordination[1].privateInputs = ['local-wind'];
  assert.throws(() => createPhysicsGraph(privateReplacement), /private shared-signal substitution/);

  const missingCost = physicsFixture().graphInput;
  missingCost.coordination[1].costId = 'not-declared';
  assert.throws(() => createPhysicsGraph(missingCost), /unknown cost not-declared/);

  const undeclaredConsumer = physicsFixture().graphInput;
  undeclaredConsumer.consumers.forcing = ['private-rain'];
  assert.throws(() => createPhysicsGraph(undeclaredConsumer), /reads undeclared signal forcing/);

  const ownerWildcard = physicsFixture().graphInput;
  ownerWildcard.consumers.forcing = ['water'];
  assert.throws(() => createPhysicsGraph(ownerWildcard), /reads undeclared signal forcing/);

  const reversedCausality = physicsFixture().graphInput;
  reversedCausality.coordination.reverse();
  assert.throws(() => createPhysicsGraph(reversedCausality), /consumed before its producer work/);

  const valid = createPhysicsGraph(physicsFixture().graphInput);
  const hiddenMutable = { owner: 'hidden-owner' };
  const hiddenGraph = structuredClone(valid);
  Object.defineProperty(hiddenGraph.producers, 'hiddenSignal', {
    value: hiddenMutable,
    enumerable: false,
  });
  const freezeVisible = (value) => {
    if (value && typeof value === 'object') Object.values(value).forEach(freezeVisible);
    if (value && typeof value === 'object') Object.freeze(value);
    return value;
  };
  freezeVisible(hiddenGraph);
  assert(Object.isFrozen(hiddenGraph));
  assert.equal(Object.isFrozen(hiddenMutable), false);
  assert.throws(() => assertPhysicsGraph(hiddenGraph), /must be enumerable/);
});
