function assertSafeRouteId(id, kind, labId) {
  if (typeof id !== 'string' || id.length === 0) throw new Error(`${labId}: ${kind} route id is missing`);
  if (id.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${labId}: unsafe ${kind} route id ${id}`);
  }
}

const STARTUP_SETTERS = Object.freeze({
  scenario: 'setScenario',
  mode: 'setMode',
  tier: 'setTier',
  seed: 'setSeed',
  camera: 'setCamera',
  time: 'setTime',
});

const ROUTE_ACKNOWLEDGEMENT_KEYS = Object.freeze({
  scenario: Object.freeze(['scenario', 'scenarioId', 'activeScenario']),
  mechanism: Object.freeze(['mechanism', 'mechanismId', 'activeMechanism', 'scenario', 'scenarioId', 'mode']),
  tier: Object.freeze(['tier', 'tierId', 'activeTier', 'quality', 'qualityTier']),
});
const STARTUP_ACKNOWLEDGEMENT_KEYS = Object.freeze({
  scenario: ROUTE_ACKNOWLEDGEMENT_KEYS.scenario,
  mode: Object.freeze(['mode', 'modeId', 'activeMode']),
  tier: ROUTE_ACKNOWLEDGEMENT_KEYS.tier,
  seed: Object.freeze(['seed', 'currentSeed']),
  camera: Object.freeze(['camera', 'cameraId', 'activeCamera']),
  time: Object.freeze(['time', 'timeSeconds', 'currentTime']),
});

function routeValue(value) {
  if (value && typeof value === 'object') return value.id ?? value.name ?? null;
  return value;
}

function metricCandidates(metrics, keys, nestedKey) {
  const nested = metrics.routeSelection;
  return [
    ...keys.map((key) => metrics[key]),
    nested?.[nestedKey],
    nested?.kind === nestedKey ? nested.id : null,
  ].map(routeValue);
}

export function lockedRouteSelectionMatches(metrics, kind, id, startup = {}) {
  if (!metrics || typeof metrics !== 'object') return false;
  const direct = metricCandidates(metrics, ROUTE_ACKNOWLEDGEMENT_KEYS[kind] ?? [], kind).includes(id);
  const startupEntries = Object.entries(startup);
  const startupMatches = startupEntries.every(([key, expected]) => (
    metricCandidates(metrics, STARTUP_ACKNOWLEDGEMENT_KEYS[key] ?? [], key).includes(expected)
  ));
  if (!startupMatches) return false;
  return direct || startupEntries.length > 0;
}

export function lockedRouteContract({ kind, id, startup = {}, labId = 'lab' }) {
  assertSafeRouteId(id, kind, labId);
  if (!['scenario', 'mechanism', 'tier'].includes(kind)) throw new Error(`${labId}: unsupported route kind ${kind}`);
  const unknown = Object.keys(startup).filter((key) => !(key in STARTUP_SETTERS));
  if (unknown.length > 0) throw new Error(`${labId}: unsupported locked startup keys: ${unknown.join(', ')}`);
  return {
    query: `?${encodeURIComponent(kind)}=${encodeURIComponent(id)}`,
    startup: structuredClone(startup),
    acknowledgementKeys: [...ROUTE_ACKNOWLEDGEMENT_KEYS[kind]],
    startupAcknowledgementKeys: Object.fromEntries(
      Object.entries(STARTUP_ACKNOWLEDGEMENT_KEYS).map(([key, values]) => [key, [...values]]),
    ),
    setterCalls: Object.keys(STARTUP_SETTERS)
      .filter((key) => startup[key] !== undefined)
      .map((key) => ({ setter: STARTUP_SETTERS[key], value: startup[key] })),
  };
}

export function plannedPublishedRoutes(lab) {
  if (!lab.publishPath || lab.publishPath !== `/demos/${lab.id}/`) {
    throw new Error(`${lab.id}: publishPath must be /demos/${lab.id}/`);
  }
  const routes = [];
  for (const [kind, records] of [
    ['scenario', lab.scenarios ?? []],
    ['mechanism', lab.mechanisms ?? []],
    ['tier', lab.tiers ?? []],
  ]) {
    for (const record of records) {
      const id = typeof record === 'string' ? record : record.id;
      assertSafeRouteId(id, kind, lab.id);
      const startup = typeof record === 'object' && record.startup ? structuredClone(record.startup) : {};
      lockedRouteContract({ kind, id, startup, labId: lab.id });
      routes.push({ kind, id, path: `${lab.publishPath}${kind}/${id}/`, startup });
    }
  }
  return routes;
}
