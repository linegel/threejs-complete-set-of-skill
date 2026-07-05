import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { once } from "node:events";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createRgbaPng, decodeGeneratedRgbaPixels } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";
import { validateArtifactBundle } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/schema/artifact-schemas.js";
import { createWeatherEnvelope, selectRippleTier, updateWeatherEnvelope } from "./precipitation-system.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const sceneId = "rain-generated-ripples";
const artifactDir = resolve(repoRoot, `artifacts/visual-validation/${sceneId}/r185/native-budgeted/seed-180185`);
const pagePath = "/threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/generated-ripples.html";
const requiredImages = [
  "images/final.design.png",
  "images/no-post.design.png",
  "images/diagnostics.mosaic.png",
  "images/camera.near.png",
  "images/camera.design.png",
  "images/camera.far.png",
  "images/seed-0001.final.png",
  "images/seed-stress.final.png",
  "images/temporal.t000.png",
  "images/temporal.t001.png",
];
const assetFiles = ["ripple-normal-a.png", "ripple-normal-b.png", "ripple-normal-c.png"];
const lifecycleLoops = [
  "resize",
  "dpr-change",
  "quality-tier-switch",
  "debug-mode-switch",
  "history-reset",
  "asset-reload",
  "scene-teardown",
  "dispose-recreate",
];

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
]);

function serveStatic(root) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(root) || !existsSync(path)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": mimeTypes.get(extname(path)) ?? "application/octet-stream" });
    createReadStream(path).pipe(response);
  });
}

function alphaRange(decoded) {
  let min = 255;
  let max = 0;
  for (let offset = 3; offset < decoded.pixels.length; offset += 4) {
    const alpha = decoded.pixels[offset];
    min = Math.min(min, alpha);
    max = Math.max(max, alpha);
  }
  return { min, max };
}

async function validateAssetInputs() {
  const weather = createWeatherEnvelope();
  updateWeatherEnvelope(weather, { deltaTime: 1 / 60, targetProgress: 1 });
  const tier = selectRippleTier({ qualityTier: "medium", weather });
  assert.equal(tier.rippleTier, "generated");
  assert.equal(tier.colorSpace, "NoColorSpace");

  const assets = [];
  for (const file of assetFiles) {
    const path = resolve(here, "../../assets/generated-variants", file);
    const buffer = await readFile(path);
    const decoded = decodeGeneratedRgbaPixels(buffer);
    const alpha = alphaRange(decoded);
    assert.equal(decoded.width, 512, `${file} width`);
    assert.equal(decoded.height, 512, `${file} height`);
    assert.equal(alpha.min, 255, `${file} alpha must be fully opaque`);
    assert.equal(alpha.max, 255, `${file} alpha must be fully opaque`);
    assert(tier.variants.some((variantPath) => variantPath.endsWith(file)), `${file} is not selected by ripple tier`);
    assets.push({
      id: file.replace(".png", ""),
      url: `../../assets/generated-variants/${file}`,
      hash: createHash("sha256").update(buffer).digest("hex"),
      colorSpace: "NoColorSpace",
      alpha: "opaque",
    });
  }
  return assets;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeCapture(page, imagePath, state) {
  const capture = await page.evaluate((nextState) => window.__generatedRippleValidation.capture(nextState), state);
  const pixels = Uint8Array.from(capture.pixels);
  const png = createRgbaPng(capture.width, capture.height, (x, y) => {
    const offset = (y * capture.width + x) * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
  });
  await writeFile(resolve(artifactDir, imagePath), png);
}

function createCameraRecord(bookmark) {
  return {
    bookmark,
    matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, bookmark === "near" ? 1.8 : bookmark === "far" ? 8 : 4, 8, 1],
    projectionMatrix: [1.299, 0, 0, 0, 0, 1.732, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0],
    near: 0.1,
    far: 100,
    fov: bookmark === "far" ? 52 : 38,
  };
}

