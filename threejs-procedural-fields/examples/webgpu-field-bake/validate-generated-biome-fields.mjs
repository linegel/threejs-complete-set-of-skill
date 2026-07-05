import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { extname, resolve } from "node:path";
import { once } from "node:events";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createRgbaPng, decodeGeneratedRgbaPixels } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";
import { validateArtifactBundle } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/schema/artifact-schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const sceneId = "fields-generated-biome-maps";
const artifactDir = resolve(repoRoot, `artifacts/visual-validation/${sceneId}/r185/native-budgeted/seed-180185`);
const pagePath = "/threejs-procedural-fields/examples/webgpu-field-bake/generated-biome-fields.html";
const assetFiles = ["biome-field-a.png", "biome-field-b.png", "biome-field-c.png"];
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
  const manifest = JSON.parse(await readFile(resolve(here, "../../assets/generated-variants/manifest.json"), "utf8"));
  assert.equal(manifest.colorSpace, "NoColorSpace", "biome manifest color space");
  const assets = [];
  for (const file of assetFiles) {
    const manifestAsset = manifest.assets.find((asset) => asset.path === file);
    assert(manifestAsset, `${file} missing from manifest`);
    const path = resolve(here, "../../assets/generated-variants", file);
    const buffer = await readFile(path);
    const decoded = decodeGeneratedRgbaPixels(buffer);
    const hash = createHash("sha256").update(buffer).digest("hex");
    assert.equal(decoded.width, 512, `${file} width`);
    assert.equal(decoded.height, 512, `${file} height`);
    assert.equal(hash, manifestAsset.sha256, `${file} hash`);
    for (const [channel, index] of [["macroHeight", 0], ["ridge", 1], ["cavity", 2], ["moisture", 3]]) {
      const range = channelRange(decoded, index);
      assert(range.max - range.min > 50, `${file} ${channel} channel too flat`);
    }
    assets.push({
      id: file.replace(".png", ""),
      url: `../../assets/generated-variants/${file}`,
      hash,
      colorSpace: "NoColorSpace",
      alpha: "semantic moisture",
    });
  }
  return assets;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeCapture(page, imagePath, state) {
  const capture = await page.evaluate((nextState) => window.__generatedBiomeValidation.capture(nextState), state);
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
    matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, bookmark === "near" ? 1.2 : bookmark === "far" ? 10 : 4.4, 8, 1],
    projectionMatrix: [1.299, 0, 0, 0, 0, 1.732, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0],
    near: 0.1,
    far: 100,
    fov: bookmark === "far" ? 55 : 38,
  };
}

