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
  mechanism: Object.freeze(['mechanism', 'mechanismId', 'activeMechanism']),
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

export function lockedRouteSelectionMatchesWithKeys(
  metrics,
  kind,
  id,
  startup = {},
  acknowledgementKeys = [],
  startupAcknowledgementKeys = {},
) {
  if (!metrics || typeof metrics !== 'object') return false;
  const routeValue = (value) => {
    if (value && typeof value === 'object') return value.id ?? value.name ?? null;
    return value;
  };
  const metricCandidates = (keys, nestedKey) => {
    const nested = metrics.routeSelection;
    return [
      ...keys.map((key) => metrics[key]),
      nested?.[nestedKey],
      nested?.kind === nestedKey ? nested.id : null,
    ].map(routeValue);
  };
  const direct = metricCandidates(acknowledgementKeys, kind).includes(id);
  const startupEntries = Object.entries(startup);
  const startupMatches = startupEntries.every(([key, expected]) => (
    metricCandidates(startupAcknowledgementKeys[key] ?? [], key).includes(expected)
  ));
  return direct && startupMatches;
}

export function lockedRouteSelectionMatches(metrics, kind, id, startup = {}) {
  return lockedRouteSelectionMatchesWithKeys(
    metrics,
    kind,
    id,
    startup,
    ROUTE_ACKNOWLEDGEMENT_KEYS[kind] ?? [],
    STARTUP_ACKNOWLEDGEMENT_KEYS,
  );
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

export const DECISION_SUPPORT_PRESENTATION_ROUTES = Object.freeze([
  Object.freeze({ family: 'guides hub', path: '/guides/', kind: 'hub' }),
  Object.freeze({ family: 'audience', path: '/for/graphics-engineers/', kind: 'audience' }),
  Object.freeze({ family: 'direct comparison', path: '/compare/threejs-webgpu-skill-pack-vs-official-threejs-docs/', kind: 'ecosystem-comparison' }),
  Object.freeze({ family: 'technical comparison', path: '/compare/renderpipeline-vs-effectcomposer/', kind: 'technical-comparison' }),
  Object.freeze({ family: 'alternatives', path: '/alternatives/threejs-agent-skills/', kind: 'alternatives' }),
  Object.freeze({ family: 'pricing', path: '/pricing/', kind: 'pricing' }),
  Object.freeze({ family: 'human docs', path: '/docs/use-in-an-existing-project/', kind: 'user-doc' }),
  Object.freeze({ family: 'agent docs', path: '/agents/routing-and-minimal-context/', kind: 'agent-doc' }),
  Object.freeze({ family: 'migration', path: '/migrate/webglrenderer-to-webgpurenderer/', kind: 'migration' }),
  Object.freeze({ family: 'industry', path: '/industries/product-visualization-and-configurators/', kind: 'industry' }),
  Object.freeze({ family: 'FAQ hub', path: '/faq/', kind: 'hub' }),
]);

export const HUMAN_DOCS_NAV = Object.freeze([
  Object.freeze({ path: '/docs/', label: 'Overview' }),
  Object.freeze({ path: '/docs/install/', label: 'Install' }),
  Object.freeze({ path: '/docs/install-codex/', label: 'Codex' }),
  Object.freeze({ path: '/docs/install-claude-code/', label: 'Claude Code' }),
  Object.freeze({ path: '/docs/choose-skills/', label: 'Choose skills' }),
  Object.freeze({ path: '/docs/use-in-an-existing-project/', label: 'Existing project' }),
]);

export const NO_SCRIPT_PRESENTATION_ROUTES = Object.freeze([
  Object.freeze({ family: 'homepage', path: '/', minimumText: 3_000, minimumLinks: 50 }),
  Object.freeze({ family: 'Guides hub', path: '/guides/', kind: 'hub', minimumText: 1_200, minimumLinks: 10 }),
  Object.freeze({
    family: 'FAQ answer',
    path: '/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/',
    kind: 'faq-answer',
    minimumText: 900,
    minimumLinks: 6,
  }),
]);

const STATIC_SITE_HTML_PATHS = [
  '/',
  '/about/',
  ...DECISION_SUPPORT_PRESENTATION_ROUTES.map(({ path }) => path),
  ...NO_SCRIPT_PRESENTATION_ROUTES.map(({ path }) => path),
].filter((path, index, paths) => paths.indexOf(path) === index);

const STATIC_PAGES_SMOKE_ROUTES = Object.freeze([
  ...STATIC_SITE_HTML_PATHS.map((path) => Object.freeze({
    path,
    category: 'site-html',
    responseKind: 'html',
    canonicalPath: path,
  })),
  Object.freeze({ path: '/skills.json', category: 'site-json', responseKind: 'json', jsonKind: 'skills' }),
  Object.freeze({ path: '/llm.txt', category: 'site-text', responseKind: 'text', bodyMarker: '# Three.js' }),
  Object.freeze({ path: '/llms.txt', category: 'site-text', responseKind: 'text', bodyMarker: '# Three.js' }),
  Object.freeze({ path: '/robots.txt', category: 'site-text', responseKind: 'text', bodyMarker: 'User-agent:' }),
  Object.freeze({ path: '/sitemap.xml', category: 'site-xml', responseKind: 'xml', bodyMarker: '<urlset' }),
  Object.freeze({ path: '/demos/registry.json', category: 'site-json', responseKind: 'json', jsonKind: 'registry' }),
]);

function addUniqueSmokeRoute(routes, paths, route) {
  if (paths.has(route.path)) throw new Error(`duplicate Pages smoke route: ${route.path}`);
  paths.add(route.path);
  routes.push(route);
}

export function plannedPagesSmokeRoutes({ registry, skillIds, primaryDemoKinds }) {
  if (!registry || !Array.isArray(registry.demos)) throw new TypeError('registry.demos must be an array');
  if (!Array.isArray(skillIds)) throw new TypeError('skillIds must be an array');
  if (!Array.isArray(primaryDemoKinds)) throw new TypeError('primaryDemoKinds must be an array');
  const primaryKinds = new Set(primaryDemoKinds);
  const routes = [];
  const paths = new Set();

  for (const route of STATIC_PAGES_SMOKE_ROUTES) addUniqueSmokeRoute(routes, paths, { ...route });
  for (const skillId of [...skillIds].sort()) {
    addUniqueSmokeRoute(routes, paths, {
      path: `/skills/${skillId}.html`,
      category: 'skill-page',
      responseKind: 'html',
      canonicalPath: `/skills/${skillId}.html`,
      skillId,
    });
  }
  for (const lab of registry.demos) {
    if (!lab.publishPath) continue;
    if (primaryKinds.has(lab.kind)) {
      addUniqueSmokeRoute(routes, paths, {
        path: lab.publishPath,
        category: 'primary-base',
        responseKind: 'html',
        labId: lab.id,
        nonRenderingScenarioSuite: lab.nonRenderingScenarioSuite === true,
      });
      for (const fixed of plannedPublishedRoutes(lab)) {
        const contract = lockedRouteContract({
          kind: fixed.kind,
          id: fixed.id,
          startup: fixed.startup,
          labId: lab.id,
        });
        addUniqueSmokeRoute(routes, paths, {
          path: fixed.path,
          category: 'primary-fixed',
          responseKind: 'html',
          labId: lab.id,
          routeKind: fixed.kind,
          routeId: fixed.id,
          startup: fixed.startup,
          acknowledgementKeys: contract.acknowledgementKeys,
          startupAcknowledgementKeys: contract.startupAcknowledgementKeys,
          nonRenderingScenarioSuite: lab.nonRenderingScenarioSuite === true,
        });
      }
    } else if (lab.status === 'secondary') {
      addUniqueSmokeRoute(routes, paths, {
        path: lab.publishPath,
        category: 'secondary-base',
        responseKind: 'html',
        labId: lab.id,
      });
    }
  }
  return routes;
}

export function plannedPagesBrowserRoutes(routes) {
  if (!Array.isArray(routes)) throw new TypeError('routes must be an array');
  return routes.filter((route) => route.category === 'primary-base' || route.category === 'primary-fixed');
}

function htmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] ?? null;
}

