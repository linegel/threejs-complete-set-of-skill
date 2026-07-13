import { createCanonicalShadowLab } from "../webgpu-cached-clipmap-shadow/canonical-lab.js";

export const PIPELINE_INTEGRATION_SCENARIO = "cached-shadow-image-pipeline";
export const PIPELINE_INTEGRATION_MODES = Object.freeze([
  "final",
  "shadow-depth",
  "owner-graph",
]);

// Builtin capture recipes use these display aliases; canonical core maps them.
export const PIPELINE_INTEGRATION_CAPTURE_ALIASES = Object.freeze([
  "no-post",
  "diagnostics",
]);
export const PIPELINE_INTEGRATION_MECHANISMS = Object.freeze({
  "child-shadow-receiver-blend": "final",
  "sequential-shadow-updates": "owner-graph",
  "single-output-ownership": "owner-graph",
});

function selectPipelineIntegration({
  scenario = PIPELINE_INTEGRATION_SCENARIO,
  mechanism = null,
  tier = "high",
  mode,
} = {}) {
  if (scenario !== PIPELINE_INTEGRATION_SCENARIO) {
    throw new RangeError(`unknown shadow pipeline scenario: ${scenario}`);
  }
  if (mechanism !== null && !(mechanism in PIPELINE_INTEGRATION_MECHANISMS)) {
    throw new RangeError(`unknown shadow pipeline mechanism: ${mechanism}`);
  }
  if (tier !== "high") throw new RangeError(`unknown shadow pipeline tier: ${tier}`);
  const mechanismMode = mechanism === null ? null : PIPELINE_INTEGRATION_MECHANISMS[mechanism];
  if (mode !== undefined && mechanismMode !== null && mode !== mechanismMode) {
    throw new Error(`mode ${mode} conflicts with mechanism ${mechanism}`);
  }
  const selectedMode = mode ?? mechanismMode ?? "final";
  if (!PIPELINE_INTEGRATION_MODES.includes(selectedMode)) {
    throw new RangeError(`unknown shadow pipeline mode: ${selectedMode}`);
  }
  return Object.freeze({ scenario, mechanism, tier, mode: selectedMode });
}

export function resolveShadowPipelineIntegrationRoute(search = "") {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  return selectPipelineIntegration({
    scenario: params.get("scenario") ?? PIPELINE_INTEGRATION_SCENARIO,
    mechanism: params.get("mechanism"),
    tier: params.get("tier") ?? "high",
    mode: params.get("mode") ?? undefined,
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
      if (id !== PIPELINE_INTEGRATION_SCENARIO) {
        throw new RangeError(`unknown shadow pipeline scenario: ${id}`);
      }
      state.scenario = id;
    },
    async setMode(id) {
      const allowed = PIPELINE_INTEGRATION_MODES.includes(id)
        || PIPELINE_INTEGRATION_CAPTURE_ALIASES.includes(id);
      if (!allowed) {
        throw new RangeError(`unknown shadow pipeline mode: ${id}`);
      }
      await core.setMode(id);
      // Capture aliases keep the locked public mode as final (core contract).
      state.mode = PIPELINE_INTEGRATION_CAPTURE_ALIASES.includes(id) ? "final" : id;
    },
    async setTier(id) {
      if (id !== "high") throw new RangeError(`unknown shadow pipeline tier: ${id}`);
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
        labId: "webgpu-shadow-pipeline-integration",
        sceneId: "webgpu-shadow-pipeline-integration",
        scenario: state.scenario,
        mechanism: state.mechanism,
        mechanismId: state.mechanism,
        tier: state.tier,
        tierId: state.tier,
        mode: state.mode,
        routeSelection: {
          ...routeSelection(),
          labId: "webgpu-shadow-pipeline-integration",
        },
      };
    },
    dispose: () => core.dispose(),
  };
}

export async function createShadowPipelineIntegration({
  selection,
  scenario,
  mechanism,
  tier,
  mode,
  ...options
} = {}) {
  const selected = selection ?? (
    scenario !== undefined || mechanism !== undefined || tier !== undefined || mode !== undefined
      ? selectPipelineIntegration({ scenario, mechanism, tier, mode })
      : resolveShadowPipelineIntegrationRoute(globalThis.location?.search ?? "")
  );
  const checkedSelection = selectPipelineIntegration(selected);
  const core = await createCanonicalShadowLab({
    ...options,
    pathname: "/demos/webgpu-cached-clipmap-shadow/tier/high/",
  });
  await core.ready();
  if (checkedSelection.mode !== "final") await core.setMode(checkedSelection.mode);
  const graph = core.describePipeline();
  if (graph.renderPipelineOutputColorTransform !== false) {
    await core.dispose();
    throw new Error("renderOutput ownership requires RenderPipeline.outputColorTransform=false");
  }
  if (
    graph.owners.renderer !== "canonical-shadow-lab" ||
    graph.owners.finalRenderPipeline !== "canonical-shadow-lab" ||
    graph.owners.toneMap !== "renderOutput" ||
    graph.owners.finalOutputTransform !== "renderOutput"
  ) {
    await core.dispose();
    throw new Error("shadow integration owner graph is inconsistent");
  }
  return createPublicController(core, checkedSelection);
}
