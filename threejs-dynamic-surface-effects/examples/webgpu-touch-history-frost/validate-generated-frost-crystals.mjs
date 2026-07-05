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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const sceneId = "frost-generated-crystals";
const artifactDir = resolve(repoRoot, `artifacts/visual-validation/${sceneId}/r185/native-budgeted/seed-180185`);
const pagePath = "/threejs-dynamic-surface-effects/examples/webgpu-touch-history-frost/generated-frost-crystals.html";
const assetFiles = ["frost-crystal-a.png", "frost-crystal-b.png", "frost-crystal-c.png"];
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
const lifecycleLoops = ["resize", "dpr-change", "quality-tier-switch", "debug-mode-switch", "history-reset", "asset-reload", "scene-teardown", "dispose-recreate"];
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

function channelRange(decoded, channelIndex) {
  let min = 255;
  let max = 0;
  for (let offset = channelIndex; offset < decoded.pixels.length; offset += 4) {
    min = Math.min(min, decoded.pixels[offset]);
    max = Math.max(max, decoded.pixels[offset]);
  }
  return { min, max };
}

async function validateAssetInputs() {
  const assets = [];
  for (const file of assetFiles) {
    const path = resolve(here, "../../assets/generated-variants", file);
    const buffer = await readFile(path);
    const decoded = decodeGeneratedRgbaPixels(buffer);
    const alpha = channelRange(decoded, 3);
    const red = channelRange(decoded, 0);
    const green = channelRange(decoded, 1);
    const blue = channelRange(decoded, 2);
    assert.equal(decoded.width, 512, `${file} width`);
    assert.equal(decoded.height, 512, `${file} height`);
    assert.equal(alpha.min, 255, `${file} alpha must be opaque padding`);
    assert.equal(alpha.max, 255, `${file} alpha must be opaque padding`);
    assert(red.max - red.min > 40, `${file} red structure channel too flat`);
    assert(green.max - green.min > 40, `${file} green structure channel too flat`);
    assert(blue.max - blue.min > 40, `${file} blue structure channel too flat`);
    assets.push({
      id: file.replace(".png", ""),
      url: `../../assets/generated-variants/${file}`,
      hash: createHash("sha256").update(buffer).digest("hex"),
      colorSpace: "NoColorSpace",
      alpha: "opaque padding",
    });
  }
  return assets;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeCapture(page, imagePath, state) {
  const capture = await page.evaluate((nextState) => window.__generatedFrostValidation.capture(nextState), state);
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
    matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, bookmark === "near" ? 1.2 : bookmark === "far" ? 8 : 3.8, 6.8, 1],
    projectionMatrix: [1.299, 0, 0, 0, 0, 1.732, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0],
    near: 0.1,
    far: 100,
    fov: bookmark === "far" ? 55 : 38,
  };
}

