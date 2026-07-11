import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "directional-wave-seed-a", url: "../../assets/generated-variants/directional-wave-seed-a.png", colorSpace: "NoColorSpace" },
  { id: "directional-wave-seed-b", url: "../../assets/generated-variants/directional-wave-seed-b.png", colorSpace: "NoColorSpace" },
  { id: "directional-wave-seed-c", url: "../../assets/generated-variants/directional-wave-seed-c.png", colorSpace: "NoColorSpace" },
];

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mix = (a, b, t) => a + (b - a) * t;

function normalize3(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

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

function sampleSeed(record, u, v, phase = 0, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = (((u + phase * 0.08) * tileScale) % 1 + 1) % 1;
  const wrappedV = (((v - phase * 0.045) * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, data[offset + 3] / 255];
}

function oceanPixel({ record, u, v, phase = 0, tileScale = 1, displacement = true, diagnostic = null }) {
  const [height, slopeXRaw, slopeZRaw, alpha] = record ? sampleSeed(record, u, v, phase, tileScale) : [0.5, 0.5, 0.5, 1];
  const slopeX = slopeXRaw * 2 - 1;
  const slopeZ = slopeZRaw * 2 - 1;
  const heightSigned = height * 2 - 1;
  const waveLift = displacement ? heightSigned * 0.34 : 0;
  const jacobian = clamp01(1 - Math.abs(slopeX) * 0.38 - Math.abs(slopeZ) * 0.34 + heightSigned * 0.08);
  const foam = clamp01((0.72 - jacobian) * 3.2);

  if (diagnostic === "height") {
    const value = Math.round(height * 255);
    return [value, value, value, 255];
  }
  if (diagnostic === "slope") {
    return [Math.round(slopeXRaw * 255), Math.round(slopeZRaw * 255), Math.round(jacobian * 255), Math.round(alpha * 255)];
  }
  if (diagnostic === "jacobian") {
    return [Math.round((1 - jacobian) * 255), Math.round(foam * 255), Math.round(jacobian * 255), 255];
  }

  const normal = normalize3(-slopeX * 0.72, 1, -slopeZ * 0.72);
  const light = normalize3(-0.34, 0.62, 0.71);
  const view = normalize3(0.08, 0.45, 0.89);
  const halfVector = normalize3(light[0] + view[0], light[1] + view[1], light[2] + view[2]);
  const diffuse = Math.max(0, dot3(normal, light));
  const glint = Math.pow(Math.max(0, dot3(normal, halfVector)), 96) * 185;
  const horizon = mix(58, 98, v);
  const body = [12 + horizon * 0.12, 44 + horizon * 0.18, 72 + horizon * 0.42];
  const crest = displacement ? Math.max(0, waveLift) * 95 : 0;
  return [
    Math.round(clamp01((body[0] * (0.58 + diffuse * 0.42) + glint + crest + foam * 235) / 255) * 255),
    Math.round(clamp01((body[1] * (0.62 + diffuse * 0.5) + glint + crest + foam * 240) / 255) * 255),
    Math.round(clamp01((body[2] * (0.72 + diffuse * 0.48) + glint + crest * 0.7 + foam * 255) / 255) * 255),
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
  ctx.strokeStyle = "rgba(220,238,255,0.38)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(238,248,255,0.94)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(label, x + 12, y + 25);
}

function makeCanvas() {
  const canvas = document.getElementById("validation-canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#071018";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  drawPanel(ctx, { x: 35, y: 70, w: 250, h: 255 }, "flat ocean baseline", (u, v) => oceanPixel({ record: records[0], u, v, displacement: false }));
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 315 + index * 285, y: 70, w: 250, h: 255 }, `${record.asset.id} displaced`, (u, v) => oceanPixel({ record, u, v, phase: 0.25, tileScale: 1.4 }));
  });
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 82 + index * 365, y: 410, w: 310, h: 230 }, `${record.asset.id} slope/jacobian`, (u, v) => oceanPixel({ record, u, v, phase: 0.25, tileScale: 1.4, diagnostic: "slope" }));
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 70, y: 92, w: 330, h: 280 }, "no-displacement baseline", (u, v) => oceanPixel({ record: records[0], u, v, displacement: false }));
  drawPanel(ctx, { x: 435, y: 92, w: 330, h: 280 }, "height-driven wave response", (u, v) => oceanPixel({ record: records[0], u, v, displacement: true }));
  drawPanel(ctx, { x: 800, y: 92, w: 330, h: 280 }, "slope-lit response", (u, v) => oceanPixel({ record: records[0], u, v, displacement: true, tileScale: 2 }));
  drawPanel(ctx, { x: 215, y: 445, w: 330, h: 210 }, "height seed", (u, v) => oceanPixel({ record: records[0], u, v, diagnostic: "height" }));
  drawPanel(ctx, { x: 655, y: 445, w: 330, h: 210 }, "jacobian/foam diagnostic", (u, v) => oceanPixel({ record: records[0], u, v, diagnostic: "jacobian" }));
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} tile stress`, (u, v) => oceanPixel({ record, u, v, tileScale: 5, phase: 0.4 }));
    drawPanel(ctx, { x: 35 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} slope/J`, (u, v) => oceanPixel({ record, u, v, tileScale: 5, diagnostic: "slope" }));
  });
}

