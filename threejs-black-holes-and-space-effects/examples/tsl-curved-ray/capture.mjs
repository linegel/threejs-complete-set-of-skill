import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { REQUIRED_EVIDENCE_IMAGES, REQUIRED_EVIDENCE_JSON } from "../../../scripts/lib/evidence-v2.mjs";
import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";

const LAB_ID = "tsl-curved-ray";
const LAB_URL = "/threejs-black-holes-and-space-effects/examples/tsl-curved-ray/index.html?capture=1";
const DEBUG_MODES = ["step-count","termination","bent-direction","no-post"];
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const profileFlag = process.argv.indexOf("--profile");
const profile = profileFlag >= 0 ? process.argv[profileFlag + 1] : "correctness";
if (!["correctness", "performance"].includes(profile)) throw new RangeError(`Unknown capture profile: ${profile}`);
const captureViewport = profile === "performance"
  ? Object.freeze({ width: 1920, height: 1080, dpr: 1 })
  : Object.freeze({ width: 1200, height: 800, dpr: 1 });
const outputFlag = process.argv.indexOf("--output");
const outputDir = resolve(
  here,
  outputFlag >= 0 ? process.argv[outputFlag + 1] : `../../../artifacts/visual-validation/${LAB_ID}/${profile}`,
);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

function labelled(value, unit, label, source) {
  return { value, unit, label, source };
}

