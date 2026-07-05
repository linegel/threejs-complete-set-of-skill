import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "frost-crystal-a", url: "../../assets/generated-variants/frost-crystal-a.png", colorSpace: "NoColorSpace" },
  { id: "frost-crystal-b", url: "../../assets/generated-variants/frost-crystal-b.png", colorSpace: "NoColorSpace" },
  { id: "frost-crystal-c", url: "../../assets/generated-variants/frost-crystal-c.png", colorSpace: "NoColorSpace" },
];

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mix = (a, b, t) => a + (b - a) * t;

async function loadImage(asset) {
  const image = new Image();
  image.decoding = "async";
  image.src = asset.url;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Failed to load ${asset.url}`));
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  return { asset, imageData: ctx.getImageData(0, 0, image.width, image.height) };
}

function sampleCrystal(record, u, v, phase = 0, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = (((u + phase * 0.022) * tileScale) % 1 + 1) % 1;
  const wrappedV = (((v - phase * 0.017) * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, data[offset + 3] / 255];
}

function clearMask(u, v, phase = 0) {
  const dx = u - mix(0.36, 0.62, phase);
  const dy = (v - 0.54) * 1.35;
  const swipe = clamp01(1 - Math.hypot(dx, dy) / 0.23);
  const trail = clamp01(1 - Math.abs(v - (0.44 + Math.sin(u * 8 + phase * 3) * 0.045)) / 0.09) * clamp01((u - 0.08) / 0.35);
  return clamp01(Math.max(swipe, trail * 0.7));
}

function frostPixel({ record, u, v, phase = 0, tileScale = 1, useCrystal = true, diagnostic = null }) {
  const [r, g, b, a] = record && useCrystal ? sampleCrystal(record, u, v, phase, tileScale) : [0.28, 0.28, 0.28, 1];
  const crystal = clamp01(r * 0.58 + g * 0.28 + b * 0.14);
  const detail = clamp01(Math.abs(r - b) * 1.8 + g * 0.35);
  const thaw = clearMask(u, v, phase);
  const visible = clamp01((crystal * 1.55 + detail * 0.35 - 0.13) * (1 - thaw * 0.86));
  const tilt = clamp01((detail * 0.8 + crystal * 0.2) * (1 - thaw * 0.55));
  const du = sampleCrystal(record, u + 0.004, v, phase, tileScale)[0] - sampleCrystal(record, u - 0.004, v, phase, tileScale)[0];
  const dv = sampleCrystal(record, u, v + 0.004, phase, tileScale)[2] - sampleCrystal(record, u, v - 0.004, phase, tileScale)[2];
  const refraction = clamp01(Math.hypot(du, dv) * 8 * tilt);

  if (diagnostic === "structure") return [Math.round(crystal * 255), Math.round(detail * 255), Math.round(visible * 255), 255];
  if (diagnostic === "history") return [Math.round((1 - thaw) * 255), Math.round(thaw * 255), Math.round(tilt * 255), 255];
  if (diagnostic === "refraction") return [Math.round((du * 0.5 + 0.5) * 255), Math.round((dv * 0.5 + 0.5) * 255), Math.round(refraction * 255), 255];

  const scene = [
    44 + u * 95 + Math.sin(v * 19) * 9,
    56 + v * 105,
    75 + u * 28 + v * 68,
  ];
  const frost = [216 + refraction * 28, 232 + visible * 18, 248 + detail * 7];
  const tint = clamp01(visible * (0.55 + refraction * 0.35));
  return [
    Math.round(mix(scene[0], frost[0], tint)),
    Math.round(mix(scene[1], frost[1], tint)),
    Math.round(mix(scene[2], frost[2], tint)),
    Math.round(a * 255),
  ];
}

function drawPanel(ctx, bounds, label, renderer) {
  const { x, y, w, h } = bounds;
  const image = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const pixel = renderer(px / Math.max(1, w - 1), py / Math.max(1, h - 1));
      const offset = (py * w + px) * 4;
      image.data[offset] = pixel[0];
      image.data[offset + 1] = pixel[1];
      image.data[offset + 2] = pixel[2];
      image.data[offset + 3] = pixel[3];
    }
  }
  ctx.putImageData(image, x, y);
  ctx.strokeStyle = "rgba(232,244,255,0.42)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(248,252,255,0.96)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(label, x + 12, y + 25);
}

function makeCanvas() {
  const canvas = document.getElementById("validation-canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#071019";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  drawPanel(ctx, { x: 35, y: 70, w: 250, h: 255 }, "clear glass / no crystal", (u, v) => frostPixel({ record: records[0], u, v, useCrystal: false }));
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 315 + index * 285, y: 70, w: 250, h: 255 }, `${record.asset.id} frost`, (u, v) => frostPixel({ record, u, v, phase: 0.18, tileScale: 1.3 }));
  });
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 82 + index * 365, y: 410, w: 310, h: 230 }, `${record.asset.id} refraction`, (u, v) => frostPixel({ record, u, v, phase: 0.18, tileScale: 1.3, diagnostic: "refraction" }));
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 70, y: 92, w: 330, h: 280 }, "clear source", (u, v) => frostPixel({ record: records[0], u, v, useCrystal: false }));
  drawPanel(ctx, { x: 435, y: 92, w: 330, h: 280 }, "crystal frost active", (u, v) => frostPixel({ record: records[0], u, v }));
  drawPanel(ctx, { x: 800, y: 92, w: 330, h: 280 }, "touch history clearing", (u, v) => frostPixel({ record: records[0], u, v, phase: 1 }));
  drawPanel(ctx, { x: 215, y: 445, w: 330, h: 210 }, "structure/detail/visible", (u, v) => frostPixel({ record: records[0], u, v, diagnostic: "structure" }));
  drawPanel(ctx, { x: 655, y: 445, w: 330, h: 210 }, "history R/A proxy", (u, v) => frostPixel({ record: records[0], u, v, diagnostic: "history" }));
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} structure`, (u, v) => frostPixel({ record, u, v, tileScale: 2, diagnostic: "structure" }));
    drawPanel(ctx, { x: 35 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} normals/refraction`, (u, v) => frostPixel({ record, u, v, tileScale: 2, diagnostic: "refraction" }));
  });
}

function drawTemporal(ctx, records, phase) {
  drawPanel(ctx, { x: 100, y: 120, w: 460, h: 420 }, `clear path ${phase.toFixed(2)}`, (u, v) => frostPixel({ record: records[0], u, v, phase, tileScale: 1.4 }));
  drawPanel(ctx, { x: 640, y: 120, w: 460, h: 420 }, "history R/A remains explicit", (u, v) => frostPixel({ record: records[0], u, v, phase, tileScale: 1.4, diagnostic: "history" }));
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  return records.map((record) => {
    let structureDelta = 0;
    let refractionSum = 0;
    let clearCut = 0;
    let visibleRange = { min: 1, max: 0 };
    let alphaMin = 1;
    let alphaMax = 0;
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const baseline = frostPixel({ record, u, v, useCrystal: false });
        const frosted = frostPixel({ record, u, v });
        const structure = frostPixel({ record, u, v, diagnostic: "structure" });
        const refraction = frostPixel({ record, u, v, diagnostic: "refraction" });
        const cleared = frostPixel({ record, u, v, phase: 1, diagnostic: "structure" });
        const [, , , alpha] = sampleCrystal(record, u, v);
        structureDelta += Math.abs(luminance(frosted) - luminance(baseline));
        refractionSum += refraction[2] / 255;
        clearCut += Math.max(0, structure[2] - cleared[2]) / 255;
        visibleRange.min = Math.min(visibleRange.min, structure[2] / 255);
        visibleRange.max = Math.max(visibleRange.max, structure[2] / 255);
        alphaMin = Math.min(alphaMin, alpha);
        alphaMax = Math.max(alphaMax, alpha);
      }
    }
    return {
      id: record.asset.id,
      structureDelta: structureDelta / (width * height),
      refractionResponse: refractionSum / (width * height),
      clearCut: clearCut / (width * height),
      visibleRange: visibleRange.max - visibleRange.min,
      alphaMin,
      alphaMax,
      colorSpace: record.asset.colorSpace,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedFrostValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedFrostValidation.records);
  else if (mode === "near") drawPanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near crystalline frost and refraction", (u, v) => frostPixel({ record: window.__generatedFrostValidation.records[0], u, v, phase: 0.2, tileScale: 2.2 }));
  else if (mode === "far") drawFinal(ctx, window.__generatedFrostValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedFrostValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedFrostValidation.records);
  return { width: canvas.width, height: canvas.height, pixels: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
}

async function init() {
  const renderer = new WebGPURenderer({ canvas: document.createElement("canvas") });
  let rendererInfo;
  try {
    await renderer.init();
    rendererInfo = {
      threeRevision: "185",
      renderer: "WebGPURenderer",
      initialized: true,
      isPrimaryBackend: renderer.backend?.isWebGPUBackend === true,
      coordinateSystem: renderer.coordinateSystem,
      outputBufferType: renderer.outputBufferType ?? "unknown",
      compatibilityMode: false,
      trackTimestamp: false,
      features: Array.from(renderer.backend?.device?.features ?? []),
      limits: Object.fromEntries(Object.entries(renderer.backend?.device?.limits ?? {}).map(([key, value]) => [key, Number(value)])),
      info: renderer.info,
      unavailableReason: null,
    };
  } catch (error) {
    rendererInfo = { threeRevision: "185", renderer: "WebGPURenderer", initialized: false, isPrimaryBackend: false, coordinateSystem: null, outputBufferType: null, compatibilityMode: false, trackTimestamp: false, unavailableReason: error.message, features: [], limits: {}, info: renderer.info ?? {} };
  }
  const records = await Promise.all(ASSETS.map(loadImage));
  window.__generatedFrostValidation = { ready: true, records, metrics: computeMetrics(records), rendererInfo, capture };
}

init().catch((error) => {
  window.__generatedFrostValidation = { ready: false, error: error.message };
});
