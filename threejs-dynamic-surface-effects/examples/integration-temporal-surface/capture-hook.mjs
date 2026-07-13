/** Lab-specific capture modes for temporal-surface integration. */

export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  { id: "no-post.design", status: "CAPTURED", filename: "no-post.design.png" },
  { id: "diagnostics.mosaic", status: "CAPTURED", filename: "diagnostics.mosaic.png" },
  { id: "camera.near", status: "CAPTURED", filename: "camera.near.png" },
  { id: "camera.design", status: "CAPTURED", filename: "camera.design.png" },
  { id: "camera.far", status: "CAPTURED", filename: "camera.far.png" },
  { id: "seed-0001.final", status: "CAPTURED", filename: "seed-0001.final.png" },
  { id: "seed-9e3779b9.final", status: "CAPTURED", filename: "seed-9e3779b9.final.png" },
  { id: "temporal.t000", status: "CAPTURED", filename: "temporal.t000.png" },
  { id: "temporal.t001", status: "CAPTURED", filename: "temporal.t001.png" },
]);

const BASELINE_SEED = 0x00000001;
const STRESS_SEED = 0x9e3779b9;
// surface-history at t=0 is a cleared history buffer (pure black). Warm the
// touch-history path with many steps so t000/t001 are non-blank and differ.
const TEMPORAL_T0 = 0.5;
const TEMPORAL_T1 = 0.5 + 1 / 60;

async function select(session, {
  mode = "final",
  camera = "design",
  tier = "full",
  seed = BASELINE_SEED,
  time = 0,
} = {}) {
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setTime", time);
  await session.controllerCall("renderOnce");
}

export async function captureLab(session) {
  const captures = [];
  async function capture(filename, state) {
    await select(session, state);
    captures.push({ filename, ...(await session.writeCapture(filename, "presentation")) });
  }

  await capture("final.design.png", { mode: "final", time: TEMPORAL_T0 });
  await capture("no-post.design.png", { mode: "host-scene-color", time: TEMPORAL_T0 });
  // owner-graph is a solid constant fill; frost-mask is the multi-color surface diagnostic.
  await capture("diagnostics.mosaic.png", { mode: "frost-mask", time: TEMPORAL_T0 });
  await capture("camera.near.png", { camera: "near", time: TEMPORAL_T0 });
  await capture("camera.design.png", { camera: "design", time: TEMPORAL_T0 });
  await capture("camera.far.png", { camera: "far", time: TEMPORAL_T0 });
  await capture("seed-0001.final.png", { seed: BASELINE_SEED, time: TEMPORAL_T0 });
  await capture("seed-9e3779b9.final.png", { seed: STRESS_SEED, time: TEMPORAL_T0 });
  await capture("temporal.t000.png", { mode: "surface-history", time: TEMPORAL_T0 });
  await capture("temporal.t001.png", { mode: "surface-history", time: TEMPORAL_T1 });

  const locked = session.lockedState;
  if (locked) {
    await select(session, {
      mode: locked.mode,
      camera: locked.camera,
      tier: locked.tier,
      seed: locked.seed,
      time: locked.timeSeconds,
    });
  } else {
    await select(session);
  }
  return {
    schemaVersion: 2,
    acceptanceStatus: "incomplete",
    captures,
    note: "Host temporal presentation readbacks (final/host-scene-color/frost-mask/surface-history). Dependency accepts and GPU timestamps remain incomplete.",
  };
}

export default captureLab;
