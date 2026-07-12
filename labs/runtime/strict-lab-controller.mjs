function ids(records) {
  return new Set((records ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.id)));
}

function requireKnown(allowed, value, kind) {
  if (!allowed.has(value)) {
    throw new RangeError(`unknown ${kind} "${value}"; allowed: ${[...allowed].join(', ') || '(none)'}`);
  }
}

function requireMethod(implementation, name) {
  if (typeof implementation[name] !== 'function') {
    throw new TypeError(`LabController implementation is missing ${name}()`);
  }
}

export function createStrictLabController(manifest, implementation) {
  if (!manifest || manifest.schemaVersion !== 2) throw new TypeError('schema-v2 lab manifest is required');
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) throw new TypeError('lab manifest id is required');
  if (!implementation || typeof implementation !== 'object') throw new TypeError('controller implementation is required');

  const scenarios = ids(manifest.scenarios);
  const modes = ids(manifest.modes);
  const tiers = ids(manifest.tiers);
  const cameras = ids(manifest.cameras);
  const seeds = new Set(manifest.seeds ?? []);
  const delegatedMethods = [
    'ready',
    'setScenario',
    'setMode',
    'setTier',
    'setSeed',
    'setCamera',
    'setTime',
    'step',
    'resetHistory',
    'resize',
    'renderOnce',
    'capturePixels',
    'describePipeline',
    'describeResources',
    'getMetrics',
    'dispose',
  ];
  delegatedMethods.forEach((name) => requireMethod(implementation, name));

  return Object.freeze({
    get labId() { return manifest.id; },
    ready: () => implementation.ready(),
    setScenario: (id) => {
      requireKnown(scenarios, id, 'scenario');
      return implementation.setScenario(id);
    },
    setMode: (id) => {
      requireKnown(modes, id, 'mode');
      return implementation.setMode(id);
    },
    setTier: (id) => {
      requireKnown(tiers, id, 'tier');
      return implementation.setTier(id);
    },
    setSeed: (seed) => {
      requireKnown(seeds, seed, 'seed');
      return implementation.setSeed(seed);
    },
    setCamera: (id) => {
      requireKnown(cameras, id, 'camera');
      return implementation.setCamera(id);
    },
    setTime: (seconds) => implementation.setTime(seconds),
    step: (deltaSeconds) => implementation.step(deltaSeconds),
    resetHistory: (cause) => implementation.resetHistory(cause),
    resize: (width, height, dpr) => implementation.resize(width, height, dpr),
    renderOnce: () => implementation.renderOnce(),
    capturePixels: (target) => implementation.capturePixels(target),
    describePipeline: () => implementation.describePipeline(),
    describeResources: () => implementation.describeResources(),
    getMetrics: () => ({ ...implementation.getMetrics(), labId: manifest.id }),
    dispose: () => implementation.dispose(),
  });
}
