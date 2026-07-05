import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { createRgbaPng } from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const artifactDir = resolve(here, "artifacts");
const pagePath = "/threejs-water-optics/EXPERIMENTAL/water-integration-surface/browser.html?headless=1";
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
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

function imageRange(decoded) {
  let min = 255;
  let max = 0;
  let opaquePixels = 0;
  for (let offset = 0; offset < decoded.pixels.length; offset += 4) {
    min = Math.min(min, decoded.pixels[offset], decoded.pixels[offset + 1], decoded.pixels[offset + 2]);
    max = Math.max(max, decoded.pixels[offset], decoded.pixels[offset + 1], decoded.pixels[offset + 2]);
    if (decoded.pixels[offset + 3] > 250) opaquePixels += 1;
  }
  return { min, max, opaquePixels };
}

function decodeScreenshotPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, signature.length).equals(signature)) {
    throw new Error("Expected PNG signature.");
  }

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || ![2, 6].includes(colorType) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error("Only non-interlaced 8-bit RGB/RGBA screenshots are supported.");
      }
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const scanlineLength = 1 + rowBytes;
  const raw = inflateSync(Buffer.concat(idatChunks));
  if (raw.length !== height * scanlineLength) {
    throw new Error(`Unexpected screenshot PNG payload length: ${raw.length}.`);
  }

  const reconstructed = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * scanlineLength;
    const filter = raw[rowOffset];
    const sourceOffset = rowOffset + 1;
    const targetOffset = y * rowBytes;
    const previousOffset = targetOffset - rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const source = raw[sourceOffset + x];
      const left = x >= bytesPerPixel ? reconstructed[targetOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? reconstructed[previousOffset + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? reconstructed[previousOffset + x - bytesPerPixel] : 0;
      let value;
      if (filter === 0) {
        value = source;
      } else if (filter === 1) {
        value = source + left;
      } else if (filter === 2) {
        value = source + up;
      } else if (filter === 3) {
        value = source + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = source + predictor;
      } else {
        throw new Error(`Unsupported screenshot PNG row filter ${filter}.`);
      }
      reconstructed[targetOffset + x] = value & 0xff;
    }
  }

  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = y * rowBytes + x * bytesPerPixel;
      const targetOffset = (y * width + x) * 4;
      pixels[targetOffset] = reconstructed[sourceOffset];
      pixels[targetOffset + 1] = reconstructed[sourceOffset + 1];
      pixels[targetOffset + 2] = reconstructed[sourceOffset + 2];
      pixels[targetOffset + 3] = bytesPerPixel === 4 ? reconstructed[sourceOffset + 3] : 255;
    }
  }

  return { width, height, pixels };
}

function readbackBytesPerRow(width, height, byteLength) {
  const rowBytes = width * 4;
  if (byteLength === rowBytes * height) return rowBytes;
  const padded = Math.ceil(rowBytes / 256) * 256;
  if (byteLength === padded * height || byteLength === padded * (height - 1) + rowBytes) return padded;
  const divided = byteLength / height;
  if (Number.isInteger(divided) && divided >= rowBytes) return divided;
  throw new Error(`Invalid readback stride for ${width}x${height}: ${byteLength} bytes.`);
}

function readbackRange(capture) {
  const bytesPerRow = readbackBytesPerRow(capture.width, capture.height, capture.byteLength ?? capture.pixels.length);
  let min = 255;
  let max = 0;
  let opaquePixels = 0;
  for (let y = 0; y < capture.height; y += 1) {
    for (let x = 0; x < capture.width; x += 1) {
      const offset = y * bytesPerRow + x * 4;
      min = Math.min(min, capture.pixels[offset], capture.pixels[offset + 1], capture.pixels[offset + 2]);
      max = Math.max(max, capture.pixels[offset], capture.pixels[offset + 1], capture.pixels[offset + 2]);
      if (capture.pixels[offset + 3] > 250) opaquePixels += 1;
    }
  }
  return { min, max, opaquePixels, bytesPerRow };
}

function encodeReadbackPng(capture) {
  const bytesPerRow = readbackBytesPerRow(capture.width, capture.height, capture.byteLength ?? capture.pixels.length);
  return createRgbaPng(capture.width, capture.height, (x, y) => {
    const offset = y * bytesPerRow + x * 4;
    return [
      capture.pixels[offset],
      capture.pixels[offset + 1],
      capture.pixels[offset + 2],
      capture.pixels[offset + 3],
    ];
  });
}

async function main() {
  const playwright = await import("../../examples/webgpu-bounded-water/node_modules/playwright/index.js");
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  assert(chromium, "Playwright Chromium launcher unavailable.");
  const server = serveStatic(repoRoot);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan,UseSkiaRenderer",
      "--disable-gpu-sandbox",
    ],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
        console.error(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}${pagePath}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__waterIntegrationDemo !== undefined, null, { timeout: 45000 });
    const readyState = await page.evaluate(() => ({ ready: window.__waterIntegrationDemo.ready, error: window.__waterIntegrationDemo.error ?? null }));
    assert.equal(readyState.ready, true, readyState.error ?? "water integration demo did not initialize");

    const result = await page.evaluate(() => window.__waterIntegrationDemo.runValidationSequence());
    const checks = result.checks;
    assert.equal(checks.webgpu, true, "demo must initialize the primary WebGPU backend");
    assert(checks.presetCount >= 4, "demo must expose several project presets");
    assert.equal(checks.sampleBudget, true, "host buoyancy must stay inside the 128-sample budget");
    assert.equal(checks.objectImpulses, true, "floating host objects must submit object impulses to the water core");
    assert.equal(checks.sprayObserved, true, "spray probes must emit at least one plume during validation");
    assert.equal(checks.transparentExcludedFromDepth, true, "transparent host objects must be excluded from the opaque depth scene");
    assert.equal(checks.maskGapRecorded, true, "experiment must record the current masking gap explicitly");
    assert.equal(checks.deterministicSync, true, "syncToTick must land on the next deterministic fixed step");
    await page.evaluate(() => window.__waterIntegrationDemo.renderOnce());
    await page.waitForTimeout(250);

    await mkdir(artifactDir, { recursive: true });
    const pageScreenshotPath = resolve(artifactDir, "integration-surface-page.png");
    const pageScreenshot = await page.screenshot({ path: pageScreenshotPath, fullPage: false });
    const pageRange = imageRange(decodeScreenshotPng(pageScreenshot));
    const capture = await page.evaluate(() => window.__waterIntegrationDemo.captureReadback({ width: 640, height: 400 }));
    const range = readbackRange(capture);
    assert(range.max - range.min > 20, `integration readback is blank or too flat: ${JSON.stringify(range)}`);
    assert(range.opaquePixels > capture.width * capture.height * 0.98, "integration readback must be mostly opaque");
    const readbackPath = resolve(artifactDir, "integration-surface-readback.png");
    await writeFile(readbackPath, encodeReadbackPng(capture));
    assert.deepEqual(pageErrors, [], `page errors:\n${pageErrors.join("\n")}`);
    assert.deepEqual(consoleErrors, [], `console errors:\n${consoleErrors.join("\n")}`);
    const contractPath = resolve(artifactDir, "integration-contract.json");
    await writeFile(contractPath, `${JSON.stringify(result, null, 2)}\n`);

    console.log(JSON.stringify({
      pass: true,
      artifactDir,
      pageScreenshotPath,
      pageImageRange: pageRange,
      readbackPath,
      imageRange: range,
      checks,
      beforeSync: result.beforeSync,
      afterSync: result.afterSync,
    }, null, 2));
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
