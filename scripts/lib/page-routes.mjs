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
const ROUTE_STARTUP_KEYS = Object.freeze({
  scenario: 'scenario',
  tier: 'tier',
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

export const LAB_CONTROLLER_GLOBALS = Object.freeze([
  'labController',
  '__LAB_CONTROLLER__',
  '__labController',
  '__imagePipelineValidation',
  '__THREEJS_LAB__',
  '__THREE_LAB__',
]);

export async function awaitLockedRouteController(resolveCandidate, {
  resolveBlocker = () => null,
  controllerGlobals = [
    'labController',
    '__LAB_CONTROLLER__',
    '__labController',
    '__imagePipelineValidation',
    '__THREEJS_LAB__',
    '__THREE_LAB__',
  ],
  timeoutMs = 60_000,
  pollIntervalMs = 50,
  now = () => performance.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  settleCandidate = (candidate, remainingMs) => new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Canonical LabController promise did not settle within ${remainingMs} ms.`)),
      remainingMs,
    );
    Promise.resolve(candidate).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  }),
} = {}) {
  if (typeof resolveCandidate !== 'function') throw new TypeError('resolveCandidate must be a function');
  if (typeof resolveBlocker !== 'function') throw new TypeError('resolveBlocker must be a function');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be finite and positive');
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) throw new RangeError('pollIntervalMs must be finite and positive');
  if (!Array.isArray(controllerGlobals) || controllerGlobals.length === 0) {
    throw new TypeError('controllerGlobals must be a non-empty array');
  }

  const deadline = now() + timeoutMs;
  while (true) {
    const blocker = resolveBlocker();
    if (blocker) throw new Error(`Canonical lab reported an initialization blocker: ${String(blocker)}`);

    const candidate = resolveCandidate();
    if (candidate !== undefined && candidate !== null) {
      const remainingMs = Math.max(0, deadline - now());
      const controller = typeof candidate?.then === 'function'
        ? await settleCandidate(candidate, remainingMs)
        : candidate;
      if (controller) return controller;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }

  throw new Error(
    `Canonical lab did not expose any LabController alias (${controllerGlobals.join(', ')}) within ${timeoutMs} ms.`,
  );
}

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
  const lockedStartup = structuredClone(startup);
  const routeStartupKey = ROUTE_STARTUP_KEYS[kind];
  if (routeStartupKey && lockedStartup[routeStartupKey] === undefined) lockedStartup[routeStartupKey] = id;
  return {
    query: `?${encodeURIComponent(kind)}=${encodeURIComponent(id)}`,
    startup: lockedStartup,
    acknowledgementKeys: [...ROUTE_ACKNOWLEDGEMENT_KEYS[kind]],
    startupAcknowledgementKeys: Object.fromEntries(
      Object.entries(STARTUP_ACKNOWLEDGEMENT_KEYS).map(([key, values]) => [key, [...values]]),
    ),
    setterCalls: Object.keys(STARTUP_SETTERS)
      .filter((key) => lockedStartup[key] !== undefined)
      .map((key) => ({ setter: STARTUP_SETTERS[key], value: lockedStartup[key] })),
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