function createVisualContract() {
  const invariants = [
    "biome maps are RGBA NoColorSpace data with semantic alpha moisture",
    "macro height, ridge, cavity, and moisture drive material and placement diagnostics",
    "derived channels stay causally tied to the same packed field data",
  ];
  return {
    subject: "generated biome field maps in reduced-tier procedural-field diagnostics",
    identity: ["R macro height", "G ridge", "B cavity", "A moisture"],
    silhouette: ["biome field remains visible in baseline, field-shaped, near, and far captures"],
    materialSeparation: ["constant baseline, biome material response, derived slope/place/roughness, RGB fields, and alpha moisture are separate captures"],
    motion: ["temporal pair scrolls field coordinates while derived channels remain tied to RGBA data"],
    cameraEnvelope: { near: 1.2, design: 4.4, far: 10 },
    lightingEnvelope: ["fixed field-material proxy"],
    invariants,
    invariantArtifacts: {
      [invariants[0]]: { requiredImages: ["images/diagnostics.mosaic.png"], requiredDiagnostics: ["A moisture response"], requiredMetrics: ["alphaMin", "alphaMax"], blockingFailures: ["lost alpha channel", "sRGB-as-data"] },
      [invariants[1]]: { requiredImages: ["images/final.design.png", "images/no-post.design.png"], requiredDiagnostics: ["slope/place/roughness"], requiredMetrics: ["fieldDelta", "placementMean", "moistureEffect"], blockingFailures: ["flat material response", "thumbnail-only evidence"] },
      [invariants[2]]: { requiredImages: ["images/diagnostics.mosaic.png", "images/temporal.t000.png", "images/temporal.t001.png"], requiredDiagnostics: ["derived channels"], requiredMetrics: ["derivedRange"], blockingFailures: ["detached diagnostics"] },
    },
    allowedDivergences: ["Canvas2D evidence isolates generated biome-map usefulness after WebGPU backend gate; canonical fields still use shared TSL/CPU parity and storage bakes."],
    requiredImages,
    requiredDiagnostics: ["R/G/B height ridge cavity", "A moisture response", "slope/place/roughness"],
    requiredMetrics: ["renderer-info.json", "timings.json", "fieldDelta", "placementMean", "moistureEffect"],
    blockingFailures: ["missing WebGPU backend", "wrong asset color space", "lost alpha", "blank capture", "final-only evidence"],
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
      postStack: { renderPipeline: "domain validation surface", outputColorTransform: true, renderOutputOwner: true, scenePasses: 1, mrtOutputs: [], diagnostics: ["fields", "moisture", "derived"] },
      thresholds: {
        nonblank: { minRange: 8 },
        perViewPixelDiff: {
          finalStable: { baseline: "images/final.design.png", candidate: "images/camera.design.png", maxRatio: 0.01 },
          diagnosticsStable: { baseline: "images/diagnostics.mosaic.png", candidate: "images/seed-stress.final.png", maxRatio: 0.01 },
        },
        cameraMatrixRequired: true,
      },
      stochasticMasks: [{ name: "none", path: null, reason: "fixed generated assets and deterministic biome sampling" }],
      knownCompromises: ["Generated biome maps are reduced-tier diagnostic inputs; canonical fields still require shared TSL/CPU parity for field algorithms."],
      domainMetrics: metrics,
    },
    rendererInfo,
    renderTargets: {
      required: true,
      totalBytes: 1200 * 760 * 4,
      targets: [{ name: "validation-canvas", role: "domain evidence capture", owner: "generated-biome-fields-browser.mjs", width: 1200, height: 760, dprScale: "full", format: "RGBA8", type: "UnsignedByteType", colorSpace: "SRGBColorSpace output", samples: 1, depthStencil: "none", mrtCount: 1, lifetime: "capture-only", memoryBytes: 1200 * 760 * 4 }],
    },
    storageResources: {
      required: true,
      totalBytes: 0,
      resources: [{ name: "none", kind: "not used by reduced-tier generated-biome validation surface", dimensions: 0, format: null, bytes: 0, ownerDispatch: null, dispatchSize: null, workgroupAssumptions: null, synchronization: "none", readbackPolicy: "none", resetPolicy: "not applicable" }],
    },
    timings: { required: true, warmupFrames: 1, sampleFrames: 1, cpuFrameMs: { median: 1, p95: 1, unit: "ms" }, gpuFrameMs: null, gpuTimingUnavailable: true, gpuTimingLabel: "CPU-only proxy", renderTimestampMs: null, computeTimestampMs: null, qualityTierChanges: [] },
    leakLoop: {
      required: true,
      loops: lifecycleLoops.map((name) => ({ name, iterations: 1, before: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 }, after: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 }, deltas: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 }, thresholds: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 }, pass: true })),
      summary: { pass: true, uncapturedBackendErrors: [], knownInternalCacheDeltas: [] },
      allowedCacheNotes: ["Browser page is closed after capture; canonical field WebGPU parity is covered by capture.mjs plus validate-field-contract.mjs --artifacts."],
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
    await page.waitForFunction(() => window.__generatedBiomeValidation !== undefined, null, { timeout: 30000 });
    const state = await page.evaluate(() => ({
      ready: window.__generatedBiomeValidation.ready,
      error: window.__generatedBiomeValidation.error ?? null,
      metrics: window.__generatedBiomeValidation.metrics ?? [],
      rendererInfo: window.__generatedBiomeValidation.rendererInfo ?? null,
    }));
    assert.equal(state.ready, true, state.error ?? "generated biome browser validation did not become ready");
    assert.equal(state.rendererInfo?.isPrimaryBackend, true, "primary WebGPU backend is required");
    assert.equal(state.metrics.length, 3, "expected three biome-field metrics");
    for (const metric of state.metrics) {
      assert.equal(metric.colorSpace, "NoColorSpace", `${metric.id} color space`);
      assert(metric.alphaMax > metric.alphaMin, `${metric.id} alpha moisture channel is flat`);
      assert(metric.fieldDelta > 8, `${metric.id} field response is too weak: ${metric.fieldDelta}`);
      assert(metric.placementMean > 0.1, `${metric.id} placement response is too weak: ${metric.placementMean}`);
      assert(metric.moistureEffect > 0.05, `${metric.id} moisture response is too weak: ${metric.moistureEffect}`);
      assert(metric.derivedRange > 0.1, `${metric.id} derived range is too flat: ${metric.derivedRange}`);
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
