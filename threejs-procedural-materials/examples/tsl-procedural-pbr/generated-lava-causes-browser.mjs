import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "lava-cause-a", url: "../../assets/generated-variants/lava-cause-a.png", colorSpace: "NoColorSpace" },
  { id: "lava-cause-b", url: "../../assets/generated-variants/lava-cause-b.png", colorSpace: "NoColorSpace" },
  { id: "lava-cause-c", url: "../../assets/generated-variants/lava-cause-c.png", colorSpace: "NoColorSpace" },
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

function sampleCause(record, u, v, phase = 0, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = (((u + phase * 0.028) * tileScale) % 1 + 1) % 1;
  const wrappedV = (((v + Math.sin(phase + u * 4) * 0.012) * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, data[offset + 3] / 255];
}

function lavaPixel({ record, u, v, phase = 0, tileScale = 1, useCause = true, diagnostic = null }) {
  const [crust, fracture, heatExposure, thermal] = record && useCause ? sampleCause(record, u, v, phase, tileScale) : [0.82, 0.08, 0.05, 0.08];
  const molten = clamp01((fracture * 0.58 + heatExposure * 0.68 + thermal * 0.8 - crust * 0.38) * 1.55);
  const cavity = clamp01(fracture * (1 - crust * 0.35));
  const height = clamp01(crust * 0.72 + cavity * 0.22 - thermal * 0.18);
  const roughness = clamp01(0.88 - molten * 0.62 + crust * 0.16);
  const normalVariance = clamp01(Math.abs(sampleCause(record, u + 0.004, v, phase, tileScale)[0] - sampleCause(record, u - 0.004, v, phase, tileScale)[0]) * 2.4 + cavity * 0.45);
  const emissive = clamp01(molten * (0.45 + thermal * 1.1));

  if (diagnostic === "channels") return [Math.round(crust * 255), Math.round(fracture * 255), Math.round(heatExposure * 255), 255];
  if (diagnostic === "alpha") return [Math.round(thermal * 255), Math.round(emissive * 255), Math.round(molten * 255), 255];
  if (diagnostic === "roughness") return [Math.round(roughness * 255), Math.round(normalVariance * 255), Math.round(height * 255), 255];
  if (diagnostic === "emissive") return [Math.round(emissive * 255), Math.round(emissive * emissive * 210), Math.round(molten * 95), 255];

  const rock = [28 + crust * 35 + height * 22, 20 + crust * 18, 17 + crust * 13];
  const hot = [255, 76 + thermal * 126, 10 + heatExposure * 70];
  const shaded = [
    mix(rock[0], hot[0], emissive),
    mix(rock[1], hot[1], emissive),
    mix(rock[2], hot[2], emissive),
  ];
  const specular = clamp01((1 - roughness) * 0.42 + normalVariance * 0.16);
  return [
    Math.round(clamp01(shaded[0] / 255 + specular * 0.25) * 255),
    Math.round(clamp01(shaded[1] / 255 + specular * 0.14) * 255),
    Math.round(clamp01(shaded[2] / 255 + specular * 0.05) * 255),
    255,
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
  ctx.strokeStyle = "rgba(255,226,190,0.4)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(255,245,232,0.96)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(label, x + 12, y + 25);
}

function makeCanvas() {
  const canvas = document.getElementById("validation-canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#100b0a";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  drawPanel(ctx, { x: 35, y: 70, w: 250, h: 255 }, "default lava identity", (u, v) => lavaPixel({ record: records[0], u, v, useCause: false }));
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 315 + index * 285, y: 70, w: 250, h: 255 }, `${record.asset.id} PBR surface`, (u, v) => lavaPixel({ record, u, v, phase: 0.15, tileScale: 1.15 }));
  });
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 82 + index * 365, y: 410, w: 310, h: 230 }, `${record.asset.id} raw emissive`, (u, v) => lavaPixel({ record, u, v, phase: 0.15, tileScale: 1.15, diagnostic: "emissive" }));
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 70, y: 92, w: 330, h: 280 }, "PBR crust baseline", (u, v) => lavaPixel({ record: records[0], u, v, useCause: false }));
  drawPanel(ctx, { x: 435, y: 92, w: 330, h: 280 }, "cause-map PBR slots", (u, v) => lavaPixel({ record: records[0], u, v }));
  drawPanel(ctx, { x: 800, y: 92, w: 330, h: 280 }, "roughness/normal variance", (u, v) => lavaPixel({ record: records[0], u, v, diagnostic: "roughness" }));
  drawPanel(ctx, { x: 215, y: 445, w: 330, h: 210 }, "R/G/B causes", (u, v) => lavaPixel({ record: records[0], u, v, diagnostic: "channels" }));
  drawPanel(ctx, { x: 655, y: 445, w: 330, h: 210 }, "A thermal intensity", (u, v) => lavaPixel({ record: records[0], u, v, diagnostic: "alpha" }));
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} RGB causes`, (u, v) => lavaPixel({ record, u, v, tileScale: 2, diagnostic: "channels" }));
    drawPanel(ctx, { x: 35 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} alpha/emissive`, (u, v) => lavaPixel({ record, u, v, tileScale: 2, diagnostic: "alpha" }));
  });
}

