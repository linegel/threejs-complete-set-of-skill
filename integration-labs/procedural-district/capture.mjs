import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const outputDir = resolve(process.env.LAB_ARTIFACT_DIR ?? resolve(root, "artifacts/visual-validation/procedural-district"));
const profileIndex = process.argv.indexOf("--profile");
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : "correctness";
if (!["correctness", "performance"].includes(profile)) throw new Error(`Unknown capture profile: ${profile}`);

await mkdir(outputDir, { recursive: true });
const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0, strictPort: false } });
let browser;

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

try {
  await server.listen();
  const base = server.resolvedUrls?.local?.[0];
  if (!base) throw new Error("Vite did not expose a local URL.");
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--disable-gpu-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error.stack ?? error.message)));
  await page.goto(new URL("integration-labs/procedural-district/index.html?capture=1", base).href, { waitUntil: "load" });
  await page.waitForFunction(() => window.__LAB_CONTROLLER__ !== undefined || window.__LAB_ERROR__ !== undefined);
  const blocker = await page.evaluate(() => window.__LAB_ERROR__ ?? null);
  if (blocker) throw new Error(blocker);
  await page.evaluate(async () => window.__LAB_READY__);
  await page.evaluate(async () => {
    const controller = window.__LAB_CONTROLLER__;
    await controller.resize(1200, 800, 1);
    await controller.setScenario("district");
    await controller.setTier("balanced");
    await controller.setSeed(1);
    await controller.setCamera("district");
    await controller.setTime(0);
    await controller.setMode("final");
  });

  const warmupFrames = profile === "performance" ? 30 : 4;
  const cpuSubmissionSamples = await page.evaluate(async (count) => {
    const values = [];
    for (let index = 0; index < count; index += 1) {
      const start = performance.now();
      await window.__LAB_CONTROLLER__.renderOnce();
      values.push(performance.now() - start);
    }
    return values;
  }, warmupFrames);

  const readbacks = [];
  async function captureRaw(id, target, mode, time = 0) {
    const result = await page.evaluate(async ({ captureTarget, selectedMode, selectedTime }) => {
      const controller = window.__LAB_CONTROLLER__;
      await controller.setTime(selectedTime);
      await controller.setMode(selectedMode);
      const capture = await controller.capturePixels(captureTarget);
      let binary = "";
      for (let offset = 0; offset < capture.data.length; offset += 0x8000) {
        binary += String.fromCharCode(...capture.data.subarray(offset, offset + 0x8000));
      }
      return { ...capture, data: undefined, base64: btoa(binary) };
    }, { captureTarget: target, selectedMode: mode, selectedTime: time });
    const bytes = Buffer.from(result.base64, "base64");
    const filename = `${id}.raw`;
    await writeFile(resolve(outputDir, filename), bytes);
    readbacks.push({
      id,
      mode,
      target,
      file: filename,
      width: result.width,
      height: result.height,
      componentType: result.componentType,
      bytesPerTexel: { value: result.bytesPerTexel, unit: "bytes/texel", label: "Measured", source: "WebGPU render-target readback metadata" },
      bytesPerRow: { value: result.bytesPerRow, unit: "bytes", label: "Measured", source: "integer 256-byte-aligned WebGPU copy stride" },
      packedRowBytes: { value: result.packedRowBytes, unit: "bytes", label: "Measured", source: "packed raw artifact row width" },
      byteLength: { value: bytes.byteLength, unit: "bytes", label: "Measured", source: "written raw artifact" },
      sha256: sha256(bytes),
    });
  }

  for (const [id, target, mode, time] of [
    ["final-display", "display", "final", 0],
    ["no-post-display", "display", "no-post", 0],
    ["shared-field-display", "display", "shared-field", 0],
    ["facade-ownership-display", "display", "facade-ownership", 0],
    ["material-slots-display", "display", "material-slots", 0],
    ["weather-state-display", "display", "weather-state", 4],
    ["shadow-contribution-display", "display", "shadow-contribution", 0],
    ["ao-display", "display", "ao", 0],
    ["gbuffer-normal", "normal", "final", 0],
    ["raw-gtao", "raw-ao", "final", 0],
  ]) await captureRaw(id, target, mode, time);

  await page.evaluate(async () => window.__LAB_CONTROLLER__.resize(641, 359, 1));
  await captureRaw("odd-641x359-display", "display", "final", 0);
  await page.evaluate(async () => window.__LAB_CONTROLLER__.resize(1200, 800, 1));

  const runtime = await page.evaluate(() => {
    const safe = (value) => JSON.parse(JSON.stringify(value, (key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
    const controller = window.__LAB_CONTROLLER__;
    return {
      metrics: safe(controller.getMetrics()),
      pipeline: safe(controller.describePipeline()),
      resources: safe(controller.describeResources()),
    };
  });
  if (runtime.metrics.backend !== "webgpu") throw new Error("Capture did not prove native WebGPU.");

  await writeFile(resolve(outputDir, "renderer-info.json"), `${JSON.stringify({
    schemaVersion: 2,
    renderer: "WebGPURenderer",
    backend: { isWebGPUBackend: true },
    threeRevision: runtime.metrics.threeRevision,
    info: runtime.metrics.rendererInfo,
  }, null, 2)}\n`);
  await writeFile(resolve(outputDir, "pipeline-graph.json"), `${JSON.stringify(runtime.pipeline, null, 2)}\n`);
  await writeFile(resolve(outputDir, "render-targets.json"), `${JSON.stringify({ schemaVersion: 2, readbacks }, null, 2)}\n`);
  await writeFile(resolve(outputDir, "storage-resources.json"), `${JSON.stringify({
    schemaVersion: 2,
    resources: runtime.resources.resources.filter((entry) => entry.kind.includes("storage")),
    note: "Storage textures are sampled by the shared-field render diagnostic; direct storage readback remains pending.",
  }, null, 2)}\n`);
  await writeFile(resolve(outputDir, "capture-status.json"), `${JSON.stringify({
    schemaVersion: 2,
    labId: "procedural-district",
    profile,
    captureKind: "raw-render-target-candidate",
    claimVerdicts: {
      visualCorrectness: "INSUFFICIENT_EVIDENCE",
      mechanismCorrectness: "INSUFFICIENT_EVIDENCE",
      performanceCompliance: "INSUFFICIENT_EVIDENCE",
      gpuAttribution: "INSUFFICIENT_EVIDENCE",
      lifecycleStability: "INSUFFICIENT_EVIDENCE",
    },
    cpuSubmissionSamples: { values: cpuSubmissionSamples, unit: "ms", label: "Measured", source: "performance.now around render submission; not GPU completion" },
    gpuTimingVerdict: "INSUFFICIENT_EVIDENCE",
    browserErrors,
    readbacks: readbacks.map((entry) => entry.file),
    invariantValidation: runtime.metrics.invariantValidation,
    resources: runtime.resources,
    note: "No page screenshot is used as WebGPU proof. Raw candidates still require color-managed PNG derivation, image metrics, current-adapter GPU timestamps, and a 50-100 cycle lifecycle bundle.",
  }, null, 2)}\n`);
  console.log(JSON.stringify({
    labId: "procedural-district",
    profile,
    outputDir: relative(root, outputDir),
    rawReadbacks: readbacks.length,
    verdict: "INSUFFICIENT_EVIDENCE",
  }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}