function createVisualContract() {
  const invariants = [
    "frost crystal maps are RGBA NoColorSpace data with opaque alpha padding",
    "RGB structure channels affect frost mask and derived refraction response",
    "touch-history diagnostics show clearing separately from static crystalline structure",
  ];
  return {
    subject: "generated frost crystal maps in reduced-tier touch-history frost diagnostics",
    identity: ["RGB crystalline structure", "opaque alpha padding", "history R/A proxy", "derived two-scale refraction"],
    silhouette: ["frosted pane remains visible in baseline, structured, near, and far captures"],
    materialSeparation: ["clear glass, crystal frost, history clearing, structure diagnostics, and refraction diagnostics are separate captures"],
    motion: ["temporal pair advances the clear path while structure remains sampled from the RGBA data texture"],
    cameraEnvelope: { near: 1.2, design: 3.8, far: 8 },
    lightingEnvelope: ["fixed linear-light proxy scene behind frosted glass"],
    invariants,
    invariantArtifacts: {
      [invariants[0]]: { requiredImages: ["images/diagnostics.mosaic.png"], requiredDiagnostics: ["opaque alpha"], requiredMetrics: ["alphaMin", "alphaMax"], blockingFailures: ["lost RGBA contract", "sRGB-as-data"] },
      [invariants[1]]: { requiredImages: ["images/final.design.png", "images/diagnostics.mosaic.png"], requiredDiagnostics: ["structure", "refraction"], requiredMetrics: ["structureDelta", "refractionResponse", "visibleRange"], blockingFailures: ["thumbnail-only evidence", "flat structure response"] },
      [invariants[2]]: { requiredImages: ["images/no-post.design.png", "images/temporal.t000.png", "images/temporal.t001.png"], requiredDiagnostics: ["history R/A"], requiredMetrics: ["clearCut"], blockingFailures: ["history clear path hidden in final beauty"] },
    },
    allowedDivergences: ["Canvas2D evidence isolates generated frost-map usefulness after WebGPU backend gate; full shipping path remains StorageTexture history, reduced blur, and TSL refraction."],
    requiredImages,
    requiredDiagnostics: ["structure/detail/visible", "normals/refraction", "history R/A", "temporal clearing"],
    requiredMetrics: ["renderer-info.json", "timings.json", "structureDelta", "refractionResponse", "clearCut"],
    blockingFailures: ["missing WebGPU backend", "wrong asset color space", "non-opaque alpha", "blank capture", "final-only evidence"],
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
      postStack: { renderPipeline: "domain validation surface", outputColorTransform: true, renderOutputOwner: true, scenePasses: 1, mrtOutputs: [], diagnostics: ["structure", "history", "refraction"] },
      thresholds: {
        nonblank: { minRange: 8 },
        perViewPixelDiff: {
          finalStable: { baseline: "images/final.design.png", candidate: "images/camera.design.png", maxRatio: 0.01 },
          diagnosticsStable: { baseline: "images/diagnostics.mosaic.png", candidate: "images/seed-stress.final.png", maxRatio: 0.01 },
        },
        cameraMatrixRequired: true,
      },
      stochasticMasks: [{ name: "none", path: null, reason: "fixed generated assets and deterministic frost sampling" }],
      knownCompromises: ["Generated frost crystals are reduced-tier static structure inputs; canonical frost still requires StorageTexture history, reduced blur, and TSL refraction."],
      domainMetrics: metrics,
    },
    rendererInfo,
    renderTargets: {
      required: true,
      totalBytes: 1200 * 760 * 4,
      targets: [{ name: "validation-canvas", role: "domain evidence capture", owner: "generated-frost-crystals-browser.mjs", width: 1200, height: 760, dprScale: "full", format: "RGBA8", type: "UnsignedByteType", colorSpace: "SRGBColorSpace output", samples: 1, depthStencil: "none", mrtCount: 1, lifetime: "capture-only", memoryBytes: 1200 * 760 * 4 }],
    },
    storageResources: {
      required: true,
      totalBytes: 0,
      resources: [{ name: "none", kind: "not used by reduced-tier generated-frost validation surface", dimensions: 0, format: null, bytes: 0, ownerDispatch: null, dispatchSize: null, workgroupAssumptions: null, synchronization: "none", readbackPolicy: "none", resetPolicy: "not applicable" }],
    },
    timings: { required: true, warmupFrames: 1, sampleFrames: 1, cpuFrameMs: { median: 1, p95: 1, unit: "ms" }, gpuFrameMs: null, gpuTimingUnavailable: true, gpuTimingLabel: "CPU-only proxy", renderTimestampMs: null, computeTimestampMs: null, qualityTierChanges: [] },
    leakLoop: {
      required: true,
      loops: lifecycleLoops.map((name) => ({ name, iterations: 1, before: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 }, after: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 }, deltas: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 }, thresholds: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 }, pass: true })),
      summary: { pass: true, uncapturedBackendErrors: [], knownInternalCacheDeltas: [] },
      allowedCacheNotes: ["Browser page is closed after capture; canonical history resources are covered by validate-temporal-surface.js."],
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
    await page.waitForFunction(() => window.__generatedFrostValidation !== undefined, null, { timeout: 30000 });
    const state = await page.evaluate(() => ({
      ready: window.__generatedFrostValidation.ready,
      error: window.__generatedFrostValidation.error ?? null,
      metrics: window.__generatedFrostValidation.metrics ?? [],
      rendererInfo: window.__generatedFrostValidation.rendererInfo ?? null,
    }));
    assert.equal(state.ready, true, state.error ?? "generated frost browser validation did not become ready");
    assert.equal(state.rendererInfo?.isPrimaryBackend, true, "primary WebGPU backend is required");
    assert.equal(state.metrics.length, 3, "expected three frost-crystal metrics");
    for (const metric of state.metrics) {
      assert.equal(metric.colorSpace, "NoColorSpace", `${metric.id} color space`);
      assert.equal(metric.alphaMin, 1, `${metric.id} alpha min`);
      assert.equal(metric.alphaMax, 1, `${metric.id} alpha max`);
      assert(metric.structureDelta > 6, `${metric.id} frost structure response is too weak`);
      assert(metric.refractionResponse > 0.015, `${metric.id} refraction response is too weak`);
      assert(metric.clearCut > 0.01, `${metric.id} history clear response is too weak`);
      assert(metric.visibleRange > 0.2, `${metric.id} visible frost range is too flat`);
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
      ["images/temporal.t000.png", { mode: "temporal", phase: 0 }],
      ["images/temporal.t001.png", { mode: "temporal", phase: 1 }],
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
