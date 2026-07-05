import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "weather-map-a", url: "../../assets/generated-variants/weather-map-a.png", colorSpace: "NoColorSpace" },
  { id: "weather-map-b", url: "../../assets/generated-variants/weather-map-b.png", colorSpace: "NoColorSpace" },
  { id: "weather-map-c", url: "../../assets/generated-variants/weather-map-c.png", colorSpace: "NoColorSpace" },
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

function sampleWeather(record, u, v, phase = 0, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = (((u + phase * 0.035) * tileScale) % 1 + 1) % 1;
  const wrappedV = (((v - phase * 0.02) * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, data[offset + 3] / 255];
}

function cloudPixel({ record, u, v, phase = 0, tileScale = 1, useWeather = true, diagnostic = null }) {
  const [coverage, cloudType, verticalBias, erosion] = record && useWeather ? sampleWeather(record, u, v, phase, tileScale) : [0.5, 0.45, 0.45, 0.25];
  const height = 1 - v;
  const verticalCenter = mix(0.34, 0.72, verticalBias);
  const verticalWidth = mix(0.18, 0.34, cloudType);
  const profile = clamp01(1 - Math.abs(height - verticalCenter) / Math.max(0.05, verticalWidth));
  const detailCut = clamp01((erosion - 0.25) * 1.35);
  const shapedCoverage = clamp01((coverage - 0.22) / 0.72);
  const density = clamp01(shapedCoverage * profile * (1 - detailCut * 0.82));
  const shadow = clamp01(density * (0.65 + cloudType * 0.3));
  const silver = clamp01(Math.pow(density, 1.6) * (0.45 + verticalBias * 0.55));

  if (diagnostic === "weather") {
    return [Math.round(coverage * 255), Math.round(cloudType * 255), Math.round(verticalBias * 255), 255];
  }
  if (diagnostic === "erosion") {
    return [Math.round(erosion * 255), Math.round(detailCut * 255), Math.round(density * 255), 255];
  }
  if (diagnostic === "density") {
    const value = Math.round(density * 255);
    return [value, value, value, 255];
  }

  const sky = [34 + v * 34, 72 + v * 54, 118 + v * 76];
  const cloud = [230 + silver * 25, 235 + silver * 20, 242 + silver * 13];
  return [
    Math.round(mix(sky[0], cloud[0] - shadow * 42, density)),
    Math.round(mix(sky[1], cloud[1] - shadow * 36, density)),
    Math.round(mix(sky[2], cloud[2] - shadow * 26, density)),
    255,
  ];
}

function drawPanel(ctx, bounds, label, renderer) {
  const { x, y, w, h } = bounds;
  const image = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const pixel = renderer(px / Math.max(1, w - 1), py / Math.max(1, h - 1), px, py);
      const offset = (py * w + px) * 4;
      image.data[offset] = pixel[0];
      image.data[offset + 1] = pixel[1];
      image.data[offset + 2] = pixel[2];
      image.data[offset + 3] = pixel[3];
    }
  }
  ctx.putImageData(image, x, y);
  ctx.strokeStyle = "rgba(230,240,255,0.38)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(245,248,255,0.95)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(label, x + 12, y + 25);
}

function makeCanvas() {
  const canvas = document.getElementById("validation-canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#07111d";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  drawPanel(ctx, { x: 35, y: 70, w: 250, h: 255 }, "default no weather map", (u, v) => cloudPixel({ record: records[0], u, v, useWeather: false }));
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 315 + index * 285, y: 70, w: 250, h: 255 }, `${record.asset.id} weather layer`, (u, v) => cloudPixel({ record, u, v, phase: 0.25, tileScale: 1.2 }));
  });
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 82 + index * 365, y: 410, w: 310, h: 230 }, `${record.asset.id} density`, (u, v) => cloudPixel({ record, u, v, phase: 0.25, tileScale: 1.2, diagnostic: "density" }));
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 70, y: 92, w: 330, h: 280 }, "no-weather default density", (u, v) => cloudPixel({ record: records[0], u, v, useWeather: false }));
  drawPanel(ctx, { x: 435, y: 92, w: 330, h: 280 }, "weather-shaped density", (u, v) => cloudPixel({ record: records[0], u, v }));
  drawPanel(ctx, { x: 800, y: 92, w: 330, h: 280 }, "erosion channel active", (u, v) => cloudPixel({ record: records[0], u, v, diagnostic: "erosion" }));
  drawPanel(ctx, { x: 215, y: 445, w: 330, h: 210 }, "coverage/type/vertical RGB", (u, v) => cloudPixel({ record: records[0], u, v, diagnostic: "weather" }));
  drawPanel(ctx, { x: 655, y: 445, w: 330, h: 210 }, "density after alpha erosion", (u, v) => cloudPixel({ record: records[0], u, v, diagnostic: "density" }));
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} weather RGB`, (u, v) => cloudPixel({ record, u, v, tileScale: 2, diagnostic: "weather" }));
    drawPanel(ctx, { x: 35 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} alpha erosion`, (u, v) => cloudPixel({ record, u, v, tileScale: 2, diagnostic: "erosion" }));
  });
}

function drawTemporal(ctx, records, phase) {
  drawPanel(ctx, { x: 100, y: 120, w: 460, h: 420 }, `weather advection ${phase.toFixed(2)}`, (u, v) => cloudPixel({ record: records[0], u, v, phase, tileScale: 1.3 }));
  drawPanel(ctx, { x: 640, y: 120, w: 460, h: 420 }, "density stays weather-tied", (u, v) => cloudPixel({ record: records[0], u, v, phase, tileScale: 1.3, diagnostic: "density" }));
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  return records.map((record) => {
    let weatherDelta = 0;
    let densityRange = { min: 1, max: 0 };
    let erosionEffect = 0;
    let alphaMin = 1;
    let alphaMax = 0;
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const baseline = cloudPixel({ record, u, v, useWeather: false });
        const weather = cloudPixel({ record, u, v });
        const density = cloudPixel({ record, u, v, diagnostic: "density" })[0] / 255;
        const [coverage, cloudType, verticalBias, erosion] = sampleWeather(record, u, v);
        weatherDelta += Math.abs(luminance(weather) - luminance(baseline));
        erosionEffect += Math.max(0, erosion - 0.25) * coverage * (0.5 + cloudType * 0.5) * (0.5 + verticalBias * 0.5);
        densityRange.min = Math.min(densityRange.min, density);
        densityRange.max = Math.max(densityRange.max, density);
        alphaMin = Math.min(alphaMin, erosion);
        alphaMax = Math.max(alphaMax, erosion);
      }
    }
    return {
      id: record.asset.id,
      weatherDelta: weatherDelta / (width * height),
      densityRange: densityRange.max - densityRange.min,
      erosionEffect: erosionEffect / (width * height),
      alphaMin,
      alphaMax,
      colorSpace: record.asset.colorSpace,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedWeatherValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedWeatherValidation.records);
  else if (mode === "near") drawPanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near weather-shaped cloud bank", (u, v) => cloudPixel({ record: window.__generatedWeatherValidation.records[0], u, v, phase: 0.25, tileScale: 1.7 }));
  else if (mode === "far") drawFinal(ctx, window.__generatedWeatherValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedWeatherValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedWeatherValidation.records);
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
  window.__generatedWeatherValidation = { ready: true, records, metrics: computeMetrics(records), rendererInfo, capture };
}

init().catch((error) => {
  window.__generatedWeatherValidation = { ready: false, error: error.message };
});
