import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

import { createRgbaPng } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const defaultOutput = resolve(
  repoRoot,
  "artifacts/visual-validation/webgpu-cached-clipmap-shadow",
);

export function parseCaptureArgs(argv) {
  const options = {
    profile: "correctness",
    output: resolve(process.env.LAB_ARTIFACT_DIR ?? defaultOutput),
    headed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--profile") options.profile = argv[++index];
    else if (argument === "--output") options.output = resolve(argv[++index]);
    else if (argument === "--headed") options.headed = true;
    else throw new Error(`unknown canonical shadow capture argument: ${argument}`);
  }
  if (!new Set(["correctness", "performance"]).has(options.profile)) {
    throw new RangeError(`unknown canonical shadow capture profile: ${options.profile}`);
  }
  return options;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function pngFromPackedCapture(capture, bytes) {
  const packedRowBytes = capture.width * 4;
  if (capture.rowBytes !== packedRowBytes) {
    throw new Error(
      `controller must return packed RGBA rows; received ${capture.rowBytes}, expected ${packedRowBytes}`,
    );
  }
  if (bytes.length !== packedRowBytes * capture.height) {
    throw new Error(
      `packed capture length ${bytes.length} does not match ${capture.width}x${capture.height} RGBA8`,
    );
  }
  return createRgbaPng(capture.width, capture.height, (x, y) => {
    const offset = y * packedRowBytes + x * 4;
    return [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
  });
}

async function captureMode(page, mode, width, height) {
  return page.evaluate(async ({ selectedMode, captureWidth, captureHeight }) => {
    const capture = await window.__LAB_CONTROLLER__.capturePixels(selectedMode, {
      width: captureWidth,
      height: captureHeight,
    });
    let binary = "";
    for (let offset = 0; offset < capture.pixels.length; offset += 0x8000) {
      binary += String.fromCharCode(
        ...capture.pixels.subarray(offset, offset + 0x8000),
      );
    }
    return {
      target: capture.target,
      width: capture.width,
      height: capture.height,
      bytesPerRow: capture.bytesPerRow,
      rowBytes: capture.rowBytes,
      sourceBytesPerRow: capture.sourceBytesPerRow,
      sourceByteLength: capture.sourceByteLength,
      source: capture.source,
      base64: btoa(binary),
    };
  }, {
    selectedMode: mode,
    captureWidth: width,
    captureHeight: height,
  });
}

export async function runCanonicalShadowCapture(options) {
  await mkdir(resolve(options.output, "images"), { recursive: true });
  const primaryWidth = options.profile === "performance" ? 1920 : 1200;
  const primaryHeight = options.profile === "performance" ? 1080 : 800;
  const server = await createServer({
    root: repoRoot,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  let browser;
  try {
    await server.listen();
    const baseUrl = server.resolvedUrls?.local?.[0];
    if (!baseUrl) throw new Error("Vite did not expose a loopback URL");
    browser = await chromium.launch({
      headless: !options.headed,
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan,UseSkiaRenderer",
        "--disable-gpu-sandbox",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: primaryWidth, height: primaryHeight },
      deviceScaleFactor: 1,
    });
    const browserErrors = [];
    page.on("pageerror", (error) => {
      browserErrors.push(String(error.stack ?? error.message));
    });
    const pageUrl = new URL(
      "threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/canonical.html?mechanism=cached-clipmap",
      baseUrl,
    );
    await page.goto(pageUrl.href, { waitUntil: "load" });
    await page.waitForFunction(
      () => window.__LAB_CONTROLLER__ !== undefined || window.__LAB_ERROR__ !== null,
      null,
      { timeout: 120000 },
    );
    const blocker = await page.evaluate(() => window.__LAB_ERROR__);
    if (blocker) throw new Error(blocker);
    await page.evaluate(() => window.__LAB_CONTROLLER__.ready());

    const warmupCount = options.profile === "performance" ? 30 : 4;
    await page.evaluate(async (count) => {
      const controller = window.__LAB_CONTROLLER__;
      for (let index = 0; index < count; index += 1) {
        await controller.step(1 / 60);
      }
    }, warmupCount);

    const captures = [];
    const modes = [
      ["final", "final.design.png"],
      ["shadow-contribution", "shadow-contribution.png"],
      ["shadow-depth", "shadow-depth.png"],
      ["level-centers", "level-centers.png"],
      ["level-validity", "level-validity.png"],
      ["scheduler", "scheduler.png"],
      ["silhouette-parity", "silhouette-parity.png"],
      ["owner-graph", "owner-graph.png"],
    ];
    for (const [mode, filename] of modes) {
      const capture = await captureMode(page, mode, primaryWidth, primaryHeight);
      const bytes = Buffer.from(capture.base64, "base64");
      await writeFile(
        resolve(options.output, "images", filename),
        pngFromPackedCapture(capture, bytes),
      );
      captures.push({
        id: mode,
        file: `images/${filename}`,
        width: capture.width,
        height: capture.height,
        bytesPerRow: {
          value: capture.bytesPerRow,
          unit: "bytes",
          label: "Derived",
          source: "ceil(rowBytes / 256) * 256 WebGPU copy-row contract",
        },
        rowBytes: {
          value: capture.rowBytes,
          unit: "bytes",
          label: "Derived",
          source: "width * 4 packed RGBA8 bytes",
        },
        sourceBytesPerRow: {
          value: capture.sourceBytesPerRow,
          unit: "bytes",
          label: "Measured",
          source: "returned typed-array row stride",
        },
        sourceByteLength: capture.sourceByteLength,
        byteLength: bytes.length,
        sha256: sha256(bytes),
        source: capture.source,
      });
    }

    await page.evaluate(() => window.__LAB_CONTROLLER__.resize(641, 359, 1));
    const oddCapture = await captureMode(page, "shadow-depth", 641, 359);
    const oddBytes = Buffer.from(oddCapture.base64, "base64");
    await writeFile(
      resolve(options.output, "images", "odd-641x359.shadow-depth.png"),
      pngFromPackedCapture(oddCapture, oddBytes),
    );
    captures.push({
      id: "odd-641x359-shadow-depth",
      file: "images/odd-641x359.shadow-depth.png",
      width: oddCapture.width,
      height: oddCapture.height,
      bytesPerRow: {
        value: oddCapture.bytesPerRow,
        unit: "bytes",
        label: "Derived",
        source: "ceil(rowBytes / 256) * 256 WebGPU copy-row contract",
      },
      rowBytes: {
        value: oddCapture.rowBytes,
        unit: "bytes",
        label: "Derived",
        source: "width * 4 packed RGBA8 bytes",
      },
      sourceBytesPerRow: {
        value: oddCapture.sourceBytesPerRow,
        unit: "bytes",
        label: "Measured",
        source: "returned typed-array row stride",
      },
      sourceByteLength: oddCapture.sourceByteLength,
      byteLength: oddBytes.length,
      sha256: sha256(oddBytes),
      source: oddCapture.source,
    });

    const runtime = await page.evaluate(() => ({
      pipeline: window.__LAB_CONTROLLER__.describePipeline(),
      resources: window.__LAB_CONTROLLER__.describeResources(),
      metrics: window.__LAB_CONTROLLER__.getMetrics(),
    }));
    const claimVerdicts = {
      visualCorrectness: "INSUFFICIENT_EVIDENCE",
      mechanismCorrectness: "INSUFFICIENT_EVIDENCE",
      performanceCompliance: "INSUFFICIENT_EVIDENCE",
      gpuAttribution: "INSUFFICIENT_EVIDENCE",
      lifecycleStability: "INSUFFICIENT_EVIDENCE",
    };
    const jsonFiles = {
      "evidence-manifest.json": {
        schemaVersion: 2,
        labId: "webgpu-cached-clipmap-shadow",
        profile: options.profile,
        status: "incomplete",
        claimVerdicts,
        note:
          "This is a real native-WebGPU candidate capture, not an accepted v2 evidence bundle.",
      },
      "renderer-info.json": {
        schemaVersion: 2,
        renderer: "WebGPURenderer",
        threeRevision: runtime.resources.renderer.threeRevision,
        backend: {
          isWebGPUBackend: runtime.resources.renderer.nativeWebGPU,
        },
        timestampQuery: runtime.resources.renderer.timestampQuery,
      },
      "pipeline-graph.json": { schemaVersion: 2, ...runtime.pipeline },
      "resident-resources.json": { schemaVersion: 2, ...runtime.resources },
      "mechanism-metrics.json": { schemaVersion: 2, ...runtime.metrics },
      "render-targets.json": { schemaVersion: 2, readbacks: captures },
      "capture-status.json": {
        schemaVersion: 2,
        labId: "webgpu-cached-clipmap-shadow",
        profile: options.profile,
        status: "incomplete",
        captureKind: "native-webgpu-candidate",
        claimVerdicts,
        browserErrors,
        note:
          "Candidate render-target captures are real; full schema-v2 timing, lifecycle, numeric ROI, and current-adapter acceptance remain pending.",
      },
    };
    for (const [filename, value] of Object.entries(jsonFiles)) {
      await writeFile(
        resolve(options.output, filename),
        `${JSON.stringify(value, null, 2)}\n`,
      );
    }
    return {
      labId: "webgpu-cached-clipmap-shadow",
      profile: options.profile,
      output: relative(repoRoot, options.output),
      captures: captures.length,
      verdict: "INSUFFICIENT_EVIDENCE",
    };
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
}

async function main() {
  const result = await runCanonicalShadowCapture(
    parseCaptureArgs(process.argv.slice(2)),
  );
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
