import { initializeCanonicalWebGPU } from './canonical-webgpu.mjs';
import { isNumericDatum } from './numeric-evidence.mjs';
import {
  assertIdentifier,
  assertIdentifierArray,
  assertKnownKeys,
  assertPlainRecord,
  assertSafeInteger,
  immutablePlainCopy,
} from './runtime-contract-values.mjs';

const REQUIRED_SIGNAL_IDS = Object.freeze([
  'sceneLinearHDR',
  'depth',
  'normal',
  'emissive',
]);

const OPTIONAL_SIGNAL_IDS = Object.freeze(['velocity', 'history']);
const PASS_KINDS = new Set(['prepass', 'lit-scene', 'shadow', 'post', 'diagnostic', 'present']);
const FORBIDDEN_FALLBACK_KEYS = new Set([
  'allowFallback',
  'fallback',
  'fallbackRenderer',
  'compatibilityRenderer',
]);

function assertSingleOwner(value, label) {
  assertIdentifier(value, label);
  return value;
}

function assertWorkgroups(value, label) {
  assertPlainRecord(value, label);
  if (!Array.isArray(value.values) || value.values.length !== 3) {
    throw new TypeError(`${label}.values must contain exactly three workgroup counts`);
  }
  for (const [index, count] of value.values.entries()) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`${label}.values[${index}] must be a non-negative safe integer`);
    }
  }
  if (value.unit !== 'workgroups' || value.label !== 'Derived') {
    throw new TypeError(`${label} must use Derived workgroups`);
  }
  if (typeof value.source !== 'string' || value.source.trim().length === 0) {
    throw new TypeError(`${label}.source is required`);
  }
}

function assertGraphWorkRecord(record, label, { dispatch = false } = {}) {
  assertPlainRecord(record, label);
  assertIdentifier(record.id, `${label}.id`);
  assertSingleOwner(record.owner, `${label}.owner`);
  assertSafeInteger(record.sequence, `${label}.sequence`, { minimum: 0 });
  if (dispatch) {
    assertWorkgroups(record.workgroups, `${label}.workgroups`);
  } else if (!PASS_KINDS.has(record.kind)) {
    throw new TypeError(`${label}.kind is not a supported runtime pass kind`);
  }

  assertIdentifierArray(record.reads ?? [], `${label}.reads`, { allowEmpty: true });
  assertIdentifierArray(record.writes ?? [], `${label}.writes`, { allowEmpty: true });
  if (dispatch && record.writes.length > 0
    && record.workgroups.values.reduce((product, count) => product * count, 1) === 0) {
    throw new Error(`${label} cannot produce shared signals with a zero-work dispatch`);
  }
  if (record.privateSignalSubstitutions !== undefined) {
    if (!Array.isArray(record.privateSignalSubstitutions)
      || record.privateSignalSubstitutions.length !== 0) {
      throw new Error(`${label} declares a forbidden private shared-signal substitution`);
    }
  }
}

