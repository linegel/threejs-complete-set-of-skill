import { createCanonicalShadowLab } from "../webgpu-cached-clipmap-shadow/canonical-lab.js";

export const ARCHITECTURE_SCENARIOS = Object.freeze({
  bounded: Object.freeze({ architecture: "bounded", mechanism: "bounded-shadow" }),
  csm: Object.freeze({ architecture: "csm", mechanism: "csm" }),
  tiled: Object.freeze({ architecture: "tiled", mechanism: "tiled-shadow" }),
  cached: Object.freeze({ architecture: "cached", mechanism: "cached-clipmap" }),
});

export const ARCHITECTURE_BENCH_MODES = Object.freeze([
  "final",
  "shadow-depth",
  "owner-graph",
]);

// Builtin capture recipes use these display aliases; canonical core maps them.
export const ARCHITECTURE_BENCH_CAPTURE_ALIASES = Object.freeze([
  "no-post",
  "diagnostics",
]);

const scenarioByMechanism = Object.freeze(Object.fromEntries(
  Object.entries(ARCHITECTURE_SCENARIOS).map(([scenario, value]) => [value.mechanism, scenario]),
));

function selectArchitectureScenario({
  scenario = "bounded",
  mechanism = null,
  tier = "high",
  mode = "final",
} = {}) {
  const mechanismScenario = mechanism === null ? null : scenarioByMechanism[mechanism];
  if (mechanism !== null && !mechanismScenario) {
    throw new RangeError(`unknown shadow architecture mechanism: ${mechanism}`);
  }
  if (mechanismScenario && scenario !== "bounded" && scenario !== mechanismScenario) {
    throw new Error(`scenario ${scenario} conflicts with mechanism ${mechanism}`);
  }
  const selectedScenario = mechanismScenario ?? scenario;
  const config = ARCHITECTURE_SCENARIOS[selectedScenario];
  if (!config) throw new RangeError(`unknown shadow architecture scenario: ${selectedScenario}`);
  if (tier !== "high") throw new RangeError(`unknown shadow architecture tier: ${tier}`);
  if (!ARCHITECTURE_BENCH_MODES.includes(mode)) {
    throw new RangeError(`unknown shadow architecture mode: ${mode}`);
  }
  return Object.freeze({
    scenario: selectedScenario,
    architecture: config.architecture,
    mechanism: config.mechanism,
    tier,
    mode,
  });
}

export function resolveArchitectureBenchRoute(search = "") {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const requestedScenario = params.get("scenario");
  const requestedMechanism = params.get("mechanism");
  const requestedTier = params.get("tier") ?? "high";
  const requestedMode = params.get("mode") ?? "final";
  return selectArchitectureScenario({
    scenario: requestedScenario ?? "bounded",
    mechanism: requestedMechanism,
    tier: requestedTier,
    mode: requestedMode,
  });
}

