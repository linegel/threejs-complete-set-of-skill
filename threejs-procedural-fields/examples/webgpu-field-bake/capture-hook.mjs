import { createHash } from "node:crypto";
import sharp from "sharp";

import {
  FIELD_MECHANISM_IDS,
  analyzeFieldMechanismRgba,
  validateReportedFieldMechanismStatistics,
} from "./mechanism-evidence.mjs";

export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  {
    id: "no-post.design",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "The field lab has no optional post-processing stage to disable.",
    graphProof: {
      finalOwner: "renderOutput",
      optionalPostNodes: 0,
      outputTransformOwners: 1,
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeJson(session, relativePath, value) {
  await session.writeArtifact(
    relativePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
  );
}

async function selectState(session, {
  scenario,
  mode = "final",
  tier = "gpu-storage",
  camera = "design",
  seed = 0x00000001,
  time = 0,
}) {
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setScenario", scenario);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setTime", time);
  await session.controllerCall("renderOnce");
}

async function writeStateCapture(session, captures, filename, state, target = "display") {
  await selectState(session, state);
  const metadata = await session.writeCapture(filename, target);
  captures.push(metadata);
  return metadata;
}

function requireDistinct(captures, firstFilename, secondFilename) {
  const first = captures.find((capture) => capture.png?.path === firstFilename);
  const second = captures.find((capture) => capture.png?.path === secondFilename);
  if (!first?.png?.sha256 || !second?.png?.sha256) {
    throw new Error(`missing hash-bound captures for ${firstFilename} and ${secondFilename}`);
  }
  if (first.png.sha256 === second.png.sha256) {
    throw new Error(`${firstFilename} and ${secondFilename} are falsely duplicated`);
  }
}

async function captureMechanismDiagnostics(session, captures) {
  const diagnostics = [];
  for (const id of FIELD_MECHANISM_IDS) {
    await selectState(session, {
      scenario: id,
      mode: "final",
      tier: "gpu-storage",
      seed: 17,
      time: 0,
    });
    const filename = `mechanism.${id}.png`;
    const metadata = await session.writeCapture(filename, "diagnostic");
    captures.push(metadata);
    const pngBytes = await session.readArtifact(filename);
    const decoded = await sharp(pngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decodedBytes = new Uint8Array(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    );
    const analyzed = analyzeFieldMechanismRgba(
      decodedBytes,
      decoded.info.width,
      decoded.info.height,
    );
    const statistics = validateReportedFieldMechanismStatistics(
      id,
      analyzed,
      decodedBytes,
      decoded.info.width,
      decoded.info.height,
    );
    const compactSha256 = sha256(decodedBytes);
    const metadataCompactSha256 = String(metadata.normalized?.compactRgbaSha256 ?? "")
      .replace(/^sha256:/, "");
    if (metadataCompactSha256 !== compactSha256) {
      throw new Error(
        `${id} diagnostic PNG/raw mismatch: ` +
        `${compactSha256} != ${metadataCompactSha256}`,
      );
    }
    diagnostics.push(Object.freeze({
      id,
      filename,
      width: decoded.info.width,
      height: decoded.info.height,
      source: "render-target-readback",
      compactRgbaSha256: compactSha256,
      pngSha256: String(metadata.png.sha256).replace(/^sha256:/, ""),
      statistics,
    }));
  }
  return Object.freeze({
    schemaVersion: 2,
    statisticsSource: "recomputed-from-retained-compact-rgba8",
    diagnostics,
  });
}

export async function captureLab(session) {
  const captures = [];

  await selectState(session, {
    scenario: "field-and-gradient-gallery",
    tier: "gpu-storage",
    seed: 17,
  });
  const fieldReadback = await session.controllerCall("captureFieldReadback");
  const storageReadback = await session.controllerCall("captureStoredReadback");
  const placementReadback = await session.controllerCall("capturePlacementReadback");
  const probeCorpus = await session.controllerCall("captureProbeCorpusReadback");
  const dirtyRegion = await session.controllerCall("captureDirtyRegionReadback");
  await writeJson(session, "field-readback.json", fieldReadback);
  await writeJson(session, "field-storage-readback.json", storageReadback);
  await writeJson(session, "field-placement-readback.json", placementReadback);
  await writeJson(session, "field-probe-corpus.json", probeCorpus);
  await writeJson(session, "field-dirty-region.json", dirtyRegion);

  const mechanismDiagnostics = await captureMechanismDiagnostics(session, captures);
  await writeJson(session, "field-mechanism-diagnostics.json", mechanismDiagnostics);

  await writeStateCapture(session, captures, "final.design.png", {
    scenario: "field-and-gradient-gallery",
  });
  await writeStateCapture(session, captures, "diagnostics.mosaic.png", {
    scenario: "field-and-gradient-gallery",
    mode: "gradient",
  }, "diagnostic");
  await writeStateCapture(session, captures, "camera.near.png", {
    scenario: "field-and-gradient-gallery",
    camera: "near",
  });
  await writeStateCapture(session, captures, "camera.design.png", {
    scenario: "field-and-gradient-gallery",
    camera: "design",
  });
  await writeStateCapture(session, captures, "camera.far.png", {
    scenario: "field-and-gradient-gallery",
    camera: "far",
  });
  await writeStateCapture(session, captures, "seed-0001.final.png", {
    scenario: "structured-placement",
    seed: 0x00000001,
  });
  await writeStateCapture(session, captures, "seed-9e3779b9.final.png", {
    scenario: "structured-placement",
    seed: 0x9e3779b9,
  });
  await writeStateCapture(session, captures, "temporal.t000.png", {
    scenario: "shared-cause-composition",
    time: 0,
  });
  await writeStateCapture(session, captures, "temporal.t001.png", {
    scenario: "shared-cause-composition",
    time: 25,
  });

  requireDistinct(captures, "final.design.png", "diagnostics.mosaic.png");
  requireDistinct(captures, "seed-0001.final.png", "seed-9e3779b9.final.png");
  requireDistinct(captures, "temporal.t000.png", "temporal.t001.png");

  return Object.freeze({
    captures: Object.freeze(captures),
    mechanismProof: mechanismDiagnostics,
  });
}

export default captureLab;
