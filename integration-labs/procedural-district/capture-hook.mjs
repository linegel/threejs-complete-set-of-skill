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

async function applyState(session, {
  mode = "final",
  tier = "balanced",
  camera = "district",
  seed = 1,
  time = 0,
} = {}) {
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setTime", time);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("renderOnce");
}

export async function captureLab(session) {
  const plan = [
    ["final.design.png", { mode: "final", camera: "district" }],
    ["no-post.design.png", { mode: "no-post", camera: "district" }],
    ["camera.near.png", { mode: "final", camera: "street" }],
    ["camera.design.png", { mode: "final", camera: "district" }],
    ["camera.far.png", { mode: "final", camera: "aerial" }],
    ["seed-0001.final.png", { mode: "final", seed: 1 }],
    ["seed-9e3779b9.final.png", { mode: "final", seed: 0x9e3779b9 }],
    ["temporal.t000.png", { mode: "weather-state", time: 0 }],
    ["temporal.t001.png", { mode: "weather-state", time: 1 / 60 }],
    ["tier.hero.png", { mode: "final", tier: "hero" }],
    ["tier.balanced.png", { mode: "final", tier: "balanced" }],
    ["tier.budgeted.png", { mode: "final", tier: "budgeted" }],
  ];
  const captures = [];
  for (const [filename, state] of plan) {
    await applyState(session, state);
    captures.push({ filename, state, ...(await session.writeCapture(filename, "display")) });
  }

  await applyState(session, { mode: "owner-graph", camera: "district", seed: 1, time: 0, tier: "balanced" });
  captures.push({
    filename: "diagnostics.mosaic.png",
    ...(await session.writeCapture("diagnostics.mosaic.png", "display")),
  });

  const locked = session.lockedState;
  if (locked) {
    await applyState(session, {
      mode: locked.mode,
      camera: locked.camera,
      seed: locked.seed,
      time: locked.timeSeconds,
      tier: locked.tier,
    });
  } else {
    await applyState(session, { tier: "hero", camera: "street", seed: 1, time: 0, mode: "final" });
  }
  return {
    schemaVersion: 2,
    captures,
    evidenceStatus: "INCOMPLETE",
    note: "Standard color-managed PNGs are render-target readbacks. GPU timestamps, visual-error metrics, and lifecycle evidence remain required.",
  };
}

export default captureLab;
