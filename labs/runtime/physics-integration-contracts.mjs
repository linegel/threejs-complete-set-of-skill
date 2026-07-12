import {
  assertFiniteNumber,
  assertIdentifier,
  assertIdentifierArray,
  assertKnownKeys,
  assertPlainRecord,
  assertSafeInteger,
  immutablePlainCopy,
  isDeeplyFrozen,
} from './runtime-contract-values.mjs';

const UINT32_MAX = 0xffff_ffff;
const GRAPH_SCOPES = Object.freeze(['coordination', 'commit', 'presentation']);
const GRAPH_SCOPE_SET = new Set(GRAPH_SCOPES);
const SI_STATE_UNITS = new Set([
  'dimensionless',
  'kelvin',
  'kilogram',
  'kilogram-per-cubic-meter',
  'meter',
  'meter-per-second',
  'meter-per-second-squared',
  'pascal',
  'radian',
  'radian-per-second',
  'second',
]);
const FORBIDDEN_PRIVATE_KEYS = new Set([
  'privateInput',
  'privateInputs',
  'privateReplacement',
  'privateReplacementOf',
  'privateSignalSubstitution',
  'privateSignalSubstitutions',
  'substituteFor',
]);

const FORCING_UNITS = Object.freeze({
  timeSeconds: 'second',
  wind: 'meter-per-second',
  temperatureK: 'kelvin',
  precipitationRate: 'kilogram-per-square-meter-second',
  cloudForcing: 'dimensionless',
  waterForcing: 'dimensionless',
});

export const PHYSICS_INTEGRATION_CONTRACT_SCOPE = Object.freeze({
  id: 'physics-integration-ownership-shell-v1',
  validates: Object.freeze([
    'authored-forcing-units',
    'fixed-step-state-pair',
    'shared-signal-ownership',
    'producer-consumer-causality',
    'contractual-cost-closure',
  ]),
  excludes: Object.freeze([
    'canonical-physics-abi-publication-chain',
    'interaction-and-conservation-ledgers',
    'performance-or-acceptance-evidence',
  ]),
});

function rejectPrivateSignalKeys(value, label) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateSignalKeys(entry, `${label}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PRIVATE_KEYS.has(key)) {
      throw new Error(`${label}.${key} declares a forbidden private shared-signal substitution`);
    }
    rejectPrivateSignalKeys(entry, `${label}.${key}`);
  }
}

function assertSourceText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty source description`);
  }
  return value;
}

function assertVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must contain exactly three components`);
  }
  for (let index = 0; index < 3; index += 1) {
    assertFiniteNumber(value[index], `${label}[${index}]`);
  }
}

function assertPhysicsStateValue(value, label) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new TypeError(`${label} must be a finite scalar or non-empty finite numeric array`);
    }
    for (const [index, component] of value.entries()) {
      assertFiniteNumber(component, `${label}[${index}]`);
    }
    return;
  }
  try {
    assertFiniteNumber(value, label);
  } catch {
    throw new TypeError(`${label} must be a finite scalar or non-empty finite numeric array`);
  }
}

function assertEnvironmentForcingSnapshotValue(snapshot, { requireFrozen = true } = {}) {
  immutablePlainCopy(snapshot, 'EnvironmentForcingSnapshot validation copy');
  assertKnownKeys(snapshot, [
    'schemaVersion',
    'schemaId',
    'contractScope',
    'provenance',
    'unitSystem',
    'units',
    'seed',
    'timeSeconds',
    'wind',
    'temperatureK',
    'precipitationRate',
    'cloudForcing',
    'waterForcing',
  ], 'EnvironmentForcingSnapshot');
  if (snapshot.schemaVersion !== 1 || snapshot.schemaId !== 'environment-forcing-snapshot-v1') {
    throw new Error('EnvironmentForcingSnapshot schema identity is invalid');
  }
  if (snapshot.contractScope !== PHYSICS_INTEGRATION_CONTRACT_SCOPE.id) {
    throw new Error('EnvironmentForcingSnapshot contract scope is invalid');
  }
  if (snapshot.unitSystem !== 'SI') {
    throw new Error('EnvironmentForcingSnapshot must use the SI unit system');
  }

  assertKnownKeys(snapshot.provenance, ['kind', 'claim', 'source'], 'forcing provenance');
  if (snapshot.provenance.kind !== 'authored-project-input'
    || snapshot.provenance.claim !== 'not-meteorological-synthesis') {
    throw new Error('forcing must be authored project input, not claimed meteorological synthesis');
  }
  assertSourceText(snapshot.provenance.source, 'forcing provenance source');

  assertKnownKeys(snapshot.units, Object.keys(FORCING_UNITS), 'forcing units');
  for (const [key, unit] of Object.entries(FORCING_UNITS)) {
    if (snapshot.units[key] !== unit) {
      throw new Error(`forcing unit ${key} must be ${unit}`);
    }
  }

  assertSafeInteger(snapshot.seed, 'forcing seed', { minimum: 0, maximum: UINT32_MAX });
  assertFiniteNumber(snapshot.timeSeconds, 'forcing timeSeconds', { minimum: 0 });
  assertVector3(snapshot.wind, 'forcing wind');
  assertFiniteNumber(snapshot.temperatureK, 'forcing temperatureK', { minimum: Number.MIN_VALUE });
  assertFiniteNumber(snapshot.precipitationRate, 'forcing precipitationRate', { minimum: 0 });
  assertFiniteNumber(snapshot.cloudForcing, 'forcing cloudForcing', { minimum: 0, maximum: 1 });
  assertFiniteNumber(snapshot.waterForcing, 'forcing waterForcing', { minimum: 0, maximum: 1 });
  if (requireFrozen && !isDeeplyFrozen(snapshot)) {
    throw new Error('EnvironmentForcingSnapshot must be deeply immutable');
  }
  return true;
}

export function createEnvironmentForcingSnapshot(input) {
  assertKnownKeys(input, [
    'source',
    'seed',
    'timeSeconds',
    'wind',
    'temperatureK',
    'precipitationRate',
    'cloudForcing',
    'waterForcing',
  ], 'environment forcing input');
  assertSourceText(input.source, 'environment forcing input.source');

  const snapshot = immutablePlainCopy({
    schemaVersion: 1,
    schemaId: 'environment-forcing-snapshot-v1',
    contractScope: PHYSICS_INTEGRATION_CONTRACT_SCOPE.id,
    provenance: {
      kind: 'authored-project-input',
      claim: 'not-meteorological-synthesis',
      source: input.source,
    },
    unitSystem: 'SI',
    units: FORCING_UNITS,
    seed: input.seed,
    timeSeconds: input.timeSeconds,
    wind: input.wind,
    temperatureK: input.temperatureK,
    precipitationRate: input.precipitationRate,
    cloudForcing: input.cloudForcing,
    waterForcing: input.waterForcing,
  }, 'EnvironmentForcingSnapshot');
  assertEnvironmentForcingSnapshotValue(snapshot);
  return snapshot;
}

export function assertEnvironmentForcingSnapshot(snapshot) {
  return assertEnvironmentForcingSnapshotValue(snapshot);
}

function assertPhysicsStateSnapshotValue(snapshot, { requireFrozen = true } = {}) {
  immutablePlainCopy(snapshot, 'physics state snapshot validation copy');
  assertKnownKeys(snapshot, [
    'schemaVersion',
    'schemaId',
    'contractScope',
    'unitSystem',
    'tick',
    'fixedStepSeconds',
    'timeSeconds',
    'state',
    'stateUnits',
  ], 'physics state snapshot');
  if (snapshot.schemaVersion !== 1 || snapshot.schemaId !== 'physics-state-snapshot-v1') {
    throw new Error('physics state snapshot schema identity is invalid');
  }
  if (snapshot.contractScope !== PHYSICS_INTEGRATION_CONTRACT_SCOPE.id) {
    throw new Error('physics state snapshot contract scope is invalid');
  }
  if (snapshot.unitSystem !== 'SI') throw new Error('physics state snapshot must use SI units');
  assertSafeInteger(snapshot.tick, 'physics state tick', { minimum: 0 });
  assertFiniteNumber(snapshot.fixedStepSeconds, 'physics state fixedStepSeconds', {
    minimum: Number.MIN_VALUE,
  });
  assertFiniteNumber(snapshot.timeSeconds, 'physics state timeSeconds', { minimum: 0 });
  if (snapshot.timeSeconds !== snapshot.tick * snapshot.fixedStepSeconds) {
    throw new Error('physics state timeSeconds must equal tick * fixedStepSeconds exactly');
  }
  assertPlainRecord(snapshot.state, 'physics state payload');
  immutablePlainCopy(snapshot.state, 'physics state payload');
  assertPlainRecord(snapshot.stateUnits, 'physics state units');
  const stateKeys = Object.keys(snapshot.state);
  const unitKeys = Object.keys(snapshot.stateUnits);
  if (stateKeys.length !== unitKeys.length
    || stateKeys.some((key) => !Object.hasOwn(snapshot.stateUnits, key))) {
    throw new Error('physics state units must cover the exact state payload key set');
  }
  for (const key of stateKeys) {
    assertPhysicsStateValue(snapshot.state[key], `physics state field ${key}`);
    if (!SI_STATE_UNITS.has(snapshot.stateUnits[key])) {
      throw new Error(`physics state field ${key} requires an explicit supported SI unit`);
    }
  }
  if (requireFrozen && !isDeeplyFrozen(snapshot)) {
    throw new Error('physics state snapshot must be deeply immutable');
  }
  return true;
}

export function createPhysicsStateSnapshot(input) {
  assertKnownKeys(input, ['tick', 'fixedStepSeconds', 'state', 'stateUnits'], 'physics state input');
  const {
    tick, fixedStepSeconds, state, stateUnits,
  } = input;
  const snapshot = immutablePlainCopy({
    schemaVersion: 1,
    schemaId: 'physics-state-snapshot-v1',
    contractScope: PHYSICS_INTEGRATION_CONTRACT_SCOPE.id,
    unitSystem: 'SI',
    tick,
    fixedStepSeconds,
    timeSeconds: tick * fixedStepSeconds,
    state,
    stateUnits,
  }, 'physics state snapshot');
  assertPhysicsStateSnapshotValue(snapshot);
  return snapshot;
}

export function assertPhysicsStateSnapshot(snapshot) {
  return assertPhysicsStateSnapshotValue(snapshot);
}

function assertPhysicsContextValue(context, { requireFrozen = true } = {}) {
  immutablePlainCopy(context, 'PhysicsContext validation copy');
  assertKnownKeys(context, [
    'schemaVersion',
    'schemaId',
    'contractScope',
    'unitConvention',
    'worldUnitsPerMeter',
    'fixedStepSeconds',
    'currentTick',
    'previousState',
    'currentState',
    'forcing',
  ], 'PhysicsContext');
  if (context.schemaVersion !== 1 || context.schemaId !== 'physics-context-runtime-v1') {
    throw new Error('PhysicsContext schema identity is invalid');
  }
  if (context.contractScope !== PHYSICS_INTEGRATION_CONTRACT_SCOPE.id) {
    throw new Error('PhysicsContext contract scope is invalid');
  }
  if (context.unitConvention !== 'world-units-per-meter') {
    throw new Error('PhysicsContext must serialize exactly the worldUnitsPerMeter convention');
  }
  assertFiniteNumber(context.worldUnitsPerMeter, 'PhysicsContext worldUnitsPerMeter', {
    minimum: Number.MIN_VALUE,
  });
  assertFiniteNumber(context.fixedStepSeconds, 'PhysicsContext fixedStepSeconds', {
    minimum: Number.MIN_VALUE,
  });
  assertSafeInteger(context.currentTick, 'PhysicsContext currentTick', { minimum: 1 });

  assertPhysicsStateSnapshotValue(context.previousState, { requireFrozen });
  assertPhysicsStateSnapshotValue(context.currentState, { requireFrozen });
  if (context.previousState.tick !== context.currentTick - 1
    || context.currentState.tick !== context.currentTick) {
    throw new Error('PhysicsContext previous/current state ticks must exactly bracket currentTick');
  }
  if (context.previousState.fixedStepSeconds !== context.fixedStepSeconds
    || context.currentState.fixedStepSeconds !== context.fixedStepSeconds) {
    throw new Error('PhysicsContext state snapshots must use the exact context fixed step');
  }

  assertEnvironmentForcingSnapshotValue(context.forcing, { requireFrozen });
  if (context.forcing.timeSeconds !== context.currentState.timeSeconds) {
    throw new Error('PhysicsContext forcing must be sampled at the exact current state time');
  }
  if (requireFrozen && !isDeeplyFrozen(context)) {
    throw new Error('PhysicsContext must be deeply immutable');
  }
  return true;
}

export function createPhysicsContext(input) {
  assertKnownKeys(input, [
    'worldUnitsPerMeter',
    'fixedStepSeconds',
    'currentTick',
    'previousState',
    'currentState',
    'forcing',
  ], 'PhysicsContext input');

  const context = immutablePlainCopy({
    schemaVersion: 1,
    schemaId: 'physics-context-runtime-v1',
    contractScope: PHYSICS_INTEGRATION_CONTRACT_SCOPE.id,
    unitConvention: 'world-units-per-meter',
    worldUnitsPerMeter: input.worldUnitsPerMeter,
    fixedStepSeconds: input.fixedStepSeconds,
    currentTick: input.currentTick,
    previousState: input.previousState,
    currentState: input.currentState,
    forcing: input.forcing,
  }, 'PhysicsContext');
  assertPhysicsContextValue(context);
  return context;
}

export function assertPhysicsContext(context) {
  return assertPhysicsContextValue(context);
}

function assertProducerConsumerMaps(producers, consumers) {
  assertPlainRecord(producers, 'PhysicsGraph producers');
  assertPlainRecord(consumers, 'PhysicsGraph consumers');
  const signalIds = Object.keys(producers);
  if (signalIds.length === 0) throw new Error('PhysicsGraph requires at least one shared signal producer');

  for (const signalId of signalIds) {
    assertIdentifier(signalId, 'PhysicsGraph signal id');
    assertIdentifier(producers[signalId], `PhysicsGraph producer for ${signalId}`);
  }
  const consumerIds = Object.keys(consumers);
  if (signalIds.length !== consumerIds.length
    || signalIds.some((signalId) => !Object.hasOwn(consumers, signalId))) {
    throw new Error('PhysicsGraph producers and consumers must have the same exact signal keys');
  }
  for (const signalId of signalIds) {
    assertIdentifierArray(consumers[signalId], `PhysicsGraph consumers for ${signalId}`);
  }
  return signalIds;
}

function assertGraphCost(cost, label) {
  assertKnownKeys(cost, ['id', 'owner', 'scope', 'accounting', 'includes'], label);
  assertIdentifier(cost.id, `${label}.id`);
  assertIdentifier(cost.owner, `${label}.owner`);
  if (!GRAPH_SCOPE_SET.has(cost.scope)) throw new TypeError(`${label}.scope is invalid`);
  if (cost.accounting !== 'unmeasured-contract') {
    throw new Error(`${label} may declare contractual work only; measured cost belongs in evidence`);
  }
  assertIdentifierArray(cost.includes, `${label}.includes`);
}

function assertGraphWork(work, label) {
  assertKnownKeys(work, ['id', 'owner', 'reads', 'writes', 'costId'], label);
  assertIdentifier(work.id, `${label}.id`);
  assertIdentifier(work.owner, `${label}.owner`);
  assertIdentifierArray(work.reads, `${label}.reads`, { allowEmpty: true });
  assertIdentifierArray(work.writes, `${label}.writes`, { allowEmpty: true });
  if (work.reads.length === 0 && work.writes.length === 0) {
    throw new Error(`${label} must declare at least one shared-signal read or write`);
  }
  assertIdentifier(work.costId, `${label}.costId`);
}

function assertPhysicsGraphValue(graph, { requireFrozen = true } = {}) {
  immutablePlainCopy(graph, 'PhysicsGraph validation copy');
  assertKnownKeys(graph, [
    'schemaVersion',
    'schemaId',
    'contractScope',
    'context',
    'producers',
    'consumers',
    'coordination',
    'commits',
    'presentation',
    'costs',
  ], 'PhysicsGraph');
  for (const key of ['producers', 'consumers', 'coordination', 'commits', 'presentation']) {
    rejectPrivateSignalKeys(graph[key], `PhysicsGraph.${key}`);
  }
  if (graph.schemaVersion !== 1 || graph.schemaId !== 'physics-graph-runtime-v1') {
    throw new Error('PhysicsGraph schema identity is invalid');
  }
  if (graph.contractScope !== PHYSICS_INTEGRATION_CONTRACT_SCOPE.id) {
    throw new Error('PhysicsGraph contract scope is invalid');
  }
  assertPhysicsContextValue(graph.context, { requireFrozen });
  const signalIds = assertProducerConsumerMaps(graph.producers, graph.consumers);
  const signalSet = new Set(signalIds);

  if (!Array.isArray(graph.costs) || graph.costs.length === 0) {
    throw new TypeError('PhysicsGraph costs must be a non-empty array');
  }
  const costById = new Map();
  graph.costs.forEach((cost, index) => {
    assertGraphCost(cost, `PhysicsGraph cost[${index}]`);
    if (costById.has(cost.id)) throw new Error(`PhysicsGraph cost ${cost.id} is duplicated`);
    costById.set(cost.id, cost);
  });

  const workRecords = [];
  const workIds = new Set();
  for (const scope of GRAPH_SCOPES) {
    const records = graph[scope === 'commit' ? 'commits' : scope];
    if (!Array.isArray(records)) {
      throw new TypeError(`PhysicsGraph ${scope} records must be an array`);
    }
    records.forEach((work, index) => {
      const label = `PhysicsGraph ${scope}[${index}]`;
      assertGraphWork(work, label);
      if (workIds.has(work.id)) throw new Error(`PhysicsGraph work id ${work.id} is duplicated`);
      workIds.add(work.id);
      const cost = costById.get(work.costId);
      if (!cost) throw new Error(`${label} references unknown cost ${work.costId}`);
      if (cost.owner !== work.owner || cost.scope !== scope || !cost.includes.includes(work.id)) {
        throw new Error(`${label} cost ownership, scope, or inclusion does not reconcile`);
      }
      workRecords.push({ ...work, scope });
    });
  }

  if (workRecords.length === 0) {
    throw new Error('PhysicsGraph requires at least one coordination, commit, or presentation work record');
  }

  for (const work of workRecords) {
    for (const signalId of [...work.reads, ...work.writes]) {
      if (!signalSet.has(signalId)) {
        throw new Error(`PhysicsGraph work ${work.id} references undeclared shared signal ${signalId}`);
      }
    }
    for (const signalId of work.writes) {
      if (graph.producers[signalId] !== work.owner) {
        throw new Error(
          `PhysicsGraph signal ${signalId} has duplicate or undeclared producer ${work.owner}`,
        );
      }
    }
    for (const signalId of work.reads) {
      if (!graph.consumers[signalId].includes(work.id)) {
        throw new Error(
          `PhysicsGraph work ${work.id} privately replaces or reads undeclared signal ${signalId}`,
        );
      }
    }
  }

  for (const signalId of signalIds) {
    const writers = workRecords.filter((work) => work.writes.includes(signalId));
    if (writers.length !== 1) {
      throw new Error(`PhysicsGraph signal ${signalId} must have exactly one declared producer work`);
    }
    for (const consumer of graph.consumers[signalId]) {
      const matchingReads = workRecords.filter((work) => (
        work.reads.includes(signalId) && work.id === consumer
      ));
      if (matchingReads.length === 0) {
        throw new Error(`PhysicsGraph signal ${signalId} consumer ${consumer} has no declared read`);
      }
      if (workRecords.indexOf(writers[0]) >= workRecords.indexOf(matchingReads[0])) {
        throw new Error(`PhysicsGraph signal ${signalId} is consumed before its producer work`);
      }
    }
  }

  for (const [costId, cost] of costById.entries()) {
    const actualIncludes = workRecords
      .filter((work) => work.costId === costId)
      .map((work) => work.id)
      .sort();
    const declaredIncludes = [...cost.includes].sort();
    if (actualIncludes.length !== declaredIncludes.length
      || actualIncludes.some((id, index) => id !== declaredIncludes[index])) {
      throw new Error(`PhysicsGraph cost ${costId} does not close over its exact work set`);
    }
  }
  if (requireFrozen && !isDeeplyFrozen(graph)) {
    throw new Error('PhysicsGraph must be deeply immutable');
  }
  return true;
}

export function createPhysicsGraph(input) {
  assertKnownKeys(input, [
    'context',
    'producers',
    'consumers',
    'coordination',
    'commits',
    'presentation',
    'costs',
  ], 'PhysicsGraph input');
  for (const key of ['producers', 'consumers', 'coordination', 'commits', 'presentation']) {
    rejectPrivateSignalKeys(input[key], `PhysicsGraph input.${key}`);
  }

  const graph = immutablePlainCopy({
    schemaVersion: 1,
    schemaId: 'physics-graph-runtime-v1',
    contractScope: PHYSICS_INTEGRATION_CONTRACT_SCOPE.id,
    context: input.context,
    producers: input.producers,
    consumers: input.consumers,
    coordination: input.coordination,
    commits: input.commits,
    presentation: input.presentation,
    costs: input.costs,
  }, 'PhysicsGraph');
  assertPhysicsGraphValue(graph);
  return graph;
}

export function assertPhysicsGraph(graph) {
  return assertPhysicsGraphValue(graph);
}
