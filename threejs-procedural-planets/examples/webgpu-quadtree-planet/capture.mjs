import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRgbaPng } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";

const value = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const url = value("--url");
if (!url) throw new Error("planet capture requires --url from the root lab server");
const output = resolve(value("--output", "artifacts/visual-validation/webgpu-quadtree-planet"));
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--disable-gpu-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__labController !== null || window.__labError !== null);
  const error = await page.evaluate(() => window.__labError);
  if (error) throw new Error(error);
  await page.evaluate(() => window.__labController.ready());
  await mkdir(resolve(output, "images"), { recursive: true });
  const targets = [
    ["final", "final.design.png"],
    ["patch-level", "patch-level.design.png"],
    ["transition-mask", "transition-mask.design.png"],
    ["field-atlas", "field-atlas.design.png"],
    ["gas-giant", "gas-giant.design.png"],
    ["ice-giant", "ice-giant.design.png"],
  ];
  for (const [target, filename] of targets) {
    const capture = await page.evaluate(async (mode) => {
      await window.__labController.renderOnce();
      return window.__labController.capturePixels(mode);
    }, target);
    const pixels = Uint8Array.from(capture.pixels);
    const png = createRgbaPng(capture.width, capture.height, (x, y) => {
      const offset = y * capture.rowStrideBytes + x * 4;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
    });
    await writeFile(resolve(output, "images", filename), png);
  }
  const runtime = await page.evaluate(() => ({ pipeline: window.__labController.describePipeline(), resources: window.__labController.describeResources(), metrics: window.__labController.getMetrics() }));
  await writeFile(resolve(output, "runtime-snapshot.json"), `${JSON.stringify({ ...runtime, acceptanceStatus: "incomplete-until-v2-evidence" }, null, 2)}\n`);
} finally { await browser.close(); }