function htmlTagWithAttributes(body, tagName, attributes) {
  const tags = body.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) ?? [];
  return tags.some((tag) => Object.entries(attributes).every(([name, value]) => htmlAttribute(tag, name) === value));
}

function canonicalPathFromHtml(body) {
  const links = body.match(/<link\b[^>]*>/gi) ?? [];
  const canonical = links.find((link) => htmlAttribute(link, 'rel')?.split(/\s+/).includes('canonical'));
  const href = canonical ? htmlAttribute(canonical, 'href') : null;
  if (!href) return null;
  try {
    return new URL(href, 'https://threejs-skills.com/').pathname;
  } catch {
    return null;
  }
}

export function assertPagesRouteResponse(route, response) {
  if (!route || typeof route.path !== 'string') throw new TypeError('route.path must be a string');
  if (!response || typeof response !== 'object') throw new TypeError('response must be an object');
  if (response.status !== 200) throw new Error(`${route.path} returned ${response.status ?? 'no response'}`);
  const finalPath = (() => {
    try {
      return new URL(response.url).pathname;
    } catch {
      return null;
    }
  })();
  if (finalPath !== route.path) throw new Error(`${route.path} resolved to unexpected path ${finalPath ?? 'unknown'}`);
  const contentType = String(response.contentType ?? '').toLowerCase();
  const body = String(response.body ?? '');
  if (route.responseKind === 'html' && !contentType.includes('text/html')) {
    throw new Error(`${route.path} returned non-HTML content type ${response.contentType ?? 'missing'}`);
  }
  if (route.responseKind === 'json' && !contentType.includes('json')) {
    throw new Error(`${route.path} returned non-JSON content type ${response.contentType ?? 'missing'}`);
  }
  if (route.responseKind === 'text' && !contentType.includes('text/plain')) {
    throw new Error(`${route.path} returned non-text content type ${response.contentType ?? 'missing'}`);
  }
  if (route.responseKind === 'xml' && !contentType.includes('xml')) {
    throw new Error(`${route.path} returned non-XML content type ${response.contentType ?? 'missing'}`);
  }

  if (route.category === 'site-html' || route.category === 'skill-page') {
    if (canonicalPathFromHtml(body) !== route.canonicalPath) {
      throw new Error(`${route.path} does not identify canonical page ${route.canonicalPath}`);
    }
  } else if (route.category === 'primary-base' || route.category === 'secondary-base') {
    if (!htmlTagWithAttributes(body, '(?:aside|main)', { 'data-demo-id': route.labId })) {
      throw new Error(`${route.path} does not identify demo ${route.labId}`);
    }
  } else if (route.category === 'primary-fixed') {
    if (!htmlTagWithAttributes(body, 'meta', { name: 'lab-id', content: route.labId })) {
      throw new Error(`${route.path} does not identify demo ${route.labId}`);
    }
    if (!htmlTagWithAttributes(body, 'meta', { name: `lab-${route.routeKind}`, content: route.routeId })) {
      throw new Error(`${route.path} does not identify locked ${route.routeKind} ${route.routeId}`);
    }
  } else if (route.category === 'site-json') {
    let document;
    try {
      document = JSON.parse(body);
    } catch {
      throw new Error(`${route.path} is not valid JSON`);
    }
    if (route.jsonKind === 'skills' && !Array.isArray(document.skills)) {
      throw new Error(`${route.path} does not identify the skill manifest`);
    }
    if (route.jsonKind === 'registry' && (document.schemaVersion !== 2 || !Array.isArray(document.demos))) {
      throw new Error(`${route.path} does not identify the demo registry`);
    }
  } else if (route.category === 'site-text' || route.category === 'site-xml') {
    if (!body.includes(route.bodyMarker)) throw new Error(`${route.path} is missing ${route.bodyMarker}`);
  }
}