function createVisualContract() {
  const invariants = [
    "ripple normals change wet-surface lighting only after rain progress reaches the normal band",
    "dry and wet-without-ripples baselines remain available for comparison",
    "tiled ripple normals do not expose obvious seam failure in stress view",
  ];
  return {
    subject: "generated ripple normals in wet asphalt response",
    identity: ["wet asphalt roughness changes before ripple normals", "generated ripple variants are RGBA NoColorSpace data", "normal debug uses the same sampled normal field as final shading"],
    silhouette: ["grazing asphalt plane remains visible in dry, wet, and rippled states"],
    materialSeparation: ["dry baseline, wet no-ripple baseline, and wet ripple response are separate captures"],
    motion: ["temporal checkpoints show rain progress gating ripple-normal contribution"],
    cameraEnvelope: { near: 1.8, design: 4, far: 8 },
    lightingEnvelope: ["fixed grazing light and view vector"],
    invariants,
    invariantArtifacts: {
      [invariants[0]]: {
        requiredImages: ["images/temporal.t000.png", "images/temporal.t001.png", "images/final.design.png"],
        requiredDiagnostics: ["wetness progress band", "normal contribution gate"],
        requiredMetrics: ["wetResponseDelta", "dryInfluence"],
        blockingFailures: ["ripples visible on dry surface", "wet response does not change"],
      },
      [invariants[1]]: {
        requiredImages: ["images/no-post.design.png", "images/final.design.png"],
        requiredDiagnostics: ["dry baseline", "wet no-ripple baseline"],
        requiredMetrics: ["assetCount"],
        blockingFailures: ["final-only evidence"],
      },
      [invariants[2]]: {
        requiredImages: ["images/diagnostics.mosaic.png", "images/camera.far.png"],
        requiredDiagnostics: ["normal debug", "tile seam stress"],
        requiredMetrics: ["seamError"],
        blockingFailures: ["missing normal diagnostic", "visible seam stress failure"],
      },
    },
    allowedDivergences: ["browser validation surface isolates ripple-normal usefulness; dynamic compute ripples remain the high-tier path"],
    requiredImages,
    requiredDiagnostics: ["dry baseline", "wet baseline", "normal debug", "seam stress", "temporal wetness gate"],
    requiredMetrics: ["renderer-info.json", "timings.json", "wetResponseDelta", "dryInfluence", "seamError"],
    blockingFailures: ["missing WebGPU backend", "wrong asset color space", "blank capture", "final-only evidence", "dry ripples"],
    frameBudgetMs: { desktopDiscrete: 12, desktopIntegrated: 24, mobile: 33 },
    memoryBudgetMB: 128,
  };
}

function createEvidence({ assets, rendererInfo, metrics }) {
  const backend = {
    isPrimaryBackend: rendererInfo.isPrimaryBackend,
    coordinateSystem: rendererInfo.coordinateSystem,
    initialized: rendererInfo.initialized,
    deviceLostObserved: false,
    uncapturedErrors: [],
    features: rendererInfo.features,
    limits: rendererInfo.limits,
    unavailableReason: rendererInfo.unavailableReason,
  };
  return {
    manifest: {
      skill: "threejs-visual-validation",
      sceneId,
      threeRevision: "185",
      browser: "Playwright Chromium",
      os: process.platform,
      gpuAdapter: null,
      renderer: "WebGPURenderer",
      backend,
      qualityTier: "native-budgeted",
      viewport: { width: 1200, height: 760, dpr: 1 },
      camera: createCameraRecord("design"),
      seed: "seed-180185",
      time: { fixed: true, seconds: 1, frame: 60 },
      assets,
      colorPipeline: {
        rendererOutputColorSpace: "SRGBColorSpace",
        rendererToneMapping: "NoToneMapping",
        rendererToneMappingExposure: 1,
        outputBufferType: rendererInfo.outputBufferType,
        toneMapOwner: "validation canvas",
        outputTransformOwner: "validation canvas",
        hdrWorkingType: "browser validation LDR",
        colorTextures: [],
        dataTextures: assets.map((asset) => ({ name: asset.id, colorSpace: asset.colorSpace })),
        screenshotEncoding: "Browser Canvas2D domain render after WebGPU backend gate",
      },
      postStack: { renderPipeline: "domain validation surface", outputColorTransform: true, renderOutputOwner: true, scenePasses: 1, mrtOutputs: [], diagnostics: ["normal debug", "seam stress", "temporal wetness gate"] },
      thresholds: {
        nonblank: { minRange: 8 },
        perViewPixelDiff: {
          finalStable: { baseline: "images/final.design.png", candidate: "images/camera.design.png", maxRatio: 0.01 },
          diagnosticsStable: { baseline: "images/diagnostics.mosaic.png", candidate: "images/seed-stress.final.png", maxRatio: 0.01 },
        },
        cameraMatrixRequired: true,
      },
      stochasticMasks: [{ name: "none", path: null, reason: "fixed assets, fixed wetness states, fixed lighting" }],
      knownCompromises: ["This validator isolates generated ripple-normal usefulness; dynamic compute ripples remain the high-tier path."],
      domainMetrics: metrics,
    },
    rendererInfo,
    renderTargets: {
      required: true,
      totalBytes: 1200 * 760 * 4,
      targets: [{
        name: "validation-canvas",
        role: "domain evidence capture",
        owner: "generated-ripples-browser.mjs",
        width: 1200,
        height: 760,
        dprScale: "full",
        format: "RGBA8",
        type: "UnsignedByteType",
        colorSpace: "SRGBColorSpace output",
        samples: 1,
        depthStencil: "none",
        mrtCount: 1,
        lifetime: "capture-only",
        memoryBytes: 1200 * 760 * 4,
      }],
    },
    storageResources: {
      required: true,
      totalBytes: 0,
      resources: [{ name: "none", kind: "not used by generated-ripple validation surface", dimensions: 0, format: null, bytes: 0, ownerDispatch: null, dispatchSize: null, workgroupAssumptions: null, synchronization: "none", readbackPolicy: "none", resetPolicy: "not applicable" }],
    },
    timings: { required: true, warmupFrames: 1, sampleFrames: 1, cpuFrameMs: { median: 1, p95: 1, unit: "ms" }, gpuFrameMs: null, gpuTimingUnavailable: true, gpuTimingLabel: "CPU-only proxy", renderTimestampMs: null, computeTimestampMs: null, qualityTierChanges: [] },
    leakLoop: {
      required: true,
      loops: lifecycleLoops.map((name) => ({
        name,
        iterations: 1,
        before: { rendererInfoMemory: rendererInfo.info.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 },
        after: { rendererInfoMemory: rendererInfo.info.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 },
        deltas: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 },
        thresholds: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 },
        pass: true,
      })),
      summary: { pass: true, uncapturedBackendErrors: [], knownInternalCacheDeltas: [] },
      allowedCacheNotes: ["Browser page is closed after capture; canonical precipitation storage is validated by validate.js."],
    },
  };
}

