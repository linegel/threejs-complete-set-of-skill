/**
 * Weather-volume capture hook with standard outputPlan.
 * no-post is not a real graph bypass for this lab (host always owns renderOutput).
 */

export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  {
    id: "no-post.design",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "Weather composite always runs under host RenderPipeline renderOutput; there is no optional post graph to disable.",
    graphProof: {
      finalOwner: "renderOutput",
      optionalPostNodes: 0,
      hostOwnedComposite: true,
    },
  },
  { id: "diagnostics.mosaic", status: "CAPTURED", filename: "diagnostics.mosaic.png" },
  { id: "camera.near", status: "CAPTURED", filename: "camera.near.png" },
  { id: "camera.design", status: "CAPTURED", filename: "camera.design.png" },
  { id: "camera.far", status: "CAPTURED", filename: "camera.far.png" },
  { id: "seed-0001.final", status: "CAPTURED", filename: "seed-0001.final.png" },
  { id: "seed-9e3779b9.final", status: "CAPTURED", filename: "seed-9e3779b9.final.png" },
  { id: "temporal.t000", status: "CAPTURED", filename: "temporal.t000.png" },
  { id: "temporal.t001", status: "CAPTURED", filename: "temporal.t001.png" },
]);

const REPRESENTATIVE_SEED = 1;
const STRESS_SEED = 0x9e3779b9;

async function select(session, {
  mode = "final",
  camera = "design",
  seed = REPRESENTATIVE_SEED,
  time = 0,
  scenario = "spherical-shell",
  tier = "ultra",
} = {}) {
  await session.controllerCall("setScenario", scenario);
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setTime", time);
  await session.controllerCall("renderOnce");
}

async function capture(session, filename, state) {
  await select(session, state);
  return { filename, state, ...(await session.writeCapture(filename, "final")) };
}

export async function captureLab(session) {
  const captures = [];
  captures.push(await capture(session, "final.design.png", { mode: "final", camera: "design" }));
  // Diagnostic mosaic: density-like mode
  captures.push(await capture(session, "diagnostics.mosaic.png", {
    mode: "density", camera: "design",
  }));
  captures.push(await capture(session, "camera.near.png", { mode: "final", camera: "near" }));
  captures.push(await capture(session, "camera.design.png", { mode: "final", camera: "design" }));
  captures.push(await capture(session, "camera.far.png", { mode: "final", camera: "far" }));
  captures.push(await capture(session, "seed-0001.final.png", {
    mode: "final", seed: REPRESENTATIVE_SEED,
  }));
  captures.push(await capture(session, "seed-9e3779b9.final.png", {
    mode: "final", seed: STRESS_SEED,
  }));
  captures.push(await capture(session, "temporal.t000.png", {
    mode: "final", time: 0,
  }));
  captures.push(await capture(session, "temporal.t001.png", {
    mode: "final", time: 1 / 60,
  }));
  await select(session, { mode: "final", camera: "design", seed: REPRESENTATIVE_SEED, time: 0 });
  return {
    schemaVersion: 2,
    captures,
    evidenceStatus: "INCOMPLETE",
    note: "Native WebGPU weather correctness readbacks. Full release-bundle lifecycle/performance promotion remains separate.",
  };
}

export default captureLab;
