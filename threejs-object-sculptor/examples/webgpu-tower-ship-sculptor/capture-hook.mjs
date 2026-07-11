async function applyState(session, {
  mode = "final",
  tier = "full",
  camera = "design",
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
    ["final.design.png", { mode: "final", camera: "design" }],
    ["blockout.design.png", { mode: "blockout", camera: "design" }],
    ["hierarchy.design.png", { mode: "hierarchy", camera: "design" }],
    ["materials.close.png", { mode: "materials", camera: "close-material" }],
    ["interaction.design.t000.png", { mode: "interaction", camera: "design", time: 0 }],
    ["interaction.design.t120.png", { mode: "interaction", camera: "design", time: 2 }],
    ["camera.profile.png", { mode: "final", camera: "profile" }],
    ["camera.bow.png", { mode: "final", camera: "bow" }],
    ["tier.budgeted.png", { mode: "final", tier: "budgeted", camera: "design" }],
    ["tier.minimum.png", { mode: "final", tier: "minimum", camera: "design" }],
  ];
  const captures = [];
  for (const [filename, state] of plan) {
    await applyState(session, state);
    captures.push({ filename, state, ...(await session.writeCapture(filename, "presentation")) });
  }
  await applyState(session, { mode: "final", tier: "full", camera: "design", seed: 1, time: 0 });
  return {
    schemaVersion: 2,
    captures,
    evidenceStatus: "INCOMPLETE",
    note: "Render-target evidence proves native WebGPU reachability, fixed modes/cameras, tier invariants, and action motion. AI vision scoring, sustained timing, and lifecycle evidence remain separate gates.",
  };
}

export default captureLab;