function drawTemporal(ctx, records, phase) {
  drawPanel(ctx, { x: 100, y: 120, w: 460, h: 420 }, `flow phase ${phase.toFixed(2)}`, (u, v) => lavaPixel({ record: records[0], u, v, phase, tileScale: 1.35 }));
  drawPanel(ctx, { x: 640, y: 120, w: 460, h: 420 }, "raw emissive remains cause-tied", (u, v) => lavaPixel({ record: records[0], u, v, phase, tileScale: 1.35, diagnostic: "emissive" }));
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  return records.map((record) => {
    let pbrDelta = 0;
    let emissiveMean = 0;
    let fractureResponse = 0;
    let roughnessRange = { min: 1, max: 0 };
    let alphaMin = 1;
    let alphaMax = 0;
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const baseline = lavaPixel({ record, u, v, useCause: false });
        const material = lavaPixel({ record, u, v });
        const emissive = lavaPixel({ record, u, v, diagnostic: "emissive" });
        const roughness = lavaPixel({ record, u, v, diagnostic: "roughness" })[0] / 255;
        const [, fracture, heatExposure, thermal] = sampleCause(record, u, v);
        pbrDelta += Math.abs(luminance(material) - luminance(baseline));
        emissiveMean += emissive[0] / 255;
        fractureResponse += fracture * (heatExposure + thermal) * 0.5;
        roughnessRange.min = Math.min(roughnessRange.min, roughness);
        roughnessRange.max = Math.max(roughnessRange.max, roughness);
        alphaMin = Math.min(alphaMin, thermal);
        alphaMax = Math.max(alphaMax, thermal);
      }
    }
    return {
      id: record.asset.id,
      pbrDelta: pbrDelta / (width * height),
      emissiveMean: emissiveMean / (width * height),
      fractureResponse: fractureResponse / (width * height),
      roughnessRange: roughnessRange.max - roughnessRange.min,
      alphaMin,
      alphaMax,
      colorSpace: record.asset.colorSpace,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedLavaValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedLavaValidation.records);
  else if (mode === "near") drawPanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near lava PBR/emissive surface", (u, v) => lavaPixel({ record: window.__generatedLavaValidation.records[0], u, v, phase: 0.2, tileScale: 2.0 }));
  else if (mode === "far") drawFinal(ctx, window.__generatedLavaValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedLavaValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedLavaValidation.records);
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
  window.__generatedLavaValidation = { ready: true, records, metrics: computeMetrics(records), rendererInfo, capture };
}

init().catch((error) => {
  window.__generatedLavaValidation = { ready: false, error: error.message };
});
