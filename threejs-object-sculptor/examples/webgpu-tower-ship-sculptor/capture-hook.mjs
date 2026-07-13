/**
 * Tower-ship capture hook.
 * Standard outputPlan satisfies capture-lab-browser; extra lab-owned images
 * keep validate-artifacts.mjs green.
 */

const REPRESENTATIVE_SEED = 1;
const STRESS_SEED = 0x9e3779b9; // 2654435769

export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  {
    id: "no-post.design",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "Tower ship uses a single WebGPURenderer scene pass with no optional post graph to disable.",
    graphProof: {
      finalOwner: "renderer",
      sceneRendersPerFrame: 1,
      optionalPostNodes: 0,
      postprocessing: false,
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

async function applyState(session, {
  mode = "final",
  tier = "full",
  camera = "design",
  seed = REPRESENTATIVE_SEED,
  time = 0,
} = {}) {
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setTime", time);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("renderOnce");
}

async function capture(session, filename, state, target = "presentation") {
  await applyState(session, state);
  return {
    filename,
    state,
    ...(await session.writeCapture(filename, target)),
  };
}

export async function captureLab(session) {
  const captures = [];

  // Normative standard outputs (camera.near/far map onto tower profile/bow).
  captures.push(await capture(session, "final.design.png", {
    mode: "final", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  // Hierarchy mode is a distinct diagnostic materialization (must differ from final).
  captures.push(await capture(session, "diagnostics.mosaic.png", {
    mode: "hierarchy", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "camera.near.png", {
    mode: "final", camera: "profile", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "camera.design.png", {
    mode: "final", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "camera.far.png", {
    mode: "final", camera: "bow", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "seed-0001.final.png", {
    mode: "final", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "seed-9e3779b9.final.png", {
    mode: "final", camera: "design", seed: STRESS_SEED, time: 0,
  }));
  captures.push(await capture(session, "temporal.t000.png", {
    mode: "interaction", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "temporal.t001.png", {
    mode: "interaction", camera: "design", seed: REPRESENTATIVE_SEED, time: 2,
  }));

  // Lab-owned mechanism/tier evidence retained for validate-artifacts.mjs.
  captures.push(await capture(session, "blockout.design.png", {
    mode: "blockout", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "hierarchy.design.png", {
    mode: "hierarchy", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "materials.close.png", {
    mode: "materials", camera: "close-material", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "interaction.design.t000.png", {
    mode: "interaction", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "interaction.design.t120.png", {
    mode: "interaction", camera: "design", seed: REPRESENTATIVE_SEED, time: 2,
  }));
  captures.push(await capture(session, "camera.profile.png", {
    mode: "final", camera: "profile", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "camera.bow.png", {
    mode: "final", camera: "bow", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "tier.budgeted.png", {
    mode: "final", tier: "budgeted", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));
  captures.push(await capture(session, "tier.minimum.png", {
    mode: "final", tier: "minimum", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  }));

  await applyState(session, {
    mode: "final", tier: "full", camera: "design", seed: REPRESENTATIVE_SEED, time: 0,
  });

  return {
    schemaVersion: 2,
    captures,
    evidenceStatus: "INCOMPLETE",
    note: "Native WebGPU readbacks prove fixed modes/cameras, tier invariants, action motion, and standard capture outputs. Sustained timing and full release-bundle promotion remain separate gates.",
  };
}

export default captureLab;
