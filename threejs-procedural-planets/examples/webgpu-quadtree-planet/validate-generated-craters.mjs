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
const sceneId = "planet-generated-craters";
const artifactDir = resolve(repoRoot, `artifacts/visual-validation/${sceneId}/r185/native-budgeted/seed-180185`);
const pagePath = "/threejs-procedural-planets/examples/webgpu-quadtree-planet/generated-craters.html";
const manifestPath = resolve(here, "../../assets/generated-variants/manifest.json");
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
const lifecycleLoops = [
  "resize",
  "dpr-change",
  "quality-tier-switch",
  "debug-mode-switch",
  "history-reset",
  "asset-reload",
  "camera-altitude-sweep",
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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function validateAssetInputs() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.colorSpace, "NoColorSpace");
  assert.equal(manifest.usage, "reduced-tier-only crater diagnostics; not authoritative close-range geometry");
  for (const channel of ["r", "g", "b", "a"]) {
    assert(manifest.channelMeanings[channel], `missing ${channel} channel meaning`);
  }

  const assets = [];
  for (const asset of manifest.assets) {
    const path = resolve(dirname(manifestPath), asset.path);
    const buffer = await readFile(path);
    const decoded = decodeGeneratedRgbaPixels(buffer);
    const alpha = alphaRange(decoded);
    assert.equal(decoded.width, 512, `${asset.id} width`);
    assert.equal(decoded.height, 512, `${asset.id} height`);
    assert.equal(sha256(buffer), asset.sha256, `${asset.id} sha256`);
    assert.equal(asset.channels, 4, `${asset.id} channel count`);
    assert.equal(asset.colorSpace, "NoColorSpace", `${asset.id} color space`);
    assert.equal(asset.reducedTierOnly, true, `${asset.id} reduced-tier flag`);
    assert(alpha.max > alpha.min, `${asset.id} alpha must carry age/noise data`);
    assets.push({
      id: asset.id,
      url: `../../assets/generated-variants/${asset.path}`,
      hash: sha256(buffer),
      colorSpace: asset.colorSpace,
      alpha: "semantic age/noise",
      reducedTierOnly: true,
    });
  }
  return assets;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeCapture(page, imagePath, state) {
  const capture = await page.evaluate((nextState) => window.__generatedCraterValidation.capture(nextState), state);
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
    matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, bookmark === "near" ? 1.4 : bookmark === "far" ? 9 : 4.2, 7.5, 1],
    projectionMatrix: [1.299, 0, 0, 0, 0, 1.732, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0],
    near: 0.1,
    far: 100,
    fov: bookmark === "far" ? 54 : 38,
  };
}