function assertAoSubmissionTruth(sceneSubmissions, signalById, expectedMode) {
  const aoPasses = sceneSubmissions.filter((pass) => pass.aoRole !== undefined);
  const ambientVisibilitySignals = [...signalById.values()].filter((signal) => (
    ['ao', 'aoVisibility', 'ambientVisibility'].includes(signal.id)
    || signal.encoding === 'ambient-visibility'
  ));
  const materialContextAoEnabled = expectedMode === 'material-context-screen-space'
    || ambientVisibilitySignals.length > 0
    || aoPasses.length > 0;
  if (!materialContextAoEnabled) return;
  if (expectedMode === 'not-used' && (ambientVisibilitySignals.length > 0 || aoPasses.length > 0)) {
    throw new Error('image pipeline host declares AO unused but the runtime graph contains AO work');
  }
  if (ambientVisibilitySignals.length !== 1) {
    throw new Error('material-context AO requires exactly one ambientVisibility signal');
  }

  const sceneTraversalPasses = sceneSubmissions.filter((pass) => (
    pass.kind === 'prepass' || pass.kind === 'lit-scene'
  ));

  for (const pass of aoPasses) {
    if (pass.aoRole !== 'gbuffer-prepass' && pass.aoRole !== 'lit-pass') {
      throw new Error(`scene submission ${pass.id} has an unknown material-context AO role`);
    }
  }

  const prepasses = aoPasses.filter((pass) => (
    pass.kind === 'prepass' && pass.aoRole === 'gbuffer-prepass'
  ));
  const litPasses = aoPasses.filter((pass) => (
    pass.kind === 'lit-scene' && pass.aoRole === 'lit-pass'
  ));
  const fullLitOutputs = aoPasses.filter((pass) => pass.fullLitOutput === true);
  const declarationOwners = aoPasses.filter((pass) => pass.aoArchitecture !== undefined);

  if (prepasses.length !== 1
    || litPasses.length !== 1
    || aoPasses.length !== 2
    || sceneTraversalPasses.length !== 2
    || fullLitOutputs.length !== 1) {
    throw new Error(
      'material-context screen-space AO requires one g-buffer prepass, one lit pass, '
      + 'two scene submissions, and one full lit output',
    );
  }
  if (fullLitOutputs[0] !== litPasses[0]) {
    throw new Error('only the material-context AO lit pass may produce the full lit output');
  }
  if (!litPasses[0].reads.includes(ambientVisibilitySignals[0].id)) {
    throw new Error('the material-context AO lit pass must consume the shared ambientVisibility signal');
  }
  if (declarationOwners.length !== 1) {
    throw new Error('material-context AO requires exactly one architecture count declaration');
  }

  const counts = declarationOwners[0].aoArchitecture;
  assertKnownKeys(counts, [
    'gbufferPrepassCount',
    'litScenePassCount',
    'sceneSubmissionCount',
    'fullLitOutputCount',
  ], 'material-context AO architecture');
  const expected = {
    gbufferPrepassCount: prepasses.length,
    litScenePassCount: litPasses.length,
    sceneSubmissionCount: sceneTraversalPasses.length,
    fullLitOutputCount: fullLitOutputs.length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) {
      throw new Error(`material-context AO ${key} must truthfully equal ${value}`);
    }
  }
}

function assertSignalReachability(graph, signalById, workRecords) {
  for (const signal of signalById.values()) {
    const writers = workRecords.filter((work) => (
      work.writes.includes(signal.id)
      && work.id === signal.producer
    ));
    const allWriters = workRecords.filter((work) => work.writes.includes(signal.id));
    if (writers.length !== 1 || allWriters.length !== 1) {
      throw new Error(`runtime signal ${signal.id} must have exactly one reachable declared producer work`);
    }

    for (const consumer of signal.consumers) {
      const readers = workRecords.filter((work) => (
        work.reads.includes(signal.id)
        && work.id === consumer
      ));
      if (readers.length === 0) {
        throw new Error(`runtime signal ${signal.id} consumer ${consumer} is not reachable`);
      }
    }
  }

  for (const work of workRecords) {
    for (const signalId of [...work.reads, ...work.writes]) {
      if (!signalById.has(signalId)) {
        throw new Error(`runtime work ${work.id} references undeclared signal ${signalId}`);
      }
    }
    for (const signalId of work.reads) {
      const signal = signalById.get(signalId);
      if (!signal.consumers.includes(work.id)) {
        throw new Error(
          `runtime work ${work.id} reads shared signal ${signalId} without being a declared consumer`,
        );
      }
    }
  }
}

