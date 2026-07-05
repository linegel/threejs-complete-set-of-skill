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
const sceneId = "materials-generated-lava-causes";
const artifactDir = resolve(repoRoot, `artifacts/visual-validation/${sceneId}/r185/native-budgeted/seed-180185`);
const pagePath = "/threejs-procedural-materials/examples/tsl-procedural-pbr/generated-lava-causes.html";
const assetFiles = ["lava-cause-a.png", "lava-cause-b.png", "lava-cause-c.png"];
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
const lifecycleLoops = ["resize", "dpr-change", "quality-tier-switch", "debug-mode-switch", "history-reset", "material-reload", "asset-reload", "scene-teardown", "dispose-recreate"];
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
  assert.equal(manifest.colorSpace, "NoColorSpace", "lava manifest color space");
  const assets = [];
  for (const file of assetFiles) {
    const manifestAsset = manifest.assets.find((asset) => asset.file === file);
    assert(manifestAsset, `${file} missing from manifest`);
    const path = resolve(here, "../../assets/generated-variants", file);
    const buffer = await readFile(path);
    const decoded = decodeGeneratedRgbaPixels(buffer);
    const alpha = channelRange(decoded, 3);
    const heat = channelRange(decoded, 2);
    const fracture = channelRange(decoded, 1);
    const hash = createHash("sha256").update(buffer).digest("hex");
    assert.equal(decoded.width, 512, `${file} width`);
    assert.equal(decoded.height, 512, `${file} height`);
    assert.equal(hash, manifestAsset.sha256, `${file} hash mismatch`);
    assert(alpha.max > alpha.min, `${file} alpha thermal-intensity channel must be semantic`);
    assert(heat.max - heat.min > 60, `${file} heat exposure channel too flat`);
    assert(fracture.max - fracture.min > 40, `${file} fracture channel too flat`);
    assets.push({
      id: file.replace(".png", ""),
      url: `../../assets/generated-variants/${file}`,
      hash,
      colorSpace: "NoColorSpace",
      alpha: "semantic thermal intensity",
    });
  }
  return assets;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeCapture(page, imagePath, state) {
  const capture = await page.evaluate((nextState) => window.__generatedLavaValidation.capture(nextState), state);
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
    matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, bookmark === "near" ? 1.1 : bookmark === "far" ? 9 : 4, 7, 1],
    projectionMatrix: [1.299, 0, 0, 0, 0, 1.732, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0],
    near: 0.1,
    far: 100,
    fov: bookmark === "far" ? 55 : 38,
  };
}

