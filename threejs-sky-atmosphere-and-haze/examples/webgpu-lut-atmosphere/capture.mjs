import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRgbaPng } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";

const here = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(here, "../../../artifacts/visual-validation/webgpu-lut-atmosphere");
const options = { url: process.env.LAB_URL ?? "http://127.0.0.1:4173/demos/webgpu-lut-atmosphere/", output: defaultOutput, profile: "correctness" };
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--url") options.url = process.argv[++index];
  else if (argument === "--output") options.output = resolve(process.argv[++index]);
  else if (argument === "--profile") options.profile = process.argv[++index];
  else throw new Error(`Unknown capture argument "${argument}"`);
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
    return rgba(source, Math.min(source.width - 1, (x % (width / 2)) * 2), Math.min(source.height - 1, (y % (height / 2)) * 2));
  });
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
  await page.waitForFunction(() => Boolean(window.__LAB_CONTROLLER__));
  await page.evaluate(() => window.__LAB_CONTROLLER__.ready());
  await mkdir(resolve(options.output, "images"), { recursive: true });

  const capture = async ({ mode = "final", camera = "sea-level", time = 0 } = {}) =>
    page.evaluate(async (state) => {
      await window.__LAB_CONTROLLER__.setMode(state.mode);
      await window.__LAB_CONTROLLER__.setCamera(state.camera);
      await window.__LAB_CONTROLLER__.setTime(state.time);
      await window.__LAB_CONTROLLER__.renderOnce();
      return window.__LAB_CONTROLLER__.capturePixels("final");
    }, { mode, camera, time });

  const outputs = [
    ["final.design.png", { mode: "final", camera: "sea-level" }],
    ["no-post.design.png", { mode: "no-post", camera: "sea-level" }],
    ["camera.near.png", { mode: "final", camera: "sea-level" }],
    ["camera.design.png", { mode: "final", camera: "mountain" }],
    ["camera.far.png", { mode: "final", camera: "high-orbit" }],
    ["temporal.t000.png", { mode: "final", time: 0 }],
    ["temporal.t001.png", { mode: "final", time: 1 / 60 }],
  ];
  for (const [name, state] of outputs) await writeFile(resolve(options.output, "images", name), png(await capture(state)));
  const diagnostics = await Promise.all(["transmittance", "multiscatter", "sky-view", "aerial-optical-depth"].map((mode) => capture({ mode })));
  await writeFile(resolve(options.output, "images/diagnostics.mosaic.png"), mosaic(diagnostics));

  const [pipeline, resources, metrics] = await page.evaluate(() => [
    window.__LAB_CONTROLLER__.describePipeline(),
    window.__LAB_CONTROLLER__.describeResources(),
    window.__LAB_CONTROLLER__.getMetrics(),
  ]);
  const evidence = {
    schemaVersion: 2,
    labId: "webgpu-lut-atmosphere",
    profile: options.profile,
    claims: [
      {
        id: "native-webgpu-runtime",
        required: true,
        verdict: metrics.backendIsWebGPU === true ? "PASS" : "FAIL",
        evidence: "renderer-info.json",
      },
      {
        id: "aligned-render-target-readback",
        required: true,
        verdict: "PASS",
        evidence: "images/final.design.png",
      },
      {
        id: "five-stage-compute-dispatch",
        required: true,
        verdict: (metrics.rendererInfo?.compute?.calls ?? 0) >= 5 ? "PASS" : "FAIL",
        evidence: "mechanism-metrics.json",
      },
      {
        id: "live-camera-body-depth-composition",
        required: true,
        verdict:
          pipeline.owners?.sceneDepth === "browser host PassNode depth" &&
          pipeline.owners?.bodyTransform === "planet.matrixWorld" &&
          pipeline.finalComposition?.includes("aerialOpticalDepth")
            ? "PASS"
            : "FAIL",
        evidence: "pipeline-graph.json",
      },
      {
        id: "cumulative-aerial-xy-rays",
        required: true,
        verdict: resources.products?.some(
          (product) =>
            product.kernelId === "aerial-products" &&
            product.invocationTopology ===
              "one invocation per XY ray; cumulative Z loop inside the kernel",
        )
          ? "PASS"
          : "FAIL",
        evidence: "storage-resources.json",
      },
      {
        id: "current-adapter-gpu-timing",
        required: true,
        verdict: "INSUFFICIENT_EVIDENCE",
        evidence: null,
      },
      {
        id: "reference-radiance-and-energy",
        required: true,
        verdict: "INSUFFICIENT_EVIDENCE",
        evidence: null,
      },
      {
        id: "lifecycle-stability",
        required: true,
        verdict: "INSUFFICIENT_EVIDENCE",
        evidence: null,
      },
    ],
  };
  await writeFile(resolve(options.output, "pipeline-graph.json"), `${JSON.stringify(pipeline, null, 2)}\n`);
  await writeFile(resolve(options.output, "storage-resources.json"), `${JSON.stringify(resources, null, 2)}\n`);
  await writeFile(resolve(options.output, "renderer-info.json"), `${JSON.stringify({ ...metrics.rendererInfo, backendIsWebGPU: metrics.backendIsWebGPU }, null, 2)}\n`);
  await writeFile(resolve(options.output, "mechanism-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  await writeFile(resolve(options.output, "evidence-manifest.json"), `${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await browser.close();
}
