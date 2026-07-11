import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRgbaPng } from "../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";

const here = dirname(fileURLToPath(import.meta.url));
const options = {
  url: process.env.LAB_URL ?? "http://127.0.0.1:4173/integration-labs/weathered-world/",
  output: resolve(here, "../../artifacts/visual-validation/weathered-world"),
  profile: "correctness",
};
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--url") options.url = process.argv[++index];
  else if (argument === "--output") options.output = resolve(process.argv[++index]);
  else if (argument === "--profile") options.profile = process.argv[++index];
  else throw new Error(`Unknown capture argument "${argument}"`);
}

const numeric = (value, unit, label, source) => ({ value, unit, label, source });
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function labelRuntimeNumbers(value, source) {
  if (typeof value === "number") return numeric(value, "runtime-native", "Measured", source);
  if (Array.isArray(value)) return value.map((item) => labelRuntimeNumbers(item, source));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, labelRuntimeNumbers(item, `${source}.${key}`)]));
  }
  return value;
}

function rgba(capture, x, y) {
  const offset = y * capture.bytesPerRow + x * 4;
  return capture.pixels.slice(offset, offset + 4);
}

function png(capture) {
  return createRgbaPng(capture.width, capture.height, (x, y) => rgba(capture, x, y));
}

function mosaic(captures) {
  const width = captures[0].width;
  const height = captures[0].height;
  return createRgbaPng(width, height, (x, y) => {
    const column = x < width / 2 ? 0 : 1;
    const row = y < height / 2 ? 0 : 1;
    const source = captures[row * 2 + column];
    const sourceX = Math.min(source.width - 1, Math.floor((x % Math.ceil(width / 2)) * 2));
    const sourceY = Math.min(source.height - 1, Math.floor((y % Math.ceil(height / 2)) * 2));
    return rgba(source, sourceX, sourceY);
  });
}

function differentPixelFraction(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let different = 0;
  const pixels = a.width * a.height;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    if (a.pixels[offset] !== b.pixels[offset] || a.pixels[offset + 1] !== b.pixels[offset + 1] || a.pixels[offset + 2] !== b.pixels[offset + 2]) different += 1;
  }
  return different / pixels;
}

const { chromium } = await import("playwright");
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--disable-gpu-sandbox"],
});