function createPublicController(core, initialSelection) {
  const state = { ...initialSelection };
  const routeSelection = () => ({ ...state });

  return {
    renderer: core.renderer,
    renderPipeline: core.renderPipeline,
    scene: core.scene,
    camera: core.camera,
    get route() {
      return routeSelection();
    },
    ready: () => core.ready(),
    async setScenario(id) {
      if (!ARCHITECTURE_SCENARIOS[id]) {
        throw new RangeError(`unknown shadow architecture scenario: ${id}`);
      }
      if (id !== state.scenario) {
        throw new Error(`scenario is locked by route to ${state.scenario}`);
      }
    },
    async setMode(id) {
      const allowed = ARCHITECTURE_BENCH_MODES.includes(id)
        || ARCHITECTURE_BENCH_CAPTURE_ALIASES.includes(id);
      if (!allowed) {
        throw new RangeError(`unknown shadow architecture mode: ${id}`);
      }
      await core.setMode(id);
      // Capture aliases keep the locked public mode as final (core contract).
      state.mode = ARCHITECTURE_BENCH_CAPTURE_ALIASES.includes(id) ? "final" : id;
    },
    async setTier(id) {
      if (id !== "high") throw new RangeError(`unknown shadow architecture tier: ${id}`);
      await core.setTier(id);
      state.tier = id;
    },
    setSeed: (seed) => core.setSeed(seed),
    setCamera: (camera) => core.setCamera(camera),
    setTime: (seconds) => core.setTime(seconds),
    step: (deltaSeconds) => core.step(deltaSeconds),
    resetHistory: (cause) => core.resetHistory(cause),
    resize: (width, height, dpr) => core.resize(width, height, dpr),
    renderOnce: () => core.renderOnce(),
    capturePixels: (target, options) => core.capturePixels(target, options),
    describePipeline() {
      return { ...core.describePipeline(), routeSelection: routeSelection() };
    },
    describeResources: () => core.describeResources(),
    getMetrics() {
      return {
        ...core.getMetrics(),
        // Wrapper lab identity wins over the shared cached-clipmap core.
        labId: "webgpu-shadow-architecture-bench",
        sceneId: "webgpu-shadow-architecture-bench",
        scenario: state.scenario,
        mechanism: state.mechanism,
        mechanismId: state.mechanism,
        tier: state.tier,
        tierId: state.tier,
        mode: state.mode,
        routeSelection: {
          ...routeSelection(),
          labId: "webgpu-shadow-architecture-bench",
        },
      };
    },
    dispose: () => core.dispose(),
  };
}

/**
 * Creates one same-scene architecture subject. Timing remains null until the
 * current adapter capture resolves timestamp queries; this function never
 * substitutes CPU time or a copied constant.
 */
export async function createShadowArchitectureBench({
  canvas,
  selection,
  scenario,
  tier,
  mode,
  width = 1200,
  height = 800,
  dpr = 1,
} = {}) {
  const selected = selection ?? (
    scenario !== undefined || tier !== undefined || mode !== undefined
      ? selectArchitectureScenario({ scenario, tier, mode })
      : resolveArchitectureBenchRoute(globalThis.location?.search ?? "")
  );
  const checkedSelection = selectArchitectureScenario(selected);
  const core = await createCanonicalShadowLab({
    canvas,
    pathname: `/demos/webgpu-cached-clipmap-shadow/mechanism/${checkedSelection.mechanism}/`,
    width,
    height,
    dpr,
  });
  await core.ready();
  if (checkedSelection.mode !== "final") await core.setMode(checkedSelection.mode);
  const controller = createPublicController(core, checkedSelection);
  return {
    scenario: checkedSelection.scenario,
    architecture: checkedSelection.architecture,
    mechanism: checkedSelection.mechanism,
    controller,
    evidence: {
      gpuFrameP50Ms: null,
      gpuFrameP95Ms: null,
      shadowUpdateP95Ms: null,
      verdict: "INSUFFICIENT_EVIDENCE",
      reason: "current-adapter timestamp and render-target capture not run",
    },
  };
}

export async function runArchitectureComparison({
  scenarios = Object.keys(ARCHITECTURE_SCENARIOS),
  createCanvas,
  capture,
} = {}) {
  if (typeof createCanvas !== "function") {
    throw new TypeError("runArchitectureComparison requires a createCanvas callback");
  }
  const results = [];
  for (const scenario of scenarios) {
    const subject = await createShadowArchitectureBench({
      canvas: createCanvas(scenario),
      scenario,
    });
    try {
      const captureResult = typeof capture === "function"
        ? await capture(subject)
        : null;
      results.push({
        scenario,
        architecture: subject.architecture,
        pipeline: subject.controller.describePipeline(),
        resources: subject.controller.describeResources(),
        evidence: captureResult ?? subject.evidence,
      });
    } finally {
      await subject.controller.dispose();
    }
  }
  return results;
}