function drawTemporal(ctx, records, phase) {
  drawPanel(ctx, { x: 100, y: 120, w: 460, h: 420 }, `wave phase ${phase.toFixed(2)}`, (u, v) => oceanPixel({ record: records[0], u, v, phase, tileScale: 1.7 }));
  drawPanel(ctx, { x: 640, y: 120, w: 460, h: 420 }, "jacobian/foam phase", (u, v) => oceanPixel({ record: records[0], u, v, phase, tileScale: 1.7, diagnostic: "jacobian" }));
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  return records.map((record) => {
    let displacementDelta = 0;
    let slopeDelta = 0;
    let seamError = 0;
    let alphaMin = 1;
    let alphaMax = 0;
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const flat = oceanPixel({ record, u, v, displacement: false });
        const wave = oceanPixel({ record, u, v, displacement: true, tileScale: 2 });
        const slope = oceanPixel({ record, u, v, displacement: true, tileScale: 2, diagnostic: "slope" });
        displacementDelta += Math.abs(luminance(wave) - luminance(flat));
        slopeDelta += Math.abs(luminance(slope) - luminance(flat));
        const alpha = sampleSeed(record, u, v)[3];
        alphaMin = Math.min(alphaMin, alpha);
        alphaMax = Math.max(alphaMax, alpha);
      }
      const left = sampleSeed(record, 0.001, y / height);
      const right = sampleSeed(record, 0.999, y / height);
      seamError += Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
    }
    return {
      id: record.asset.id,
      displacementDelta: displacementDelta / (width * height),
      slopeDelta: slopeDelta / (width * height),
      seamError: seamError / height,
      alphaMin,
      alphaMax,
      colorSpace: record.asset.colorSpace,
      assetPreviewOnly: true,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedWaveSeedValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedWaveSeedValidation.records);
  else if (mode === "near") drawPanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near wave seed response", (u, v) => oceanPixel({ record: window.__generatedWaveSeedValidation.records[0], u, v, phase: 0.25, tileScale: 2.4 }));
  else if (mode === "far") drawDiagnostics(ctx, window.__generatedWaveSeedValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedWaveSeedValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedWaveSeedValidation.records);
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
      capabilityProbeOnly: true,
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
    rendererInfo = { threeRevision: "185", renderer: "WebGPURenderer", initialized: false, isPrimaryBackend: false, capabilityProbeOnly: true, coordinateSystem: null, outputBufferType: null, compatibilityMode: false, trackTimestamp: false, unavailableReason: error.message, features: [], limits: {}, info: renderer.info ?? {} };
  }
  const records = await Promise.all(ASSETS.map(loadImage));
  window.__generatedWaveSeedValidation = { ready: true, records, metrics: computeMetrics(records), rendererInfo, capture };
}

init().catch((error) => {
  window.__generatedWaveSeedValidation = { ready: false, error: error.message };
});
