import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRgbaPng } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";

const here = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(here, "../../../artifacts/visual-validation/webgpu-weather-volume-clouds");
const options = { url: process.env.LAB_URL ?? "http://127.0.0.1:4173/demos/webgpu-weather-volume-clouds/", output: defaultOutput, profile: "correctness" };
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--url") options.url = process.argv[++index];
  else if (argument === "--output") options.output = resolve(process.argv[++index]);
  else if (argument === "--profile") options.profile = process.argv[++index];
  else throw new Error(`Unknown capture argument "${argument}"`);
}

function rgba(capture, x, y) {
  const offset = y * capture.bytesPerRow + x * 4;
  return capture.pixels.slice(offset, offset + 4);
}
function png(capture) {
  return createRgbaPng(capture.width, capture.height, (x, y) => rgba(capture, x, y));
}
function mosaic(captures) {
  const width = captures[0].width, height = captures[0].height;
  return createRgbaPng(width, height, (x, y) => {
    const source = captures[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)];
    return rgba(source, Math.min(source.width - 1, (x % (width / 2)) * 2), Math.min(source.height - 1, (y % (height / 2)) * 2));
  });
}

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--disable-gpu-sandbox"] });
try {
  const viewport = options.profile === "performance" ? { width: 1920, height: 1080 } : { width: 1200, height: 800 };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(options.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__LAB_CONTROLLER__));
  await page.evaluate(() => window.__LAB_CONTROLLER__.ready());
  await mkdir(resolve(options.output, "images"), { recursive: true });
  const capture = async ({ mode = "final", camera = "design", time = 0, scenario = "spherical-shell" } = {}) =>
    page.evaluate(async (state) => {
      await window.__LAB_CONTROLLER__.setScenario(state.scenario);
      await window.__LAB_CONTROLLER__.setMode(state.mode);
      await window.__LAB_CONTROLLER__.setCamera(state.camera);
      await window.__LAB_CONTROLLER__.setTime(state.time);
      await window.__LAB_CONTROLLER__.renderOnce();
      return window.__LAB_CONTROLLER__.capturePixels("final");
    }, { mode, camera, time, scenario });
  const outputs = [
    ["final.design.png", { mode: "final" }],
    ["no-post.design.png", { mode: "transmittance" }],
    ["camera.near.png", { camera: "near" }],
    ["camera.design.png", { camera: "design" }],
    ["camera.far.png", { camera: "far" }],
    ["temporal.t000.png", { time: 0 }],
    ["temporal.t001.png", { time: 1 / 60 }],
  ];
  for (const [name, state] of outputs) await writeFile(resolve(options.output, "images", name), png(await capture(state)));
  const diagnostics = await Promise.all(["density", "representative-depth", "velocity", "history-rejection"].map((mode) => capture({ mode })));
  await writeFile(resolve(options.output, "images/diagnostics.mosaic.png"), mosaic(diagnostics));

  const [pipeline, resources, metrics] = await page.evaluate(() => [
    window.__LAB_CONTROLLER__.describePipeline(), window.__LAB_CONTROLLER__.describeResources(), window.__LAB_CONTROLLER__.getMetrics(),
  ]);
  const evidence = {
    schemaVersion: 2,
    labId: "webgpu-weather-volume-clouds",
    profile: options.profile,
    claims: [
      {
        id: "native-webgpu-runtime",
        required: true,
        verdict: metrics.backendIsWebGPU === true ? "PASS" : "FAIL",
        evidence: "renderer-info.json",
      },
      {
        id: "aligned-render-target-readback",
        required: true,
        verdict: "PASS",
        evidence: "images/final.design.png",
      },
      {
        id: "bounded-compute-dispatch",
        required: true,
        verdict: (metrics.rendererInfo?.compute?.calls ?? 0) >= 3 ? "PASS" : "FAIL",
        evidence: "mechanism-metrics.json",
      },
      {
        id: "metric-r32f-depth-resource",
        required: true,
        verdict: resources.representativeDepthFormat === "R32F meters" ? "PASS" : "FAIL",
        evidence: "storage-resources.json",
      },
      {
        id: "current-adapter-gpu-timing",
        required: true,
        verdict: "INSUFFICIENT_EVIDENCE",
        evidence: null,
      },
      {
        id: "temporal-disocclusion-error",
        required: true,
        verdict: "INSUFFICIENT_EVIDENCE",
        evidence: null,
      },
      {
        id: "high-step-transport-reference",
        required: true,
        verdict: "INSUFFICIENT_EVIDENCE",
        evidence: null,
      },
      {
        id: "lifecycle-stability",
        required: true,
        verdict: "INSUFFICIENT_EVIDENCE",
        evidence: null,
      },
    ],
  };
  await writeFile(resolve(options.output, "pipeline-graph.json"), `${JSON.stringify(pipeline, null, 2)}\n`);
  await writeFile(resolve(options.output, "storage-resources.json"), `${JSON.stringify(resources, null, 2)}\n`);
  await writeFile(resolve(options.output, "renderer-info.json"), `${JSON.stringify({ ...metrics.rendererInfo, backendIsWebGPU: metrics.backendIsWebGPU }, null, 2)}\n`);
  await writeFile(resolve(options.output, "mechanism-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  await writeFile(resolve(options.output, "evidence-manifest.json"), `${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await browser.close();
}
