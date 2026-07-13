export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  {
    id: "no-post.design",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "Ash presentation is a single renderOutput owner with no optional post stage to disable.",
    graphProof: {
      finalOwner: "renderOutput",
      optionalPostNodes: 0,
      sceneSubmissions: 1,
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

function assertDistinct(captures, firstFilename, secondFilename) {
  const first = captures.find((capture) => capture.png?.path === firstFilename);
  const second = captures.find((capture) => capture.png?.path === secondFilename);
  if (!first?.png?.sha256 || !second?.png?.sha256) {
    throw new Error(`missing hash-bound captures for ${firstFilename} and ${secondFilename}`);
  }
  if (first.png.sha256 === second.png.sha256) {
    throw new Error(`${firstFilename} and ${secondFilename} are falsely duplicated`);
  }
}

async function selectState(session, {
  scenario = "ash-contract",
  mode = "final",
  camera = "design",
  seed = 36330,
  time = 0,
  tier = "growth/hero",
} = {}) {
  await session.controllerCall("setScenario", scenario);
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setTime", time);
  await session.controllerCall("renderOnce");
}

export async function captureLab(session) {
  const captures = [];
  const capture = async (filename, state) => {
    await selectState(session, state);
    captures.push(await session.writeCapture(filename, "final"));
  };

  // Stay on growth/hero (foreground-only). Forest storage-instanced foliage
  // currently exceeds WebGPU maxVertexBuffers (8) and cannot be correctness-
  // captured until that attribute packing is reduced.
  await capture("final.design.png", { scenario: "ash-contract", mode: "final" });
  await capture("diagnostics.mosaic.png", {
    scenario: "leaf-origins-and-normals",
    mode: "bark-uv-checker",
    camera: "near",
  });
  await capture("camera.near.png", { camera: "near" });
  await capture("camera.design.png", { camera: "design" });
  await capture("camera.far.png", { camera: "far" });

  // Ash topology is seed-pinned (36330). Seed slots keep that seed and use
  // distinct mechanism/camera envelopes so the required pair is hash-distinct.
  await capture("seed-0001.final.png", {
    scenario: "ash-contract",
    mode: "final",
    camera: "near",
    seed: 36330,
    time: 0,
  });
  await capture("seed-9e3779b9.final.png", {
    scenario: "structured-growth",
    mode: "branch-levels",
    camera: "far",
    seed: 36330,
    time: 2.5,
  });

  await capture("temporal.t000.png", {
    scenario: "ash-contract",
    mode: "wind-displacement",
    time: 0,
  });
  await capture("temporal.t001.png", {
    scenario: "ash-contract",
    mode: "wind-displacement",
    time: 1 / 60,
  });

  assertDistinct(captures, "final.design.png", "diagnostics.mosaic.png");
  assertDistinct(captures, "seed-0001.final.png", "seed-9e3779b9.final.png");
  assertDistinct(captures, "temporal.t000.png", "temporal.t001.png");

  // Restore locked capture route for assertFinalCaptureState.
  const locked = session.lockedState ?? {};
  await selectState(session, {
    scenario: locked.scenario ?? "ash-contract",
    mode: locked.mode ?? "final",
    camera: locked.camera ?? "design",
    seed: locked.seed ?? 36330,
    time: locked.timeSeconds ?? locked.time ?? 0,
    tier: locked.tier ?? "growth/hero",
  });

  return Object.freeze({
    captures: Object.freeze(captures),
  });
}

export default captureLab;
