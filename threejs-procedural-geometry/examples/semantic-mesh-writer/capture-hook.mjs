export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  {
    id: "no-post.design",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "The canonical geometry inspection graph has no optional post stage to disable.",
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

export function assertCaptureHashesDistinct(captures, firstFilename, secondFilename) {
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
  mode,
  camera = "design",
  seed = 0x00000001,
  time = 0,
  tier = "hero",
}) {
  await session.controllerCall("setScenario", mode);
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setTime", time);
  await session.controllerCall("renderOnce");
}

export async function captureLab(session) {
  await selectState(session, { mode: "batching-comparison" });
  const drawAudit = await session.controllerCall("auditBatchingStrategies");
  if (drawAudit.verdict !== "PASS") {
    throw new Error(`native strategy draw audit failed: ${JSON.stringify(drawAudit.records)}`);
  }
  const storage = await session.controllerCall("readStorageState");
  if (storage.reconciliation.verdict !== "PASS") {
    throw new Error(`native storage-output reconciliation failed: ${storage.reconciliation.errors.join("; ")}`);
  }

  await selectState(session, { mode: "indirect-draw" });
  const indirect = await session.controllerCall("readIndirectState");
  if (indirect.reconciliation.verdict !== "PASS") {
    throw new Error(`native indirect command reconciliation failed: ${indirect.reconciliation.errors.join("; ")}`);
  }

  const resourceSnapshots = [];
  for (const mode of [
    "frame-and-rail-profile",
    "branch-rings",
    "semantic-groups-and-materials",
    "batching-comparison",
    "dynamic-updates",
    "indirect-draw",
  ]) {
    await selectState(session, { mode });
    await session.controllerCall("renderOnce");
    const snapshot = await session.controllerCall("describeResources");
    if (
      snapshot.completeness !== "COMPLETE_FOR_CPU_VISIBLE_ARRAYS_AND_EXPLICIT_RENDER_TARGETS" ||
      snapshot.opaqueRendererInternalResidency?.verdict !== "NOT_CLAIMED" ||
      !(snapshot.totals?.accessibleResidentBytes > 0)
    ) {
      throw new Error(`resource snapshot for ${mode} is incomplete or guesses opaque residency`);
    }
    resourceSnapshots.push(snapshot);
  }

  const captures = [];
  const capture = async (filename, state) => {
    await selectState(session, state);
    captures.push(await session.writeCapture(filename, "presentation"));
  };

  await capture("final.design.png", { mode: "frame-and-rail-profile" });
  await capture("diagnostics.mosaic.png", { mode: "semantic-groups-and-materials" });
  await capture("camera.near.png", { mode: "frame-and-rail-profile", camera: "near" });
  await capture("camera.design.png", { mode: "frame-and-rail-profile", camera: "design" });
  await capture("camera.far.png", { mode: "frame-and-rail-profile", camera: "far" });
  await capture("seed-0001.final.png", {
    mode: "branch-rings",
    seed: 0x00000001,
  });
  await capture("seed-9e3779b9.final.png", {
    mode: "branch-rings",
    seed: 0x9e3779b9,
  });
  await capture("temporal.t000.png", {
    mode: "dynamic-updates",
    time: 0,
  });
  await capture("temporal.t001.png", {
    mode: "dynamic-updates",
    time: 0.5,
  });

  assertCaptureHashesDistinct(captures, "final.design.png", "diagnostics.mosaic.png");
  assertCaptureHashesDistinct(captures, "seed-0001.final.png", "seed-9e3779b9.final.png");
  assertCaptureHashesDistinct(captures, "temporal.t000.png", "temporal.t001.png");

  const runtimeProof = {
    schemaVersion: 1,
    labId: session.lab.id,
    profile: session.profile,
    drawAudit,
    storage,
    indirect,
    resourceSnapshots,
    generatedAt: new Date().toISOString(),
  };
  await session.writeArtifact(
    "semantic-runtime-proof.json",
    Buffer.from(`${JSON.stringify(runtimeProof, null, 2)}\n`),
  );

  return Object.freeze({
    captures: Object.freeze(captures),
    mechanismProof: Object.freeze(runtimeProof),
  });
}

export default captureLab;