export function assertImagePipelineGraph(graph, expected = {}) {
  immutablePlainCopy(graph, 'image pipeline runtime graph validation copy');
  assertKnownKeys(graph, [
    'schemaVersion',
    'owners',
    'signals',
    'sceneSubmissions',
    'computeDispatches',
    'resources',
    'finalToneMapOwner',
    'finalOutputTransformOwner',
  ], 'image pipeline runtime graph');
  if (graph.schemaVersion !== 2) throw new Error('image pipeline runtime graph schemaVersion must be 2');

  assertPlainRecord(graph.owners, 'image pipeline runtime graph owners');
  for (const key of ['renderer', 'renderPipeline', 'toneMap', 'outputTransform']) {
    assertSingleOwner(graph.owners[key], `image pipeline owner ${key}`);
  }
  assertSingleOwner(graph.finalToneMapOwner, 'finalToneMapOwner');
  assertSingleOwner(graph.finalOutputTransformOwner, 'finalOutputTransformOwner');
  if (graph.owners.toneMap !== graph.finalToneMapOwner) {
    throw new Error('tone-map ownership must resolve to exactly one final owner');
  }
  if (graph.owners.outputTransform !== graph.finalOutputTransformOwner) {
    throw new Error('output-transform ownership must resolve to exactly one final owner');
  }

  for (const [key, value] of Object.entries(expected.owners ?? {})) {
    if (graph.owners[key] !== value) {
      throw new Error(`image pipeline owner ${key} must be ${value}`);
    }
  }
  if (expected.finalToneMapOwner !== undefined
    && graph.finalToneMapOwner !== expected.finalToneMapOwner) {
    throw new Error('runtime graph final tone-map owner does not match the host contract');
  }
  if (expected.finalOutputTransformOwner !== undefined
    && graph.finalOutputTransformOwner !== expected.finalOutputTransformOwner) {
    throw new Error('runtime graph final output-transform owner does not match the host contract');
  }

  if (!Array.isArray(graph.signals)) throw new TypeError('runtime graph signals must be an array');
  const signalById = new Map();
  for (const [index, signal] of graph.signals.entries()) {
    const label = `runtime graph signal[${index}]`;
    assertKnownKeys(signal, ['id', 'producer', 'consumers', 'reachable', 'encoding'], label);
    assertIdentifier(signal.id, `${label}.id`);
    assertSingleOwner(signal.producer, `${label}.producer`);
    assertIdentifierArray(signal.consumers, `${label}.consumers`);
    if (signal.encoding !== undefined
      && (typeof signal.encoding !== 'string' || signal.encoding.trim().length === 0)) {
      throw new TypeError(`runtime signal ${signal.id} encoding must be a non-empty string`);
    }
    if (signal.reachable !== true) throw new Error(`runtime signal ${signal.id} is not reachable`);
    if (signalById.has(signal.id)) {
      throw new Error(`runtime signal ${signal.id} has duplicate producer declarations`);
    }
    signalById.set(signal.id, signal);
  }

  for (const id of expected.signalIds ?? REQUIRED_SIGNAL_IDS) {
    if (!signalById.has(id)) throw new Error(`image pipeline host is missing shared signal ${id}`);
  }
  if (expected.signalIds !== undefined) {
    for (const id of OPTIONAL_SIGNAL_IDS) {
      if (signalById.has(id) !== expected.signalIds.includes(id)) {
        throw new Error(`image pipeline host and runtime graph disagree about optional signal ${id}`);
      }
    }
  }

  if (!Array.isArray(graph.sceneSubmissions) || graph.sceneSubmissions.length === 0) {
    throw new TypeError('runtime graph requires at least one scene submission');
  }
  for (const [index, pass] of graph.sceneSubmissions.entries()) {
    assertGraphWorkRecord(pass, `scene submission[${index}]`);
  }
  if (!Array.isArray(graph.computeDispatches)) {
    throw new TypeError('runtime graph computeDispatches must be an array');
  }
  for (const [index, dispatch] of graph.computeDispatches.entries()) {
    assertGraphWorkRecord(dispatch, `compute dispatch[${index}]`, { dispatch: true });
  }
  assertAoSubmissionTruth(graph.sceneSubmissions, signalById, expected.aoMode);

  const workRecords = [...graph.sceneSubmissions, ...graph.computeDispatches];
  const workIds = new Set();
  const workSequences = new Set();
  for (const work of workRecords) {
    if (workIds.has(work.id)) throw new Error(`runtime work id ${work.id} is duplicated`);
    if (workSequences.has(work.sequence)) {
      throw new Error(`runtime work sequence ${work.sequence} is duplicated`);
    }
    workIds.add(work.id);
    workSequences.add(work.sequence);
  }
  assertSignalReachability(graph, signalById, workRecords);
  const workById = new Map(workRecords.map((work) => [work.id, work]));
  for (const signal of signalById.values()) {
    const producer = workById.get(signal.producer);
    for (const consumerId of signal.consumers) {
      if (producer.sequence >= workById.get(consumerId).sequence) {
        throw new Error(`runtime signal ${signal.id} is consumed before its producer completes`);
      }
    }
  }

  const presentPasses = graph.sceneSubmissions.filter((pass) => pass.kind === 'present');
  if (presentPasses.length !== 1) {
    throw new Error('image pipeline runtime graph requires exactly one presentation pass');
  }
  const presentPass = presentPasses[0];
  if (presentPass.owner !== graph.finalOutputTransformOwner) {
    throw new Error('the sole presentation pass must be owned by finalOutputTransformOwner');
  }
  if (presentPass.toneMapOwner !== graph.finalToneMapOwner
    || presentPass.outputTransformOwner !== graph.finalOutputTransformOwner) {
    throw new Error('the presentation pass must bind the sole tone-map and output-transform owners');
  }
  if (!presentPass.reads.includes('sceneLinearHDR')) {
    throw new Error('the sole presentation pass must consume sceneLinearHDR');
  }
  if (presentPass.outputTransformMode !== 'render-output-node'
    && presentPass.outputTransformMode !== 'pipeline-automatic') {
    throw new Error('the presentation pass must declare its output-transform mode');
  }
  if (expected.outputColorTransform !== undefined) {
    const expectedFlag = presentPass.outputTransformMode === 'pipeline-automatic';
    if (expected.outputColorTransform !== expectedFlag) {
      throw new Error('RenderPipeline outputColorTransform conflicts with the declared presentation mode');
    }
  }

  if (!Array.isArray(graph.resources) || graph.resources.length === 0) {
    throw new TypeError('runtime graph resources must be a non-empty array');
  }
  const resourceIds = new Set();
  for (const [index, resource] of graph.resources.entries()) {
    const label = `runtime resource[${index}]`;
    assertPlainRecord(resource, label);
    assertIdentifier(resource.id, `${label}.id`);
    assertSingleOwner(resource.owner, `${label}.owner`);
    if (typeof resource.kind !== 'string' || resource.kind.length === 0) {
      throw new TypeError(`${label}.kind is required`);
    }
    if (!isNumericDatum(resource.residentBytes)
      || resource.residentBytes.unit !== 'bytes'
      || !['Derived', 'Measured'].includes(resource.residentBytes.label)
      || resource.residentBytes.value < 0
      || resource.residentBytes.source.trim().length === 0) {
      throw new TypeError(`${label}.residentBytes must be a non-negative Derived or Measured byte datum`);
    }
    assertIdentifierArray(resource.consumers, `${label}.consumers`);
    for (const consumer of resource.consumers) {
      if (!workRecords.some((work) => work.id === consumer)) {
        throw new Error(`${label} references undeclared consumer ${consumer}`);
      }
    }
    if (resourceIds.has(resource.id)) throw new Error(`runtime resource ${resource.id} is duplicated`);
    resourceIds.add(resource.id);
  }

  return true;
}