export function pagesNativeWebGPUProven(backendProof) {
  if (!backendProof || typeof backendProof !== 'object') return false;
  const direct = backendProof.direct;
  if (
    direct
    && direct.source === 'controller.renderer'
    && direct.isWebGPUBackend === true
    && direct.initialized === true
    && direct.deviceIdentityObserved === true
    && direct.lossPromiseObservedOnActualDevice === true
  ) return true;

  const structured = backendProof.structured;
  const evidence = structured?.rendererBackendEvidence;
  return evidence?.isWebGPUBackend === true
    && evidence.initialized === true
    && evidence.deviceIdentityVerified === true
    && evidence.lossPromiseObservedOnActualDevice === true
    && structured.rendererDeviceStatus === 'active'
    && structured.deviceLossGeneration === 0
    && structured.deviceLostObserved === false
    && Array.isArray(structured.uncapturedErrors)
    && structured.uncapturedErrors.length === 0
    && Array.isArray(structured.deviceErrors)
    && structured.deviceErrors.length === 0
    && structured.deviceErrorCount === 0
    && structured.lastDeviceError === null;
}

export function assertPagesBrowserObservation(route, observation) {
  if (!route || typeof route.path !== 'string') throw new TypeError('route.path must be a string');
  if (!observation || typeof observation !== 'object') throw new TypeError('observation must be an object');
  let finalPath = null;
  try {
    finalPath = new URL(observation.url).pathname;
  } catch {
    // Report the invalid URL through the same exact-path error below.
  }
  if (finalPath !== route.path) {
    throw new Error(`${route.path} browser resolved to unexpected path ${finalPath ?? 'unknown'}`);
  }
  if (observation.ready !== true) throw new Error(`${route.path} controller did not become ready`);
  if (observation.documentLabId !== route.labId) {
    throw new Error(`${route.path} document did not identify lab ${route.labId}`);
  }
  if (observation.controllerLabId !== route.labId) {
    throw new Error(`${route.path} controller did not identify lab ${route.labId}`);
  }
  for (const [label, key] of [
    ['page', 'pageErrors'],
    ['console', 'consoleErrors'],
    ['request', 'requestErrors'],
    ['device', 'deviceErrors'],
  ]) {
    const values = Array.isArray(observation[key])
      ? observation[key].filter((value) => value !== null && value !== undefined && String(value).length > 0)
      : (observation[key] ? [observation[key]] : []);
    if (values.length > 0) throw new Error(`${route.path} ${label} errors: ${values.map(String).join(' | ')}`);
  }
  if (route.nonRenderingScenarioSuite !== true && !pagesNativeWebGPUProven(observation.backendProof)) {
    throw new Error(`${route.path} did not prove a native WebGPU backend`);
  }
  if (route.category === 'primary-fixed') {
    if (observation.lockedKind !== route.routeKind || observation.lockedId !== route.routeId) {
      throw new Error(`${route.path} browser metadata did not preserve locked ${route.routeKind} ${route.routeId}`);
    }
    if (!lockedRouteSelectionMatchesWithKeys(
      observation.routeMetrics,
      route.routeKind,
      route.routeId,
      route.startup,
      route.acknowledgementKeys,
      route.startupAcknowledgementKeys,
    )) {
      throw new Error(`${route.path} controller did not acknowledge locked ${route.routeKind} ${route.routeId} and every startup value`);
    }
  }
  if (observation.disposed !== true) throw new Error(`${route.path} controller was not disposed`);
}
