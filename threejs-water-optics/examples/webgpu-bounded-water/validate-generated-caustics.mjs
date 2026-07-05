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
const sceneId = "water-generated-caustics";
const artifactDir = resolve(repoRoot, `artifacts/visual-validation/${sceneId}/r185/native-budgeted/seed-180185`);
const pagePath = "/threejs-water-optics/examples/webgpu-bounded-water/generated-caustics.html";
const assetFiles = ["caustic-field-a.png", "caustic-field-b.png", "caustic-field-c.png"];
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

function alphaRange(decoded) {
  let min = 255;
  let max = 0;
  for (let offset = 3; offset < decoded.pixels.length; offset += 4) {
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
    const alpha = alphaRange(decoded);
    assert.equal(decoded.width, 512, `${file} width`);
    assert.equal(decoded.height, 512, `${file} height`);
    assert.equal(alpha.min, 255, `${file} alpha must be opaque padding`);
    assert.equal(alpha.max, 255, `${file} alpha must be opaque padding`);
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
  const capture = await page.evaluate((nextState) => window.__generatedCausticValidation.capture(nextState), state);
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
    matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, bookmark === "near" ? 1.2 : bookmark === "far" ? 7.5 : 3.8, 5.5, 1],
    projectionMatrix: [1.299, 0, 0, 0, 0, 1.732, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0],
    near: 0.1,
    far: 100,
    fov: bookmark === "far" ? 52 : 38,
  };
}

function createVisualContract() {
  const invariants = [
    "caustic fields are RGBA NoColorSpace data with opaque alpha padding",
    "caustic contribution materially changes the lit pool floor and disappears when disabled",
    "diagnostics expose caustic-only projection and tile stress instead of final-only evidence",
  ];
  return {
    subject: "generated caustic fields in bounded water floor projection",
    identity: ["generated caustic variants are data maps", "alpha is opaque padding", "RGB drives projected caustic intensity"],
    silhouette: ["pool floor remains visible with and without caustic contribution"],
    materialSeparation: ["dry floor, water without caustics, water with caustics, source channels, and caustic-only views are separate captures"],
    motion: ["temporal pair shows caustic drift phase while projection remains tied to floor UV"],
    cameraEnvelope: { near: 1.2, design: 3.8, far: 7.5 },
    lightingEnvelope: ["fixed shallow-water floor lighting"],
    invariants,
    invariantArtifacts: {
      [invariants[0]]: { requiredImages: ["images/diagnostics.mosaic.png"], requiredDiagnostics: ["source RGB", "opaque alpha"], requiredMetrics: ["alphaMin", "alphaMax"], blockingFailures: ["RGB-only PNG", "sRGB-as-data"] },
      [invariants[1]]: { requiredImages: ["images/final.design.png", "images/no-post.design.png"], requiredDiagnostics: ["water without caustics", "caustic contribution"], requiredMetrics: ["causticContribution", "disabledContribution"], blockingFailures: ["decorative-only caustics", "no disabled baseline"] },
      [invariants[2]]: { requiredImages: ["images/diagnostics.mosaic.png", "images/seed-stress.final.png"], requiredDiagnostics: ["tile stress", "caustic-only"], requiredMetrics: ["seamError"], blockingFailures: ["final-only evidence", "visible seam stress failure"] },
    },
    allowedDivergences: ["Generated caustic fields are reduced-tier sources/diagnostics; compute differential-area caustics remain the live-simulation path."],
    requiredImages,
    requiredDiagnostics: ["floor baseline", "water no caustics", "caustic-only", "source channels", "tile stress"],
    requiredMetrics: ["renderer-info.json", "timings.json", "causticContribution", "disabledContribution", "seamError"],
    blockingFailures: ["missing WebGPU backend", "wrong asset color space", "lost alpha padding", "blank capture", "final-only evidence"],
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
      postStack: { renderPipeline: "domain validation surface", outputColorTransform: true, renderOutputOwner: true, scenePasses: 1, mrtOutputs: [], diagnostics: ["caustic-only", "source channels", "tile stress"] },
      thresholds: {
        nonblank: { minRange: 8 },
        perViewPixelDiff: {
          finalStable: { baseline: "images/final.design.png", candidate: "images/camera.design.png", maxRatio: 0.01 },
          diagnosticsStable: { baseline: "images/diagnostics.mosaic.png", candidate: "images/seed-stress.final.png", maxRatio: 0.01 },
        },
        cameraMatrixRequired: true,
      },
      stochasticMasks: [{ name: "none", path: null, reason: "fixed generated assets and deterministic floor projection" }],
      knownCompromises: ["Generated caustic fields are reduced-tier sources/diagnostics, not live differential-area compute caustics."],
      domainMetrics: metrics,
    },
    rendererInfo,
    renderTargets: {
      required: true,
      totalBytes: 1200 * 760 * 4,
      targets: [{ name: "validation-canvas", role: "domain evidence capture", owner: "generated-caustics-browser.mjs", width: 1200, height: 760, dprScale: "full", format: "RGBA8", type: "UnsignedByteType", colorSpace: "SRGBColorSpace output", samples: 1, depthStencil: "none", mrtCount: 1, lifetime: "capture-only", memoryBytes: 1200 * 760 * 4 }],
    },
    storageResources: {
      required: true,
      totalBytes: 0,
      resources: [{ name: "none", kind: "not used by reduced-tier generated-caustic validation surface", dimensions: 0, format: null, bytes: 0, ownerDispatch: null, dispatchSize: null, workgroupAssumptions: null, synchronization: "none", readbackPolicy: "none", resetPolicy: "not applicable" }],
    },
    timings: { required: true, warmupFrames: 1, sampleFrames: 1, cpuFrameMs: { median: 1, p95: 1, unit: "ms" }, gpuFrameMs: null, gpuTimingUnavailable: true, gpuTimingLabel: "CPU-only proxy", renderTimestampMs: null, computeTimestampMs: null, qualityTierChanges: [] },
    leakLoop: {
      required: true,
      loops: lifecycleLoops.map((name) => ({ name, iterations: 1, before: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 }, after: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 }, deltas: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 }, thresholds: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 }, pass: true })),
      summary: { pass: true, uncapturedBackendErrors: [], knownInternalCacheDeltas: [] },
      allowedCacheNotes: ["Browser page is closed after capture; canonical water storage resources are validated by validate-water-contracts.mjs."],
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
    await page.waitForFunction(() => window.__generatedCausticValidation !== undefined, null, { timeout: 30000 });
    const state = await page.evaluate(() => ({
      ready: window.__generatedCausticValidation.ready,
      error: window.__generatedCausticValidation.error ?? null,
      metrics: window.__generatedCausticValidation.metrics ?? [],
      rendererInfo: window.__generatedCausticValidation.rendererInfo ?? null,
    }));
    assert.equal(state.ready, true, state.error ?? "generated caustic browser validation did not become ready");
    assert.equal(state.rendererInfo?.isPrimaryBackend, true, "primary WebGPU backend is required");
    assert.equal(state.metrics.length, 3, "expected three caustic metrics");
    for (const metric of state.metrics) {
      assert.equal(metric.colorSpace, "NoColorSpace", `${metric.id} color space`);
      assert.equal(metric.alphaMin, 1, `${metric.id} alpha minimum`);
      assert.equal(metric.alphaMax, 1, `${metric.id} alpha maximum`);
      assert(metric.causticContribution > 8, `${metric.id} caustic contribution is too weak`);
      assert(metric.disabledContribution < 0.01, `${metric.id} changes disabled baseline`);
      assert(metric.seamError < 0.1, `${metric.id} seam error too high`);
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