function staticServer() {
  return createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const candidate = resolve(repoRoot, `.${pathname}`);
      const relative = candidate.slice(repoRoot.length);
      if (!candidate.startsWith(repoRoot + sep) || relative.includes(`..${sep}`)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      let path = candidate;
      if (statSync(path).isDirectory()) path = resolve(path, "index.html");
      const body = readFileSync(path);
      response.writeHead(200, {
        "content-type": mime[extname(path)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
}

async function listen(server) {
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  return server.address().port;
}

async function captureFrame(page, {
  mode = "final",
  camera = "design",
  seed = 1,
  scenario = "accretion-disk",
  tier = "standard",
  time = 0,
  steps = 2,
  preserveState = false,
  cameraNudgeX = 0,
} = {}) {
  return page.evaluate(async (configuration) => {
    const lab = globalThis.__THREE_LAB__;
    if (!configuration.preserveState) {
      await lab.setScenario(configuration.scenario);
      await lab.setTier(configuration.tier);
      await lab.setSeed(configuration.seed);
      await lab.setCamera(configuration.camera);
      await lab.setTime(configuration.time);
      await lab.resetHistory("capture-configuration-change");
    }
    if (configuration.cameraNudgeX !== 0) {
      lab.camera.position.x += configuration.cameraNudgeX;
      lab.camera.lookAt(0, 0, 0);
    }
    await lab.setMode(configuration.mode);
    for (let index = 0; index < configuration.steps; index += 1) {
      await lab.step(1 / 60);
      await lab.renderOnce();
    }
    const capture = await lab.capturePixels("presentation");
    if (!(capture.pixels instanceof Uint8Array)) {
      throw new Error(`presentation capture must be Uint8Array, received ${capture.pixels?.constructor?.name}`);
    }
    const rgba = new Uint8ClampedArray(capture.width * capture.height * 4);
    const source = new Uint8Array(
      capture.pixels.buffer,
      capture.pixels.byteOffset,
      capture.pixels.byteLength,
    );
    for (let y = 0; y < capture.height; y += 1) {
      const sourceOffset = y * capture.sourceBytesPerRow;
      const destinationOffset = y * capture.width * 4;
      rgba.set(source.subarray(sourceOffset, sourceOffset + capture.width * 4), destinationOffset);
    }
    const canvas = document.createElement("canvas");
    canvas.width = capture.width;
    canvas.height = capture.height;
    canvas.getContext("2d", { alpha: false }).putImageData(
      new ImageData(rgba, capture.width, capture.height),
      0,
      0,
    );
    const blob = await new Promise((accept, reject) => canvas.toBlob(
      (value) => value ? accept(value) : reject(new Error("PNG encode failed")),
      "image/png",
    ));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    let minimumLuminance = 255;
    let maximumLuminance = 0;
    let luminanceSum = 0;
    let opaquePixels = 0;
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const luminance = 0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2];
      minimumLuminance = Math.min(minimumLuminance, luminance);
      maximumLuminance = Math.max(maximumLuminance, luminance);
      luminanceSum += luminance;
      if (rgba[offset + 3] === 255) opaquePixels += 1;
    }
    const sampleGrid = [];
    const gridWidth = 64;
    const gridHeight = 40;
    for (let gridY = 0; gridY < gridHeight; gridY += 1) {
      const y = Math.min(capture.height - 1, Math.floor((gridY + 0.5) * capture.height / gridHeight));
      for (let gridX = 0; gridX < gridWidth; gridX += 1) {
        const x = Math.min(capture.width - 1, Math.floor((gridX + 0.5) * capture.width / gridWidth));
        const offset = (y * capture.width + x) * 4;
        sampleGrid.push(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
      }
    }
    return {
      png: btoa(binary),
      width: capture.width,
      height: capture.height,
      rowBytes: capture.rowBytes,
      bytesPerRow: capture.bytesPerRow,
      sourceBytesPerRow: capture.sourceBytesPerRow,
      mode: configuration.mode,
      camera: configuration.camera,
      seed: configuration.seed,
      scenario: lab.scenario,
      tier: lab.quality,
      time: lab.time,
      pixelSummary: {
        minimumLuminance: minimumLuminance / 255,
        maximumLuminance: maximumLuminance / 255,
        meanLuminance: luminanceSum / (capture.width * capture.height * 255),
        opaqueFraction: opaquePixels / (capture.width * capture.height),
      },
      sampleGrid,
    };
  }, { mode, camera, seed, scenario, tier, time, steps, preserveState, cameraNudgeX });
}

function compareImageSamples(a, b) {
  if (a.sampleGrid.length !== b.sampleGrid.length) throw new Error("sample grids must have equal lengths");
  let absoluteSum = 0;
  let maximumAbsolute = 0;
  let changedSamples = 0;
  for (let offset = 0; offset < a.sampleGrid.length; offset += 3) {
    const difference = (
      Math.abs(a.sampleGrid[offset] - b.sampleGrid[offset]) +
      Math.abs(a.sampleGrid[offset + 1] - b.sampleGrid[offset + 1]) +
      Math.abs(a.sampleGrid[offset + 2] - b.sampleGrid[offset + 2])
    ) / (3 * 255);
    absoluteSum += difference;
    maximumAbsolute = Math.max(maximumAbsolute, difference);
    if (difference > 2 / 255) changedSamples += 1;
  }
  const sampleCount = a.sampleGrid.length / 3;
  return {
    meanAbsoluteRgb: absoluteSum / sampleCount,
    maximumAbsoluteRgb: maximumAbsolute,
    changedSampleFraction: changedSamples / sampleCount,
    exactSampleMatch: a.sampleGrid.every((value, index) => value === b.sampleGrid[index]),
  };
}

async function mosaic(page, captures) {
  return page.evaluate(async ({ encoded, width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    for (let index = 0; index < encoded.length; index += 1) {
      const response = await fetch(`data:image/png;base64,${encoded[index]}`);
      const bitmap = await createImageBitmap(await response.blob());
      context.drawImage(
        bitmap,
        (index % 2) * width / 2,
        Math.floor(index / 2) * height / 2,
        width / 2,
        height / 2,
      );
      bitmap.close();
    }
    const blob = await new Promise((accept, reject) => canvas.toBlob(
      (value) => value ? accept(value) : reject(new Error("diagnostic mosaic encode failed")),
      "image/png",
    ));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }, { encoded: captures.map(({ png }) => png), ...captureViewport });
}

function writeJson(filename, value) {
  writeFileSync(resolve(outputDir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

async function captureTiming(page) {
  const sampleCount = profile === "performance" ? 120 : 8;
  const warmupCount = profile === "performance" ? 30 : 4;
  const width = profile === "performance" ? 1920 : 1200;
  const height = profile === "performance" ? 1080 : 800;
  return page.evaluate(async ({ sampleCount, warmupCount, width, height }) => {
    const lab = globalThis.__THREE_LAB__;
    await lab.setScenario("accretion-disk");
    await lab.setTier("standard");
    await lab.setSeed(1);
    await lab.setCamera("design");
    await lab.setTime(0);
    await lab.setMode("final");
    await lab.resize(width, height, 1);
    await lab.resetHistory("timing-profile-start");
    for (let index = 0; index < warmupCount; index += 1) {
      await lab.step(1 / 60);
      await lab.renderOnce();
    }
    const timestampAvailable = lab.renderer.hasFeature?.("timestamp-query") === true;
    if (timestampAvailable) {
      await lab.renderer.resolveTimestampsAsync("render");
      await lab.renderer.resolveTimestampsAsync("compute");
    }
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const start = performance.now();
      await lab.step(1 / 60);
      await lab.renderOnce();
      const submitCpuMs = performance.now() - start;
      const renderGpuMs = timestampAvailable
        ? await lab.renderer.resolveTimestampsAsync("render")
        : null;
      const computeGpuMs = timestampAvailable
        ? await lab.renderer.resolveTimestampsAsync("compute")
        : null;
      const totalGpuMs = Number.isFinite(renderGpuMs) && renderGpuMs > 0
        ? renderGpuMs + (Number.isFinite(computeGpuMs) && computeGpuMs > 0 ? computeGpuMs : 0)
        : null;
      samples.push({ index, submitCpuMs, renderGpuMs, computeGpuMs, totalGpuMs });
    }
    const percentile = (values, q) => {
      const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
      if (sorted.length === 0) return null;
      return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    };
    const totals = samples.map(({ totalGpuMs }) => totalGpuMs).filter(Number.isFinite);
    return {
      timestampAvailable,
      viewport: { width, height, dpr: 1 },
      warmupCount,
      sampleCount,
      samples,
      summary: {
        gpuP50: percentile(totals, 0.5),
        gpuP95: percentile(totals, 0.95),
        renderGpuP95: percentile(samples.map(({ renderGpuMs }) => renderGpuMs), 0.95),
        computeGpuP95: percentile(samples.map(({ computeGpuMs }) => computeGpuMs), 0.95),
        submitCpuP95: percentile(samples.map(({ submitCpuMs }) => submitCpuMs), 0.95),
        deadlineMisses: totals.filter((value) => value > 16.67).length,
      },
    };
  }, { sampleCount, warmupCount, width, height });
}

async function captureLifecycle(page) {
  return page.evaluate(async () => {
    const lab = globalThis.__THREE_LAB__;
    const tiers = ["hero", "standard", "background", "distant"];
    const modes = ["final", "no-post", "step-count", "termination", "bent-direction"];
    const scenarios = [
      "accretion-disk",
      "ellis-wormhole",
      "schwarzschild-lensing",
      "integration-convergence",
      "temporal-reconstruction",
      "lens-cache",
    ];
    for (const tier of tiers) {
      for (const scenario of scenarios) {
        await lab.setTier(tier);
        await lab.setScenario(scenario);
        await lab.resetHistory("lifecycle-tier-scenario-warmup");
        await lab.step(1 / 60);
        await lab.renderOnce();
      }
    }
    for (const mode of modes) {
      await lab.setMode(mode);
      await lab.renderOnce();
    }
    await lab.setTier("standard");
    await lab.setScenario("accretion-disk");
    await lab.setMode("final");
    await lab.setCamera("design");
    await lab.resize(1200, 800, 1);
    await lab.resetHistory("lifecycle-baseline");
    await lab.step(1 / 60);
    await lab.renderOnce();
    const snapshot = (cycle) => ({ cycle, ...lab.renderer.info.memory });
    const baseline = snapshot(-1);
    const snapshots = [baseline];
    const cycles = 50;
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      await lab.setScenario(scenarios[cycle % scenarios.length]);
      await lab.setTier(tiers[cycle % tiers.length]);
      await lab.setMode(modes[cycle % modes.length]);
      await lab.setCamera(["near", "design", "far"][cycle % 3]);
      await lab.resize(641 + cycle % 3, 359 + cycle % 5, 1 + (cycle % 3) * 0.5);
      await lab.resetHistory(`lifecycle-cycle-${cycle}`);
      await lab.step(1 / 120);
      await lab.renderOnce();
      if (cycle % 5 === 4 || cycle === cycles - 1) snapshots.push(snapshot(cycle));
    }
    await lab.setTier("standard");
    await lab.setScenario("accretion-disk");
    await lab.setMode("final");
    await lab.setCamera("design");
    await lab.resize(1200, 800, 1);
    await lab.resetHistory("lifecycle-restored-baseline");
    await lab.step(1 / 60);
    await lab.renderOnce();
    const final = snapshot(cycles);
    snapshots.push(final);
    const tracked = [
      "attributes",
      "attributesSize",
      "geometries",
      "indexAttributes",
      "indexAttributesSize",
      "storageAttributes",
      "storageAttributesSize",
      "indirectStorageAttributes",
      "indirectStorageAttributesSize",
      "programs",
      "programsSize",
      "readbackBuffers",
      "readbackBuffersSize",
      "textures",
      "texturesSize",
      "renderTargets",
      "uniformBuffers",
      "uniformBuffersSize",
      "total",
    ];
    const comparable = tracked.every((key) => Number.isFinite(baseline[key]) && Number.isFinite(final[key]));
    const stable = comparable && tracked.every((key) => final[key] <= baseline[key]);
    return {
      verdict: stable ? "PASS" : comparable ? "FAIL" : "INSUFFICIENT_EVIDENCE",
      cycles,
      scope: "controller stage/resource replacement under one renderer",
      tracked,
      snapshots,
    };
  });
}

const registry = buildDemoRegistry();
const labManifest = registry.demos.find(({ id }) => id === LAB_ID);
if (!labManifest) throw new Error(`missing registry entry for ${LAB_ID}`);
mkdirSync(outputDir, { recursive: true });
const server = staticServer();
const port = await listen(server);
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === "darwin" ? "chrome" : undefined,
    args: [
      "--enable-unsafe-webgpu",
      "--disable-gpu-sandbox",
      "--ignore-gpu-blocklist",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-features=Vulkan,UseSkiaRenderer"]),
    ],
  });
  const page = await browser.newPage({
    viewport: { width: captureViewport.width, height: captureViewport.height },
    deviceScaleFactor: captureViewport.dpr,
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.stack ?? error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}${LAB_URL}`, { waitUntil: "load", timeout: 60_000 });
  try {
    await page.waitForFunction(
      () => globalThis.__THREE_LAB__?.renderer?.backend?.isWebGPUBackend === true,
      null,
      { timeout: 90_000 },
    );
  } catch (error) {
    const status = await page.evaluate(() => ({
      hasLab: Boolean(globalThis.__THREE_LAB__),
      labError: globalThis.__labError ?? null,
      statusText: document.querySelector("[data-status]")?.textContent ?? null,
    }));
    throw new Error(
      `curved-ray lab did not become WebGPU-ready: ${error.message}; status=${JSON.stringify(status)}; errors=${pageErrors.join(" | ")}`,
    );
  }
  await page.evaluate(async (viewport) =>
    globalThis.__THREE_LAB__.resize(viewport.width, viewport.height, viewport.dpr), captureViewport);

  const images = {};
  const readbacks = [];
  const capture = async (filename, configuration) => {
    const result = await captureFrame(page, configuration);
    images[filename] = result;
    readbacks.push({
      id: filename,
      target: "presentation",
      dimensions: [result.width, result.height],
      rowBytes: labelled(result.rowBytes, "bytes", "Derived", "width * RGBA8"),
      bytesPerRow: labelled(result.bytesPerRow, "bytes", "Derived", "ceil(rowBytes / 256) * 256 WebGPU copy-row contract"),
      sourceBytesPerRow: labelled(result.sourceBytesPerRow, "bytes", "Measured", "returned typed-array row stride"),
    });
    writeFileSync(resolve(outputDir, filename), Buffer.from(result.png, "base64"));
    return result;
  };

  await capture("final.design.png", { mode: "final" });
  await capture("no-post.design.png", { mode: "no-post" });
  await capture("camera.near.png", { mode: "final", camera: "near" });
  await capture("camera.design.png", { mode: "final", camera: "design" });
  await capture("camera.far.png", { mode: "final", camera: "far" });
  await capture("seed-0001.final.png", { mode: "final", seed: 1 });
  await capture("seed-9e3779b9.final.png", { mode: "final", seed: 0x9e3779b9 });
  await capture("tier.hero.png", { mode: "final", tier: "hero" });
  await capture("tier.standard.png", { mode: "final", tier: "standard" });
  await capture("tier.background.png", { mode: "final", tier: "background" });
  await capture("tier.distant.png", { mode: "final", tier: "distant" });
  const mechanismImages = {
    "accretion-disk": "final.design.png",
    "ellis-wormhole": "mechanism.ellis-wormhole.png",
    "schwarzschild-lensing": "mechanism.schwarzschild-lensing.png",
    "integration-convergence": "mechanism.integration-convergence.png",
    "temporal-reconstruction": "mechanism.temporal-reconstruction.png",
    "lens-cache": "mechanism.lens-cache.png",
  };
  for (const [scenario, filename] of Object.entries(mechanismImages)) {
    if (filename !== "final.design.png") await capture(filename, { mode: "final", scenario, tier: "standard" });
  }
  await capture("temporal.t000.png", {
    mode: "final",
    scenario: "temporal-reconstruction",
    time: 0,
    steps: 1,
  });
  await capture("temporal.t001.png", {
    mode: "final",
    steps: 1,
    preserveState: true,
    cameraNudgeX: 0.001,
  });
  const diagnostics = [];
  for (const mode of DEBUG_MODES) diagnostics.push(await captureFrame(page, { mode }));
  writeFileSync(
    resolve(outputDir, "diagnostics.mosaic.png"),
    Buffer.from(await mosaic(page, diagnostics), "base64"),
  );
  const diagnosticComparisons = diagnostics.map((diagnostic, index) => ({
    mode: DEBUG_MODES[index],
    ...compareImageSamples(images["final.design.png"], diagnostic),
  }));
  const visualSanityChecks = {
    finalDynamicRange: images["final.design.png"].pixelSummary.maximumLuminance -
      images["final.design.png"].pixelSummary.minimumLuminance > 0.02,
    finalOpaque: images["final.design.png"].pixelSummary.opaqueFraction === 1,
    diagnosticsDistinct: diagnosticComparisons.filter((metric) =>
      !metric.exactSampleMatch &&
      (metric.meanAbsoluteRgb > 0.001 || metric.changedSampleFraction > 0.01)).length >= 2,
  };
  const visualSanityVerdict = Object.values(visualSanityChecks).every(Boolean) ? "PASS" : "FAIL";

  const oddReadback = await page.evaluate(async (viewport) => {
    const lab = globalThis.__THREE_LAB__;
    await lab.resize(641, 359, 1);
    await lab.step(1 / 60);
    await lab.renderOnce();
    const capture = await lab.capturePixels("presentation");
    await lab.resize(viewport.width, viewport.height, viewport.dpr);
    return {
      width: capture.width,
      height: capture.height,
      rowBytes: capture.rowBytes,
      bytesPerRow: capture.bytesPerRow,
      sourceBytesPerRow: capture.sourceBytesPerRow,
    };
  }, captureViewport);
  readbacks.push({
    id: "odd-641x359",
    target: "presentation",
    dimensions: [oddReadback.width, oddReadback.height],
    rowBytes: labelled(oddReadback.rowBytes, "bytes", "Derived", "641 * RGBA8"),
    bytesPerRow: labelled(oddReadback.bytesPerRow, "bytes", "Derived", "ceil(rowBytes / 256) * 256 WebGPU copy-row contract"),
    sourceBytesPerRow: labelled(oddReadback.sourceBytesPerRow, "bytes", "Measured", "returned typed-array row stride"),
  });
  const dprSweep = await page.evaluate(async (viewport) => {
    const lab = globalThis.__THREE_LAB__;
    const rows = [];
    for (const requestedDpr of [1, 1.5, 2]) {
      await lab.resize(400, 240, requestedDpr);
      await lab.renderOnce();
      rows.push({
        requestedDpr,
        effectiveDpr: lab.renderer.getPixelRatio(),
        drawingBuffer: [lab.renderer.domElement.width, lab.renderer.domElement.height],
      });
    }
    await lab.resize(viewport.width, viewport.height, viewport.dpr);
    return rows;
  }, captureViewport);
  const timing = await captureTiming(page);
  const lifecycle = await captureLifecycle(page);

  const runtime = await page.evaluate(async () => {
    const lab = globalThis.__THREE_LAB__;
    await lab.setScenario("integration-convergence");
    const gpuReadback = await lab.readMechanismEvidence();
    const timestampAvailable = lab.renderer.hasFeature?.("timestamp-query") === true;
    if (timestampAvailable) {
      await lab.renderer.resolveTimestampsAsync?.("render");
      await lab.renderer.resolveTimestampsAsync?.("compute");
    }
    return {
      pipeline: lab.describePipeline(),
      mechanism: lab.describeMechanism(),
      resources: lab.describeResources(),
      gpuReadback,
      renderer: {
        renderer: "WebGPURenderer",
        backend: { isWebGPUBackend: lab.renderer.backend?.isWebGPUBackend === true },
        threeRevision: "185",
        adapter: lab.renderer.backend?.device?.adapterInfo ?? null,
      },
      timestamps: timestampAvailable
        ? {
          render: lab.renderer.info?.render?.timestamp ?? null,
          compute: lab.renderer.info?.compute?.timestamp ?? null,
        }
        : null,
    };
  });

  const bundleId = `${LAB_ID}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  const insufficient = "INSUFFICIENT_EVIDENCE";
  const gpuTimingValid = Number.isFinite(timing.summary.gpuP95) && timing.summary.gpuP95 > 0;
  const performanceVerdict = profile === "performance" && gpuTimingValid
    ? timing.summary.gpuP95 <= 16.67 ? "PASS" : "FAIL"
    : insufficient;
  const directProbeVerdict = runtime.gpuReadback?.allValid === true ? "PASS" : "FAIL";
  writeJson("visual-contract.json", {
    schemaVersion: 2,
    labId: LAB_ID,
    viewport: captureViewport,
    cameras: ["near", "design", "far"],
    seeds: [1, 0x9e3779b9],
    profile,
    dprSweep,
    verdict: insufficient,
  });
  writeJson("evidence-manifest.json", {
    schemaVersion: 2,
    labId: LAB_ID,
    bundleId,
    sourceHash: labManifest.sourceHash,
    claimVerdicts: {
      visualCorrectness: insufficient,
      mechanismCorrectness: insufficient,
      performanceCompliance: performanceVerdict,
      gpuAttribution: runtime.renderer.backend.isWebGPUBackend && gpuTimingValid ? "PASS" : insufficient,
      lifecycleStability: lifecycle.verdict,
    },
    mechanismClaimVerdicts: {
      "accretion-disk": insufficient,
      "ellis-wormhole": insufficient,
      "schwarzschild-lensing": insufficient,
      "integration-convergence": directProbeVerdict,
      "temporal-reconstruction": insufficient,
      "lens-cache": insufficient,
    },
    files: REQUIRED_EVIDENCE_JSON,
    images: REQUIRED_EVIDENCE_IMAGES,
    extraImages: [
      "tier.hero.png",
      "tier.standard.png",
      "tier.background.png",
      "tier.distant.png",
      ...Object.values(mechanismImages).filter((filename) => filename !== "final.design.png"),
    ],
    mechanismImages,
  });
  writeJson("renderer-info.json", { schemaVersion: 2, ...runtime.renderer });
  writeJson("pipeline-graph.json", { schemaVersion: 2, ...runtime.pipeline });
  writeJson("performance-envelope.json", {
    schemaVersion: 2,
    verdict: performanceVerdict,
    targetFrameMs: labelled(16.67, "ms", "Authored", "60 Hz primary target"),
    viewport: timing.viewport,
    warmupFrames: labelled(timing.warmupCount, "frames", "Measured", "capture loop"),
    sampleFrames: labelled(timing.sampleCount, "frames", "Measured", "capture loop"),
    gpuP50: timing.summary.gpuP50 === null ? null : labelled(timing.summary.gpuP50, "ms", "Measured", "WebGPU timestamp queries"),
    gpuP95: timing.summary.gpuP95 === null ? null : labelled(timing.summary.gpuP95, "ms", "Measured", "WebGPU timestamp queries"),
  });
  writeJson("frame-trace.json", {
    schemaVersion: 2,
    verdict: gpuTimingValid ? "PASS" : insufficient,
    profile,
    timestamps: timing.samples.map((sample) => ({
      frame: sample.index,
      submitCpuMs: labelled(sample.submitCpuMs, "ms", "Measured", "CPU submit interval"),
      renderGpuMs: sample.renderGpuMs === null ? null : labelled(sample.renderGpuMs, "ms", "Measured", "WebGPU render timestamps"),
      computeGpuMs: sample.computeGpuMs === null ? null : labelled(sample.computeGpuMs, "ms", "Measured", "WebGPU compute timestamps"),
      totalGpuMs: sample.totalGpuMs === null ? null : labelled(sample.totalGpuMs, "ms", "Derived", "renderGpuMs + computeGpuMs"),
    })),
    summary: {
      gpuP50: timing.summary.gpuP50 === null ? null : labelled(timing.summary.gpuP50, "ms", "Measured", "WebGPU timestamp queries"),
      gpuP95: timing.summary.gpuP95 === null ? null : labelled(timing.summary.gpuP95, "ms", "Measured", "WebGPU timestamp queries"),
      renderGpuP95: timing.summary.renderGpuP95 === null ? null : labelled(timing.summary.renderGpuP95, "ms", "Measured", "WebGPU render timestamps"),
      computeGpuP95: timing.summary.computeGpuP95 === null ? null : labelled(timing.summary.computeGpuP95, "ms", "Measured", "WebGPU compute timestamps"),
      submitCpuP95: labelled(timing.summary.submitCpuP95, "ms", "Measured", "CPU submit intervals"),
      deadlineMisses: labelled(timing.summary.deadlineMisses, "frames", "Derived", "totalGpuMs > 16.67"),
    },
  });
  writeJson("quality-governor.json", {
    schemaVersion: 2,
    verdict: "NOT_CLAIMED",
    transitionTrace: [],
  });
  writeJson("render-targets.json", { schemaVersion: 2, readbacks });
  writeJson("storage-resources.json", { schemaVersion: 2, resources: runtime.resources });
  writeJson("resident-resources.json", {
    schemaVersion: 2,
    verdict: lifecycle.verdict,
    scope: lifecycle.scope,
    tracked: lifecycle.tracked ?? [],
    snapshots: lifecycle.snapshots,
  });
  writeJson("bandwidth-model.json", {
    schemaVersion: 2,
    verdict: insufficient,
    scope: "capture readback accounting only; transfer/cache/temporal render-compute bandwidth is not yet adapter-measured",
    captureReadbackVerdict: "PASS",
    readbacks: labelled(readbacks.length, "readbacks", "Measured", "capture manifest"),
    capturedBytes: labelled(
      readbacks.reduce((total, readback) =>
        total + readback.sourceBytesPerRow.value * readback.dimensions[1], 0),
      "bytes",
      "Derived",
      "sum(sourceBytesPerRow * height)",
    ),
  });
  writeJson("visual-errors.json", {
    schemaVersion: 2,
    verdict: visualSanityVerdict,
    scope: "automated nonblank/opacity/diagnostic-distinctness checks; manual design review remains required",
    finalSummary: images["final.design.png"].pixelSummary,
    finalVsNoPost: compareImageSamples(images["final.design.png"], images["no-post.design.png"]),
    baselineVsStressSeed: compareImageSamples(
      images["seed-0001.final.png"],
      images["seed-9e3779b9.final.png"],
    ),
    temporalDifference: compareImageSamples(images["temporal.t000.png"], images["temporal.t001.png"]),
    diagnosticComparisons,
    checks: visualSanityChecks,
  });
  writeJson("leak-loop.json", {
    schemaVersion: 2,
    verdict: lifecycle.verdict,
    scope: lifecycle.scope,
    cycles: labelled(lifecycle.cycles, "cycles", "Measured", "create/render/resize/mode/tier/stage-dispose loop"),
    snapshots: lifecycle.snapshots,
  });
  writeJson("mechanism-metrics.json", {
    schemaVersion: 2,
    verdict: insufficient,
    directProbeVerdict,
    pipeline: runtime.pipeline,
    mechanism: runtime.mechanism,
    resources: runtime.resources,
    gpuReadback: runtime.gpuReadback,
    dprSweep,
  });
  console.log(`${LAB_ID} ${profile} capture written to ${outputDir}; visual acceptance remains pending manual review.`);
} finally {
  await browser?.close();
  await new Promise((accept) => server.close(accept));
}