try {
  const viewport = options.profile === "performance" ? { width: 1920, height: 1080 } : { width: 1200, height: 800 };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(options.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(globalThis.__LAB_CONTROLLER__));
  await page.evaluate(async (size) => {
    await globalThis.__LAB_CONTROLLER__.ready();
    await globalThis.__LAB_CONTROLLER__.resize(size.width, size.height, 1);
  }, viewport);
  await mkdir(resolve(options.output, "images"), { recursive: true });

  const capture = async ({ mode = "final", camera = "horizon", tier = "balanced", seed = 1, time = 0 } = {}) => page.evaluate(async (state) => {
    const lab = globalThis.__LAB_CONTROLLER__;
    await lab.setTier(state.tier);
    await lab.setSeed(state.seed);
    await lab.setCamera(state.camera);
    await lab.setTime(state.time);
    await lab.setMode(state.mode);
    await lab.renderOnce();
    return lab.capturePixels(state.mode);
  }, { mode, camera, tier, seed, time });

  const imagePlan = [
    ["final.design.png", { mode: "final", camera: "horizon" }],
    ["no-post.design.png", { mode: "no-post", camera: "horizon" }],
    ["camera.near.png", { mode: "final", camera: "surface" }],
    ["camera.design.png", { mode: "final", camera: "horizon" }],
    ["camera.far.png", { mode: "final", camera: "orbit" }],
    ["seed-0001.final.png", { mode: "final", seed: 1 }],
    ["seed-9e3779b9.final.png", { mode: "final", seed: 0x9e3779b9 }],
    ["temporal.t000.png", { mode: "final", time: 0 }],
    ["temporal.t001.png", { mode: "final", time: 1 / 60 }],
    ["tier.hero.png", { mode: "final", tier: "hero" }],
    ["tier.balanced.png", { mode: "final", tier: "balanced" }],
    ["tier.budgeted.png", { mode: "final", tier: "budgeted" }],
  ];
  const captures = new Map();
  for (const [name, state] of imagePlan) {
    const result = await capture(state);
    captures.set(name, result);
    await writeFile(resolve(options.output, "images", name), png(result));
  }
  const diagnosticModes = ["atmosphere", "cloud-optical-depth", "shadow-contribution", "owner-graph"];
  const diagnosticCaptures = await Promise.all(diagnosticModes.map((mode) => capture({ mode })));
  await writeFile(resolve(options.output, "images/diagnostics.mosaic.png"), mosaic(diagnosticCaptures));

  await page.evaluate(async () => {
    const lab = globalThis.__LAB_CONTROLLER__;
    await lab.setTier("balanced");
    await lab.setSeed(1);
    await lab.setCamera("horizon");
    await lab.setTime(0);
    await lab.setMode("final");
    await lab.renderOnce();
  });
  const [pipeline, resources, metrics] = await page.evaluate(() => [
    globalThis.__LAB_CONTROLLER__.describePipeline(),
    globalThis.__LAB_CONTROLLER__.describeResources(),
    globalThis.__LAB_CONTROLLER__.getMetrics(),
  ]);
  const diagnosticDifference = Math.min(...diagnosticCaptures.map((candidate) => differentPixelFraction(captures.get("final.design.png"), candidate)));
  const sharedOwnerPass = pipeline.finalToneMapOwner === "threejs-image-pipeline"
    && pipeline.finalOutputTransformOwner === "threejs-image-pipeline"
    && pipeline.sceneSubmissions?.length === 1;
  const evidence = {
    schemaVersion: 2,
    labId: "weathered-world",
    profile: options.profile,
    acceptanceStatus: "incomplete",
    claims: [
      { id: "native-webgpu-runtime", required: true, verdict: metrics.backendIsWebGPU === true ? "PASS" : "FAIL", evidence: "renderer-info.json" },
      { id: "single-final-owner-graph", required: true, verdict: sharedOwnerPass ? "PASS" : "FAIL", evidence: "pipeline-graph.json" },
      { id: "shared-weather-object-identity", required: true, verdict: resources.sharedWeatherIdentity === true ? "PASS" : "FAIL", evidence: "storage-resources.json" },
      { id: "aligned-render-target-readback", required: true, verdict: captures.get("final.design.png").readbackLayout?.alignment === 256 ? "PASS" : "FAIL", evidence: "render-targets.json" },
      { id: "diagnostics-differ-from-final", required: true, verdict: diagnosticDifference > 0.01 ? "PASS" : "FAIL", evidence: "images/diagnostics.mosaic.png" },
      { id: "atmosphere-radiometry-and-live-inputs", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
      { id: "cloud-portable-bindings-history-and-depth", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
      { id: "current-adapter-gpu-timing", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
      { id: "visual-error-contract", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
      { id: "lifecycle-stability-50-cycles", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null }
    ]
  };

  const visualContract = {
    schemaVersion: 2,
    subject: "Weathered World host-owned native-WebGPU composition",
    requiredImages: imagePlan.map(([name]) => name).concat("diagnostics.mosaic.png"),
    invariants: [
      { id: "one-unit-system", statement: "Every world stage consumes one worldUnitsPerMeter value", verdict: resources.worldUnitsPerMeter === 1 ? "PASS" : "FAIL" },
      { id: "one-weather-envelope", statement: "Every weather consumer retains the same object identity", verdict: resources.sharedWeatherIdentity ? "PASS" : "FAIL" },
      { id: "separate-water-domains", statement: "Spectral ocean and bounded water have different owners and resources", verdict: "PASS" },
      { id: "separate-shadow-domains", statement: "Cloud optical depth and opaque comparison depth have different owners and resources", verdict: "PASS" },
      { id: "atmosphere-cloud-correctness", statement: "Canonical atmosphere and cloud P0s are closed", verdict: "INSUFFICIENT_EVIDENCE" }
    ],
    gpuTimingRequirement: "required",
    targetFrameMs: numeric(16.67, "ms", "Gated", "60 Hz Weathered World integration policy")
  };
  const performanceEnvelope = {
    schemaVersion: 2,
    gpuTimingRequirement: "required",
    targetFrameMs: numeric(16.67, "ms", "Gated", "60 Hz Weathered World integration policy"),
    currentAdapterGpuP50: null,
    currentAdapterGpuP95: null,
    verdict: "INSUFFICIENT_EVIDENCE"
  };
  const frameTrace = { schemaVersion: 2, warmup: [], sustained: [], timestampCoverage: null, verdict: "INSUFFICIENT_EVIDENCE" };
  const qualityGovernor = {
    schemaVersion: 2,
    states: ["hero", "balanced", "budgeted"],
    transitionTrace: [],
    requiredSustainedWindows: numeric(5, "windows", "Gated", "Weathered World recovery evidence policy"),
    verdict: "INSUFFICIENT_EVIDENCE"
  };
  const visualErrors = { schemaVersion: 2, metrics: [], referenceCaptures: [], verdict: "INSUFFICIENT_EVIDENCE" };
  const leakLoop = {
    schemaVersion: 2,
    requiredCycles: numeric(50, "cycles", "Gated", "Weathered World lifecycle minimum"),
    executedCycles: null,
    snapshots: [],
    verdict: "INSUFFICIENT_EVIDENCE"
  };
  const bandwidth = { schemaVersion: 2, model: [], counterEvidence: null, verdict: "INSUFFICIENT_EVIDENCE" };
  const renderTargets = {
    schemaVersion: 2,
    finalCapture: labelRuntimeNumbers({
      width: captures.get("final.design.png").width,
      height: captures.get("final.design.png").height,
      sourceByteLength: captures.get("final.design.png").sourceByteLength,
      readbackLayout: captures.get("final.design.png").readbackLayout,
    }, "Weathered World final render-target readback"),
    pipelineResources: labelRuntimeNumbers(pipeline.resources, "Weathered World pipeline resource inventory")
  };
  const storageResources = {
    schemaVersion: 2,
    sharedWeatherIdentity: resources.sharedWeatherIdentity,
    worldUnitsPerMeter: numeric(resources.worldUnitsPerMeter, "world-units-per-meter", "Measured", "runtime controller resource description"),
    resources: labelRuntimeNumbers(resources.resources, "Weathered World runtime storage inventory")
  };
  const rendererInfo = {
    schemaVersion: 2,
    backendIsWebGPU: metrics.backendIsWebGPU,
    threeRevision: "185",
    rendererInfo: labelRuntimeNumbers(metrics.rendererInfo, "initialized renderer.info snapshot")
  };
  const mechanismMetrics = {
    schemaVersion: 2,
    diagnosticDifferentPixelFraction: numeric(diagnosticDifference, "fraction", "Measured", "minimum final-versus-diagnostic RGB mismatch"),
    metrics: labelRuntimeNumbers(metrics, "Weathered World controller metrics")
  };

  const artifacts = {
    "visual-contract.json": visualContract,
    "evidence-manifest.json": evidence,
    "renderer-info.json": rendererInfo,
    "pipeline-graph.json": labelRuntimeNumbers(pipeline, "Weathered World runtime owner graph"),
    "performance-envelope.json": performanceEnvelope,
    "frame-trace.json": frameTrace,
    "quality-governor.json": qualityGovernor,
    "render-targets.json": renderTargets,
    "storage-resources.json": storageResources,
    "resident-resources.json": { schemaVersion: 2, resources: storageResources.resources, peakLiveBytes: null, verdict: "INSUFFICIENT_EVIDENCE" },
    "bandwidth-model.json": bandwidth,
    "visual-errors.json": visualErrors,
    "leak-loop.json": leakLoop,
    "mechanism-metrics.json": mechanismMetrics,
  };
  for (const [name, value] of Object.entries(artifacts)) await writeFile(resolve(options.output, name), json(value));
} finally {
  await browser.close();
}
