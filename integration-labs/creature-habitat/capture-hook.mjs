/**
 * Correctness capture plan for creature-habitat.
 * Maps standard slots onto habitat modes the controller actually owns.
 */

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

async function select(session, {
  mode = "final",
  camera = "habitat",
  tier = null,
  seed = BASELINE_SEED,
  time = 0,
} = {}) {
  // Prefer the locked capture tier when present so we do not thrash shadow-map
  // sizes between the harness default and the hook default on every frame.
  const lockedTier = session.lockedState?.tier ?? "balanced";
  const nextTier = tier ?? lockedTier;
  await session.controllerCall("setScenario", "habitat");
  await session.controllerCall("setTier", nextTier);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setTime", time);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("renderOnce");
}

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

export async function captureLab(session) {
  const captures = [];
  const capture = async (filename, state, target = "final") => {
    await select(session, state);
    captures.push(await session.writeCapture(filename, target));
  };

  await capture("final.design.png", { mode: "final", camera: "habitat" }, "final");
  await capture("no-post.design.png", { mode: "no-post", camera: "habitat" }, "no-post");
  await capture("diagnostics.mosaic.png", { mode: "owner-graph", camera: "habitat" }, "owner-graph");
  await capture("camera.near.png", { mode: "final", camera: "subject" }, "final");
  await capture("camera.design.png", { mode: "final", camera: "habitat" }, "final");
  await capture("camera.far.png", { mode: "final", camera: "population" }, "final");
  await capture("seed-0001.final.png", { mode: "final", camera: "habitat", seed: BASELINE_SEED }, "final");
  await capture("seed-9e3779b9.final.png", { mode: "final", camera: "habitat", seed: STRESS_SEED }, "final");
  await capture("temporal.t000.png", { mode: "final", camera: "habitat", time: 0 }, "final");
  await capture("temporal.t001.png", { mode: "final", camera: "habitat", time: 1.5 }, "final");

  // Lab-owned diagnostic readbacks required by the static controller contract.
  await select(session, { mode: "final", time: 1.5 });
  captures.push(await session.writeCapture("outline.actual-emissive-mrt.png", "outline"));
  captures.push(await session.writeCapture("shadow.actual-atlas.png", "shadow-atlas"));
  captures.push(await session.writeCapture("contact-events.design.png", "contact-events"));

  assertDistinct(captures, "final.design.png", "diagnostics.mosaic.png");
  assertDistinct(captures, "seed-0001.final.png", "seed-9e3779b9.final.png");
  assertDistinct(captures, "temporal.t000.png", "temporal.t001.png");

  const locked = session.lockedState ?? {};
  await select(session, {
    mode: locked.mode ?? "final",
    camera: locked.camera ?? "habitat",
    tier: locked.tier ?? "balanced",
    seed: locked.seed ?? BASELINE_SEED,
    time: locked.timeSeconds ?? 0,
  });

  return Object.freeze({
    status: "incomplete",
    publishable: false,
    captures: Object.freeze(captures),
    pipeline: await session.controllerCall("describePipeline"),
    resources: await session.controllerCall("describeResources"),
    metrics: await session.controllerCall("getMetrics"),
    readbackProvenance: {
      outline: "RGBA8 diagnostic is derived from the real creature-only emissive MRT attachment; raw target: outline-mask",
      shadow: "RGBA8 diagnostic samples the real allocated host directional-shadow atlas; capture target: shadow-atlas",
    },
    note: "Standard presentation slots captured; full v2 release promotion remains separate.",
  });
}

export default captureLab;
