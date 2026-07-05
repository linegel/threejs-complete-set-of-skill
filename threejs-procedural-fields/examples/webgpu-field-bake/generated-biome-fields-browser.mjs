import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "biome-field-a", url: "../../assets/generated-variants/biome-field-a.png", colorSpace: "NoColorSpace" },
  { id: "biome-field-b", url: "../../assets/generated-variants/biome-field-b.png", colorSpace: "NoColorSpace" },
  { id: "biome-field-c", url: "../../assets/generated-variants/biome-field-c.png", colorSpace: "NoColorSpace" },
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

function sampleField(record, u, v, phase = 0, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = (((u + phase * 0.014) * tileScale) % 1 + 1) % 1;
  const wrappedV = (((v - phase * 0.011) * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, data[offset + 3] / 255];
}

function biomePixel({ record, u, v, phase = 0, tileScale = 1, useField = true, diagnostic = null }) {
  const [height, ridge, cavity, moisture] = record && useField ? sampleField(record, u, v, phase, tileScale) : [0.48, 0.25, 0.18, 0.5];
  const slope = clamp01(Math.abs(sampleField(record, u + 0.004, v, phase, tileScale)[0] - sampleField(record, u - 0.004, v, phase, tileScale)[0]) * 8 + ridge * 0.28);
  const placement = clamp01((height * 0.55 + moisture * 0.35 + ridge * 0.16 - cavity * 0.42) * 1.15);
  const roughness = clamp01(0.78 - moisture * 0.35 + ridge * 0.16 + cavity * 0.24);
  const biome = moisture > 0.62 ? 2 : height > 0.6 ? 1 : 0;

  if (diagnostic === "channels") return [Math.round(height * 255), Math.round(ridge * 255), Math.round(cavity * 255), 255];
  if (diagnostic === "alpha") return [Math.round(moisture * 255), Math.round(placement * 255), Math.round(roughness * 255), 255];
  if (diagnostic === "derived") return [Math.round(slope * 255), Math.round(placement * 255), Math.round(roughness * 255), 255];

  const dry = [128 + height * 40, 104 + ridge * 35, 58 + cavity * 50];
  const alpine = [82 + height * 80, 132 + ridge * 58, 92 + moisture * 60];
  const wet = [38 + moisture * 58, 104 + moisture * 100, 126 + moisture * 90];
  const base = biome === 2 ? wet : biome === 1 ? alpine : dry;
  const shade = 1 - cavity * 0.48 - slope * 0.15;
  return [Math.round(base[0] * shade), Math.round(base[1] * shade), Math.round(base[2] * shade), 255];
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
  ctx.strokeStyle = "rgba(225,240,210,0.38)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(247,255,238,0.96)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(label, x + 12, y + 25);
}

function makeCanvas() {
  const canvas = document.getElementById("validation-canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#07100b";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  drawPanel(ctx, { x: 35, y: 70, w: 250, h: 255 }, "default field baseline", (u, v) => biomePixel({ record: records[0], u, v, useField: false }));
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 315 + index * 285, y: 70, w: 250, h: 255 }, `${record.asset.id} biome`, (u, v) => biomePixel({ record, u, v, phase: 0.1, tileScale: 1.1 }));
  });
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 82 + index * 365, y: 410, w: 310, h: 230 }, `${record.asset.id} derived`, (u, v) => biomePixel({ record, u, v, phase: 0.1, tileScale: 1.1, diagnostic: "derived" }));
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 70, y: 92, w: 330, h: 280 }, "constant field baseline", (u, v) => biomePixel({ record: records[0], u, v, useField: false }));
  drawPanel(ctx, { x: 435, y: 92, w: 330, h: 280 }, "field-shaped biome", (u, v) => biomePixel({ record: records[0], u, v }));
  drawPanel(ctx, { x: 800, y: 92, w: 330, h: 280 }, "slope/place/roughness", (u, v) => biomePixel({ record: records[0], u, v, diagnostic: "derived" }));
  drawPanel(ctx, { x: 215, y: 445, w: 330, h: 210 }, "R/G/B height ridge cavity", (u, v) => biomePixel({ record: records[0], u, v, diagnostic: "channels" }));
  drawPanel(ctx, { x: 655, y: 445, w: 330, h: 210 }, "A moisture response", (u, v) => biomePixel({ record: records[0], u, v, diagnostic: "alpha" }));
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} RGB fields`, (u, v) => biomePixel({ record, u, v, tileScale: 2, diagnostic: "channels" }));
    drawPanel(ctx, { x: 35 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} alpha moisture`, (u, v) => biomePixel({ record, u, v, tileScale: 2, diagnostic: "alpha" }));
  });
}

function drawTemporal(ctx, records, phase) {
  drawPanel(ctx, { x: 100, y: 120, w: 460, h: 420 }, `field scroll ${phase.toFixed(2)}`, (u, v) => biomePixel({ record: records[0], u, v, phase, tileScale: 1.25 }));
  drawPanel(ctx, { x: 640, y: 120, w: 460, h: 420 }, "derived channels remain tied", (u, v) => biomePixel({ record: records[0], u, v, phase, tileScale: 1.25, diagnostic: "derived" }));
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  return records.map((record) => {
    let fieldDelta = 0;
    let placementMean = 0;
    let moistureEffect = 0;
    let alphaMin = 1;
    let alphaMax = 0;
    let derivedRange = { min: 1, max: 0 };
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const baseline = biomePixel({ record, u, v, useField: false });
        const biome = biomePixel({ record, u, v });
        const derived = biomePixel({ record, u, v, diagnostic: "derived" });
        const [macroHeight, ridge, cavity, moisture] = sampleField(record, u, v);
        fieldDelta += Math.abs(luminance(biome) - luminance(baseline));
        placementMean += derived[1] / 255;
        moistureEffect += moisture * (macroHeight + ridge) * Math.max(0, 1 - cavity);
        derivedRange.min = Math.min(derivedRange.min, derived[0] / 255);
        derivedRange.max = Math.max(derivedRange.max, derived[0] / 255);
        alphaMin = Math.min(alphaMin, moisture);
        alphaMax = Math.max(alphaMax, moisture);
      }
    }
    const samples = width * height;
    return {
      id: record.asset.id,
      fieldDelta: fieldDelta / samples,
      placementMean: placementMean / samples,
      moistureEffect: moistureEffect / samples,
      derivedRange: derivedRange.max - derivedRange.min,
      alphaMin,
      alphaMax,
      colorSpace: record.asset.colorSpace,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedBiomeValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedBiomeValidation.records);
  else if (mode === "near") drawPanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near biome field response", (u, v) => biomePixel({ record: window.__generatedBiomeValidation.records[0], u, v, phase: 0.12, tileScale: 1.8 }));
  else if (mode === "far") drawFinal(ctx, window.__generatedBiomeValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedBiomeValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedBiomeValidation.records);
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
  window.__generatedBiomeValidation = { ready: true, records, metrics: computeMetrics(records), rendererInfo, capture };
}

init().catch((error) => {
  window.__generatedBiomeValidation = { ready: false, error: error.message };
});