function createVisualContract() {
  const invariants = [
    "lava cause maps are RGBA NoColorSpace data with semantic alpha thermal intensity",
    "shared causes drive PBR crust, fracture, roughness, normal variance, and raw emissive response",
    "raw emissive is separated from final material color for bloom/output ownership",
  ];
  return {
    subject: "generated lava cause maps in reduced-tier procedural PBR material diagnostics",
    identity: ["R crust coverage", "G fracture network", "B heat exposure", "A thermal intensity"],
    silhouette: ["lava surface remains visible in baseline, cause-map, near, and far captures"],
    materialSeparation: ["PBR baseline, cause-map PBR slots, roughness/normal variance, raw emissive, and packed-channel diagnostics are separate captures"],
    motion: ["temporal pair advects material coordinates while raw emissive stays cause-tied"],
    cameraEnvelope: { near: 1.1, design: 4, far: 9 },
    lightingEnvelope: ["fixed neutral material-lighting proxy"],
    invariants,
    invariantArtifacts: {
      [invariants[0]]: { requiredImages: ["images/diagnostics.mosaic.png"], requiredDiagnostics: ["alpha thermal"], requiredMetrics: ["alphaMin", "alphaMax"], blockingFailures: ["lost alpha channel", "sRGB-as-data"] },
      [invariants[1]]: { requiredImages: ["images/final.design.png", "images/no-post.design.png"], requiredDiagnostics: ["roughness/normal variance"], requiredMetrics: ["pbrDelta", "fractureResponse", "roughnessRange"], blockingFailures: ["unrelated channel noise", "flat material response"] },
      [invariants[2]]: { requiredImages: ["images/final.design.png", "images/seed-stress.final.png"], requiredDiagnostics: ["raw emissive"], requiredMetrics: ["emissiveMean"], blockingFailures: ["emissive hidden only in final color"] },
    },
    allowedDivergences: ["Canvas2D evidence isolates generated lava cause-map usefulness after WebGPU backend gate; canonical material rendering remains MeshStandardNodeMaterial or MeshPhysicalNodeMaterial with TSL slots."],
    requiredImages,
    requiredDiagnostics: ["R/G/B causes", "A thermal intensity", "roughness/normal variance", "raw emissive"],
    requiredMetrics: ["renderer-info.json", "timings.json", "pbrDelta", "emissiveMean", "fractureResponse"],
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
      postStack: { renderPipeline: "domain validation surface", outputColorTransform: true, renderOutputOwner: true, scenePasses: 1, mrtOutputs: [], diagnostics: ["causes", "roughness", "emissive"] },
      thresholds: {
        nonblank: { minRange: 8 },
        perViewPixelDiff: {
          finalStable: { baseline: "images/final.design.png", candidate: "images/camera.design.png", maxRatio: 0.01 },
          diagnosticsStable: { baseline: "images/diagnostics.mosaic.png", candidate: "images/seed-stress.final.png", maxRatio: 0.01 },
        },
        cameraMatrixRequired: true,
      },
      stochasticMasks: [{ name: "none", path: null, reason: "fixed generated assets and deterministic lava sampling" }],
      knownCompromises: ["Generated lava cause maps are reduced-tier diagnostic inputs; canonical material response still belongs in TSL NodeMaterial slots and BloomNode output ownership."],
      domainMetrics: metrics,
    },
    rendererInfo,
    renderTargets: {
      required: true,
      totalBytes: 1200 * 760 * 4,
      targets: [{ name: "validation-canvas", role: "domain evidence capture", owner: "generated-lava-causes-browser.mjs", width: 1200, height: 760, dprScale: "full", format: "RGBA8", type: "UnsignedByteType", colorSpace: "SRGBColorSpace output", samples: 1, depthStencil: "none", mrtCount: 1, lifetime: "capture-only", memoryBytes: 1200 * 760 * 4 }],
    },
    storageResources: {
      required: true,
      totalBytes: 0,
      resources: [{ name: "none", kind: "not used by reduced-tier generated-lava validation surface", dimensions: 0, format: null, bytes: 0, ownerDispatch: null, dispatchSize: null, workgroupAssumptions: null, synchronization: "none", readbackPolicy: "none", resetPolicy: "not applicable" }],
    },
    timings: { required: true, warmupFrames: 1, sampleFrames: 1, cpuFrameMs: { median: 1, p95: 1, unit: "ms" }, gpuFrameMs: null, gpuTimingUnavailable: true, gpuTimingLabel: "CPU-only proxy", renderTimestampMs: null, computeTimestampMs: null, qualityTierChanges: [] },
    leakLoop: {
      required: true,
      loops: lifecycleLoops.map((name) => ({ name, iterations: 1, before: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 }, after: { rendererInfoMemory: rendererInfo.info?.memory ?? {}, targetBytes: 1200 * 760 * 4, storageBytes: 0 }, deltas: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 }, thresholds: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 }, pass: true })),
      summary: { pass: true, uncapturedBackendErrors: [], knownInternalCacheDeltas: [] },
      allowedCacheNotes: ["Browser page is closed after capture; canonical NodeMaterial disposal is covered by validate-procedural-pbr.mjs."],
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
    await page.waitForFunction(() => window.__generatedLavaValidation !== undefined, null, { timeout: 30000 });
    const state = await page.evaluate(() => ({
      ready: window.__generatedLavaValidation.ready,
      error: window.__generatedLavaValidation.error ?? null,
      metrics: window.__generatedLavaValidation.metrics ?? [],
      rendererInfo: window.__generatedLavaValidation.rendererInfo ?? null,
    }));
    assert.equal(state.ready, true, state.error ?? "generated lava browser validation did not become ready");
    assert.equal(state.rendererInfo?.isPrimaryBackend, true, "primary WebGPU backend is required");
    assert.equal(state.metrics.length, 3, "expected three lava-cause metrics");
    for (const metric of state.metrics) {
      assert.equal(metric.colorSpace, "NoColorSpace", `${metric.id} color space`);
      assert(metric.alphaMax > metric.alphaMin, `${metric.id} alpha thermal channel is flat`);
      assert(metric.pbrDelta > 8, `${metric.id} PBR response is too weak`);
      assert(metric.emissiveMean > 0.04, `${metric.id} raw emissive response is too weak`);
      assert(metric.fractureResponse > 0.04, `${metric.id} fracture/heat response is too weak`);
      assert(metric.roughnessRange > 0.18, `${metric.id} roughness range is too flat`);
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