function assertHostSignals(signals) {
  assertKnownKeys(signals, [...REQUIRED_SIGNAL_IDS, ...OPTIONAL_SIGNAL_IDS], 'image pipeline signals');
  const signalIds = [];
  for (const id of REQUIRED_SIGNAL_IDS) {
    if (signals[id] === null || (typeof signals[id] !== 'object' && typeof signals[id] !== 'function')) {
      throw new TypeError(`image pipeline signal ${id} must be a live node or resource reference`);
    }
    signalIds.push(id);
  }
  for (const id of OPTIONAL_SIGNAL_IDS) {
    if (signals[id] !== undefined) {
      if (signals[id] === null || (typeof signals[id] !== 'object' && typeof signals[id] !== 'function')) {
        throw new TypeError(`image pipeline signal ${id} must be a live node or resource reference`);
      }
      signalIds.push(id);
    }
  }
  return signalIds;
}

export async function createImagePipelineHost(options) {
  assertPlainRecord(options, 'image pipeline host options');
  for (const key of Object.keys(options)) {
    if (FORBIDDEN_FALLBACK_KEYS.has(key)) {
      throw new Error(`image pipeline host forbids hidden fallback option ${key}`);
    }
  }
  assertKnownKeys(options, [
    'renderer',
    'renderPipeline',
    'signals',
    'rendererOwner',
    'renderPipelineOwner',
    'finalToneMapOwner',
    'finalOutputTransformOwner',
    'setDiagnosticMode',
    'resetHistory',
    'describePipeline',
    'diagnosticModes',
    'initialDiagnosticMode',
    'aoMode',
    'threeRevision',
  ], 'image pipeline host options');

  const {
    renderer,
    renderPipeline,
    signals,
    rendererOwner,
    renderPipelineOwner,
    finalToneMapOwner,
    finalOutputTransformOwner,
    setDiagnosticMode,
    resetHistory,
    describePipeline,
    diagnosticModes,
    initialDiagnosticMode,
    aoMode,
    threeRevision = '185',
  } = options;

  assertSingleOwner(rendererOwner, 'rendererOwner');
  assertSingleOwner(renderPipelineOwner, 'renderPipelineOwner');
  assertSingleOwner(finalToneMapOwner, 'finalToneMapOwner');
  assertSingleOwner(finalOutputTransformOwner, 'finalOutputTransformOwner');
  const signalIds = assertHostSignals(signals);
  assertIdentifierArray(diagnosticModes, 'diagnosticModes');
  assertIdentifier(initialDiagnosticMode, 'initialDiagnosticMode');
  if (!diagnosticModes.includes(initialDiagnosticMode)) {
    throw new Error('initialDiagnosticMode must be one of diagnosticModes');
  }
  if (aoMode !== 'not-used' && aoMode !== 'material-context-screen-space') {
    throw new Error('aoMode must explicitly be not-used or material-context-screen-space');
  }
  for (const [name, fn] of Object.entries({ setDiagnosticMode, resetHistory, describePipeline })) {
    if (typeof fn !== 'function') throw new TypeError(`image pipeline host ${name}() is required`);
  }

  const backend = await initializeCanonicalWebGPU(renderer, threeRevision);
  if (backend.compatibilityMode === true) {
    throw new Error('canonical image pipeline requires native WebGPU; compatibility fallback is blocked');
  }
  if (!renderPipeline || typeof renderPipeline !== 'object' || renderPipeline.renderer !== renderer) {
    throw new TypeError('renderPipeline must be the sole pipeline bound to the canonical renderer');
  }
  if (typeof renderPipeline.outputColorTransform !== 'boolean') {
    throw new TypeError('renderPipeline.outputColorTransform must be explicit');
  }

  const expected = Object.freeze({
    owners: Object.freeze({
      renderer: rendererOwner,
      renderPipeline: renderPipelineOwner,
    }),
    finalToneMapOwner,
    finalOutputTransformOwner,
    outputColorTransform: renderPipeline.outputColorTransform,
    signalIds: Object.freeze([...signalIds]),
    aoMode,
  });

  let activeDiagnosticMode = initialDiagnosticMode;

  function inspectGraph() {
    const graph = immutablePlainCopy(describePipeline(), 'image pipeline runtime graph');
    assertImagePipelineGraph(graph, {
      ...expected,
      outputColorTransform: renderPipeline.outputColorTransform,
    });
    if (renderPipeline.renderer !== renderer || renderer.backend?.isWebGPUBackend !== true) {
      throw new Error('image pipeline renderer/pipeline native-WebGPU identity changed after creation');
    }
    return graph;
  }

  inspectGraph();

  const host = {
    renderer,
    renderPipeline,
    signals: Object.freeze({ ...signals }),
    finalToneMapOwner,
    finalOutputTransformOwner,
    backendPolicy: Object.freeze({
      required: 'native-webgpu',
      unsupported: 'block',
      fallback: 'forbidden',
    }),
    backend,
    async setDiagnosticMode(id) {
      assertIdentifier(id, 'diagnostic mode');
      if (!diagnosticModes.includes(id)) throw new Error(`unknown diagnostic mode: ${id}`);
      if (id === activeDiagnosticMode) return;

      const beforeGraph = JSON.stringify(inspectGraph());
      const previousNeedsUpdate = renderPipeline.needsUpdate;
      renderPipeline.needsUpdate = false;
      try {
        await setDiagnosticMode(id);
      } catch (error) {
        renderPipeline.needsUpdate = previousNeedsUpdate;
        throw error;
      }
      if (renderPipeline.needsUpdate !== true) {
        throw new Error('diagnostic graph changes must set renderPipeline.needsUpdate = true');
      }
      const afterGraph = JSON.stringify(inspectGraph());
      if (afterGraph === beforeGraph) {
        throw new Error('diagnostic mode change must change the reachable runtime graph');
      }
      activeDiagnosticMode = id;
    },
    async resetHistory(cause) {
      if (typeof cause !== 'string' || cause.trim().length === 0) {
        throw new TypeError('history reset cause is required');
      }
      await resetHistory(cause);
      inspectGraph();
    },
    describePipeline: inspectGraph,
  };

  return Object.freeze(host);
}