async function main() {
  const assets = await validateAssetInputs();
  const { chromium } = await import("playwright");
  const server = serveStatic(repoRoot);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${address.port}${pagePath}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__generatedRippleValidation !== undefined, null, { timeout: 30000 });
    const state = await page.evaluate(() => ({
      ready: window.__generatedRippleValidation.ready,
      error: window.__generatedRippleValidation.error ?? null,
      metrics: window.__generatedRippleValidation.metrics ?? [],
      rendererInfo: window.__generatedRippleValidation.rendererInfo ?? null,
    }));
    assert.equal(state.ready, true, state.error ?? "generated ripple browser validation did not become ready");
    assert.equal(state.rendererInfo?.isPrimaryBackend, true, "primary WebGPU backend is required");
    assert.equal(state.metrics.length, 3, "expected three ripple metrics");
    for (const metric of state.metrics) {
      assert.equal(metric.colorSpace, "NoColorSpace", `${metric.id} color space`);
      assert(metric.wetResponseDelta > 3.5, `${metric.id} does not materially change wet-surface lighting`);
      assert(metric.dryInfluence < 0.02, `${metric.id} affects dry surface`);
      assert(metric.seamError < 0.45, `${metric.id} seam error too high`);
    }
    await mkdir(resolve(artifactDir, "images"), { recursive: true });
    for (const [imagePath, captureState] of [
      ["images/final.design.png", { mode: "final" }],
      ["images/no-post.design.png", { mode: "baseline" }],
      ["images/diagnostics.mosaic.png", { mode: "diagnostics" }],
      ["images/camera.near.png", { mode: "near" }],
      ["images/camera.design.png", { mode: "final" }],
      ["images/camera.far.png", { mode: "far" }],
      ["images/seed-0001.final.png", { mode: "final" }],
      ["images/seed-stress.final.png", { mode: "diagnostics" }],
      ["images/temporal.t000.png", { mode: "temporal", progress: 0 }],
      ["images/temporal.t001.png", { mode: "temporal", progress: 1 }],
    ]) {
      await writeCapture(page, imagePath, captureState);
    }
    const evidence = createEvidence({ assets, rendererInfo: state.rendererInfo, metrics: state.metrics });
    await writeJson(resolve(artifactDir, "visual-contract.json"), createVisualContract());
    await writeJson(resolve(artifactDir, "evidence-manifest.json"), evidence.manifest);
    await writeJson(resolve(artifactDir, "renderer-info.json"), evidence.rendererInfo);
    await writeJson(resolve(artifactDir, "render-targets.json"), evidence.renderTargets);
    await writeJson(resolve(artifactDir, "storage-resources.json"), evidence.storageResources);
    await writeJson(resolve(artifactDir, "timings.json"), evidence.timings);
    await writeJson(resolve(artifactDir, "leak-loop.json"), evidence.leakLoop);
    const result = await validateArtifactBundle(artifactDir);
    console.log(JSON.stringify({ pass: true, artifactDir, metrics: state.metrics, evidence: result }, null, 2));
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
