import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { encodeRgbaPng } from "../../scripts/lib/png-rgba.mjs";

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

function mosaic(captures) {
  const width = captures[0].width;
  const height = captures[0].height;
  if (captures.some((capture) => capture.width !== width || capture.height !== height)) {
    throw new Error("Procedural District diagnostic mosaic requires equal capture extents.");
  }
  const data = new Uint8Array(width * height * 4);
  const halfWidth = Math.ceil(width / 2);
  const halfHeight = Math.ceil(height / 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const column = x < halfWidth ? 0 : 1;
      const row = y < halfHeight ? 0 : 1;
      const source = captures[row * 2 + column];
      const sourceX = Math.min(width - 1, Math.floor((x % halfWidth) * width / halfWidth));
      const sourceY = Math.min(height - 1, Math.floor((y % halfHeight) * height / halfHeight));
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { width, height, data };
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

  await applyState(session, { tier: "balanced", camera: "district", seed: 1, time: 0, mode: "final" });
  const diagnosticCaptures = [];
  for (const mode of ["shared-field", "facade-ownership", "material-slots", "owner-graph"]) {
    await session.controllerCall("setMode", mode);
    await session.controllerCall("renderOnce");
    diagnosticCaptures.push(await session.capturePixels("display"));
  }
  const diagnosticMosaic = mosaic(diagnosticCaptures);
  writeFileSync(join(session.outputDir, "diagnostics.mosaic.png"), encodeRgbaPng(diagnosticMosaic));
  captures.push({
    filename: "diagnostics.mosaic.png",
    modes: ["shared-field", "facade-ownership", "material-slots", "owner-graph"],
    width: diagnosticMosaic.width,
    height: diagnosticMosaic.height,
    format: "rgba8",
    colorEncoding: "srgb",
  });

  await applyState(session, { tier: "balanced", camera: "district", seed: 1, time: 0, mode: "final" });
  return {
    schemaVersion: 2,
    captures,
    evidenceStatus: "INCOMPLETE",
    note: "Standard color-managed PNGs are render-target readbacks. GPU timestamps, visual-error metrics, and lifecycle evidence remain required.",
  };
}

export default captureLab;
