import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "starfield-tile-a", url: "../../assets/generated-variants/starfield-tile-a.png", colorSpace: "SRGBColorSpace" },
  { id: "starfield-tile-b", url: "../../assets/generated-variants/starfield-tile-b.png", colorSpace: "SRGBColorSpace" },
  { id: "starfield-tile-c", url: "../../assets/generated-variants/starfield-tile-c.png", colorSpace: "SRGBColorSpace" },
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

function sampleStar(record, u, v, phase = 0, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = (((u + phase * 0.01) * tileScale) % 1 + 1) % 1;
  const wrappedV = (((v - phase * 0.007) * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}

function lensedUv(u, v, phase = 0) {
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  const radius = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  const bounded = clamp01(1 - radius / 0.92);
  const bend = bounded * bounded * 0.26 / Math.max(0.16, radius + 0.08);
  const ring = Math.exp(-((radius - 0.42) ** 2) / 0.004);
  const warpedRadius = radius + bend - ring * 0.08;
  const warpedAngle = angle + bounded * 0.72 + phase * 0.08;
  return {
    u: warpedRadius * Math.cos(warpedAngle) * 0.5 + 0.5,
    v: warpedRadius * Math.sin(warpedAngle) * 0.5 + 0.5,
    bend,
    ring,
    termination: radius < 0.13 ? 1 : radius > 0.96 ? 2 : 0,
  };
}

function starPixel({ record, u, v, phase = 0, tileScale = 1, useLens = true, diagnostic = null }) {
  const lens = useLens ? lensedUv(u, v, phase) : { u, v, bend: 0, ring: 0, termination: 0 };
  const star = sampleStar(record, lens.u, lens.v, phase, tileScale);
  const core = lens.termination === 1;
  const disk = clamp01(lens.ring * (0.65 + Math.sin((u + v + phase) * 18) * 0.16));
  const opacity = clamp01(core ? 1 : disk * 0.7);

  if (diagnostic === "raw") return sampleStar(record, u, v, phase, tileScale);
  if (diagnostic === "bend") return [Math.round(clamp01(lens.u) * 255), Math.round(clamp01(lens.v) * 255), Math.round(clamp01(lens.bend * 5) * 255), 255];
  if (diagnostic === "termination") return [core ? 255 : 0, lens.termination === 2 ? 180 : 0, Math.round(opacity * 255), 255];

  const diskColor = [255, 174, 58];
  const result = [
    mix(star[0], diskColor[0], disk),
    mix(star[1], diskColor[1], disk),
    mix(star[2], diskColor[2], disk),
  ];
  return core ? [0, 0, 0, 255] : [Math.round(result[0]), Math.round(result[1]), Math.round(result[2]), 255];
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
  ctx.strokeStyle = "rgba(225,234,255,0.35)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(245,248,255,0.96)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(label, x + 12, y + 25);
}

function makeCanvas() {
  const canvas = document.getElementById("validation-canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#030712";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  drawPanel(ctx, { x: 35, y: 70, w: 250, h: 255 }, "unlensed star baseline", (u, v) => starPixel({ record: records[0], u, v, useLens: false, tileScale: 1.4 }));
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 315 + index * 285, y: 70, w: 250, h: 255 }, `${record.asset.id} lensed`, (u, v) => starPixel({ record, u, v, phase: 0.2, tileScale: 1.4 }));
  });
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 82 + index * 365, y: 410, w: 310, h: 230 }, `${record.asset.id} bent direction`, (u, v) => starPixel({ record, u, v, phase: 0.2, diagnostic: "bend" }));
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 70, y: 92, w: 330, h: 280 }, "raw SRGB star tile", (u, v) => starPixel({ record: records[0], u, v, useLens: false, tileScale: 1.5, diagnostic: "raw" }));
  drawPanel(ctx, { x: 435, y: 92, w: 330, h: 280 }, "final-direction lookup", (u, v) => starPixel({ record: records[0], u, v, tileScale: 1.5 }));
  drawPanel(ctx, { x: 800, y: 92, w: 330, h: 280 }, "termination/opacity", (u, v) => starPixel({ record: records[0], u, v, diagnostic: "termination" }));
  drawPanel(ctx, { x: 215, y: 445, w: 330, h: 210 }, "bent environment direction", (u, v) => starPixel({ record: records[0], u, v, diagnostic: "bend" }));
  drawPanel(ctx, { x: 655, y: 445, w: 330, h: 210 }, "raw tile stress", (u, v) => starPixel({ record: records[0], u, v, tileScale: 3, diagnostic: "raw" }));
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} raw SRGB`, (u, v) => starPixel({ record, u, v, tileScale: 2.2, diagnostic: "raw" }));
    drawPanel(ctx, { x: 35 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} termination`, (u, v) => starPixel({ record, u, v, diagnostic: "termination" }));
  });
}

function drawTemporal(ctx, records, phase) {
  drawPanel(ctx, { x: 100, y: 120, w: 460, h: 420 }, `orbit phase ${phase.toFixed(2)}`, (u, v) => starPixel({ record: records[0], u, v, phase, tileScale: 1.6 }));
  drawPanel(ctx, { x: 640, y: 120, w: 460, h: 420 }, "bent direction stays explicit", (u, v) => starPixel({ record: records[0], u, v, phase, diagnostic: "bend" }));
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  return records.map((record) => {
    let lensDelta = 0;
    let brightCount = 0;
    let opaqueCount = 0;
    let terminationCount = 0;
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const raw = starPixel({ record, u, v, useLens: false, diagnostic: "raw" });
        const lensed = starPixel({ record, u, v });
        const termination = starPixel({ record, u, v, diagnostic: "termination" });
        lensDelta += Math.abs(luminance(lensed) - luminance(raw));
        brightCount += luminance(raw) > 42 ? 1 : 0;
        opaqueCount += raw[3] === 255 ? 1 : 0;
        terminationCount += termination[0] > 0 || termination[1] > 0 ? 1 : 0;
      }
    }
    const samples = width * height;
    return {
      id: record.asset.id,
      lensDelta: lensDelta / samples,
      brightRatio: brightCount / samples,
      opaqueRatio: opaqueCount / samples,
      terminationRatio: terminationCount / samples,
      colorSpace: record.asset.colorSpace,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedStarfieldValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedStarfieldValidation.records);
  else if (mode === "near") drawPanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near lensed starfield", (u, v) => starPixel({ record: window.__generatedStarfieldValidation.records[0], u, v, phase: 0.2, tileScale: 2.2 }));
  else if (mode === "far") drawFinal(ctx, window.__generatedStarfieldValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedStarfieldValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedStarfieldValidation.records);
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
  window.__generatedStarfieldValidation = { ready: true, records, metrics: computeMetrics(records), rendererInfo, capture };
}

init().catch((error) => {
  window.__generatedStarfieldValidation = { ready: false, error: error.message };
});