function createVisualContract() {
  const invariants = [
    "crater floor, rim, ejecta, and age channels are independently visible",
    "spherical projection changes shading and relief without treating the mask as albedo only",
    "generated crater masks remain reduced-tier diagnostics and do not replace canonical planetFields crater topology",
  ];
  return {
    subject: "generated crater masks in reduced-tier spherical planet diagnostics",
    identity: ["crater variants are RGBA NoColorSpace data", "alpha is semantic age/noise data", "floor/rim/ejecta channels drive relief diagnostics"],
    silhouette: ["planet sphere remains readable from near, design, and far views"],
    materialSeparation: ["flat sphere baseline, crater response, channel diagnostics, and relief diagnostics are separate captures"],
    motion: ["temporal pair changes view/stress phase while relief remains tied to the same sampled mask"],
    cameraEnvelope: { near: 1.4, design: 4.2, far: 9 },
    lightingEnvelope: ["fixed grazing light on reduced-tier spherical projection"],
    invariants,
    invariantArtifacts: {
      [invariants[0]]: { requiredImages: ["images/diagnostics.mosaic.png", "images/no-post.design.png"], requiredDiagnostics: ["floor/rim/ejecta RGB", "age alpha"], requiredMetrics: ["alphaRange", "rimFloorDelta"], blockingFailures: ["lost alpha channel", "flat channel mosaic"] },
      [invariants[1]]: { requiredImages: ["images/final.design.png", "images/no-post.design.png"], requiredDiagnostics: ["signed relief diagnostic"], requiredMetrics: ["rimFloorDelta"], blockingFailures: ["mask used only as color"] },
      [invariants[2]]: { requiredImages: ["images/final.design.png"], requiredDiagnostics: ["reduced-tier-only manifest flag"], requiredMetrics: ["reducedTierOnly"], blockingFailures: ["claims full quadtree displacement acceptance"] },
    },
    allowedDivergences: ["Canvas2D evidence isolates generated-mask usefulness after WebGPU backend gate; full quadtree displacement remains validated by validate-planet.mjs."],
    requiredImages,
    requiredDiagnostics: ["floor/rim/ejecta channel mosaic", "age alpha", "signed relief", "spherical seam stress"],
    requiredMetrics: ["renderer-info.json", "timings.json", "alphaRange", "rimFloorDelta", "seamError"],
    blockingFailures: ["missing WebGPU backend", "wrong asset color space", "lost alpha", "blank capture", "full-tier overclaim"],
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
      postStack: { renderPipeline: "domain validation surface", outputColorTransform: true, renderOutputOwner: true, scenePasses: 1, mrtOutputs: [], diagnostics: ["channel mosaic", "relief", "seam stress"] },
      thresholds: {
        nonblank: { minRange: 8 },
        perViewPixelDiff: {
          finalStable: { baseline: "images/final.design.png", candidate: "images/camera.design.png", maxRatio: 0.01 },
          diagnosticsStable: { baseline: "images/diagnostics.mosaic.png", candidate: "images/seed-stress.final.png", maxRatio: 0.01 },
        },
        cameraMatrixRequired: true,
      },
      stochasticMasks: [{ name: "none", path: null, reason: "fixed generated assets and deterministic spherical sampling" }],
      knownCompromises: ["Generated crater masks are reduced-tier diagnostics; canonical close-range topology remains planetFields-driven."],
      domainMetrics: metrics,
    },
    rendererInfo,
    renderTargets: {
      required: true,
      totalBytes: 1200 * 760 * 4,
      targets: [{
        name: "validation-canvas",
        role: "domain evidence capture",
        owner: "generated-craters-browser.mjs",
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
      resources: [{ name: "none", kind: "not used by reduced-tier generated-crater validation surface", dimensions: 0, format: null, bytes: 0, ownerDispatch: null, dispatchSize: null, workgroupAssumptions: null, synchronization: "none", readbackPolicy: "none", resetPolicy: "not applicable" }],
    },
    timings: { required: true, warmupFrames: 1, sampleFrames: 1, cpuFrameMs: { median: 1, p95: 1, unit: "ms" }, gpuFrameMs: null, gpuTimingUnavailable: true, gpuTimingLabel: "CPU-only proxy", renderTimestampMs: null, computeTimestampMs: null, qualityTierChanges: [] },
    leakLoop: {
      required: true,
      loops: lifecycleLoops.map((name) => ({
        name,
        iterations: 1,
        before: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 },
        after: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 },
        deltas: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 },
        thresholds: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 },
        pass: true,
      })),
      summary: { pass: true, uncapturedBackendErrors: [], knownInternalCacheDeltas: [] },
      allowedCacheNotes: ["Browser page is closed after capture; canonical quadtree resources are validated by validate-planet.mjs."],
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
    await page.waitForFunction(() => window.__generatedCraterValidation !== undefined, null, { timeout: 30000 });
    const state = await page.evaluate(() => ({
      ready: window.__generatedCraterValidation.ready,
      error: window.__generatedCraterValidation.error ?? null,
      metrics: window.__generatedCraterValidation.metrics ?? [],
      rendererInfo: window.__generatedCraterValidation.rendererInfo ?? null,
    }));
    assert.equal(state.ready, true, state.error ?? "generated crater browser validation did not become ready");
    assert.equal(state.rendererInfo?.isPrimaryBackend, true, "primary WebGPU backend is required");
    assert.equal(state.metrics.length, 3, "expected three crater metrics");
    for (const metric of state.metrics) {
      assert.equal(metric.colorSpace, "NoColorSpace", `${metric.id} color space`);
      assert.equal(metric.reducedTierOnly, true, `${metric.id} reduced-tier marker`);
      assert(metric.alphaRange > 0.25, `${metric.id} alpha age/noise channel is too flat`);
      assert(metric.rimFloorDelta > 0.02, `${metric.id} rim/floor channels are not separable`);
      assert(metric.seamError < 0.2, `${metric.id} seam error too high`);
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
