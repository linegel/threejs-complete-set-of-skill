import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "caustic-field-a", url: "../../assets/generated-variants/caustic-field-a.png", colorSpace: "NoColorSpace" },
  { id: "caustic-field-b", url: "../../assets/generated-variants/caustic-field-b.png", colorSpace: "NoColorSpace" },
  { id: "caustic-field-c", url: "../../assets/generated-variants/caustic-field-c.png", colorSpace: "NoColorSpace" },
];

const clamp01 = (value) => Math.min(1, Math.max(0, value));

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

function sampleCaustic(record, u, v, phase = 0, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = (((u + phase * 0.07) * tileScale) % 1 + 1) % 1;
  const wrappedV = (((v - phase * 0.04) * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return [
    data[offset] / 255,
    data[offset + 1] / 255,
    data[offset + 2] / 255,
    data[offset + 3] / 255,
  ];
}

function poolFloor(u, v) {
  const grout = Math.min(Math.abs(((u * 8) % 1) - 0.5), Math.abs(((v * 6) % 1) - 0.5)) < 0.018 ? 0.72 : 1;
  const depth = 0.55 + v * 0.38;
  return [34 * grout * depth, 73 * grout * depth, 82 * grout * depth];
}

function shadePool({ record, u, v, caustics = true, phase = 0, tileScale = 1, diagnostic = null }) {
  const [r, g, b, alpha] = record ? sampleCaustic(record, u, v, phase, tileScale) : [0, 0, 0, 1];
  const intensity = caustics ? clamp01((r * 0.25 + g * 0.55 + b * 0.2 - 0.18) * 1.65) : 0;
  if (diagnostic === "caustic") {
    const value = Math.round(intensity * 255);
    return [value, value, value, 255];
  }
  if (diagnostic === "channels") {
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(alpha * 255)];
  }
  const floor = poolFloor(u, v);
  const waveShadow = 0.9 + Math.sin((u + phase * 0.11) * Math.PI * 7) * Math.sin((v - phase * 0.07) * Math.PI * 5) * 0.035;
  const depthTint = [11, 42, 58];
  return [
    Math.round(clamp01((floor[0] * waveShadow + depthTint[0] + intensity * 120) / 255) * 255),
    Math.round(clamp01((floor[1] * waveShadow + depthTint[1] + intensity * 168) / 255) * 255),
    Math.round(clamp01((floor[2] * waveShadow + depthTint[2] + intensity * 196) / 255) * 255),
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
  ctx.strokeStyle = "rgba(220,240,255,0.42)";
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
  ctx.fillStyle = "#071015";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  drawPanel(ctx, { x: 30, y: 72, w: 260, h: 260 }, "dry floor", (u, v) => shadePool({ record: null, u, v, caustics: false }));
  drawPanel(ctx, { x: 320, y: 72, w: 260, h: 260 }, "water no caustics", (u, v) => shadePool({ record: records[0], u, v, caustics: false }));
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 610 + index * 188, y: 72, w: 170, h: 260 }, `${record.asset.id}`, (u, v) => shadePool({ record, u, v, phase: 0.3, tileScale: 1.2 }));
  });
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 82 + index * 365, y: 410, w: 310, h: 230 }, `${record.asset.id} caustic-only`, (u, v) => shadePool({ record, u, v, phase: 0.3, tileScale: 1.2, diagnostic: "caustic" }));
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 70, y: 90, w: 330, h: 290 }, "floor depth baseline", (u, v) => shadePool({ record: null, u, v, caustics: false }));
  drawPanel(ctx, { x: 435, y: 90, w: 330, h: 290 }, "water without caustics", (u, v) => shadePool({ record: records[0], u, v, caustics: false }));
  drawPanel(ctx, { x: 800, y: 90, w: 330, h: 290 }, "water with caustics", (u, v) => shadePool({ record: records[0], u, v, phase: 0.2 }));
  drawPanel(ctx, { x: 215, y: 445, w: 330, h: 210 }, "source RGB data", (u, v) => shadePool({ record: records[0], u, v, diagnostic: "channels" }));
  drawPanel(ctx, { x: 655, y: 445, w: 330, h: 210 }, "caustic contribution", (u, v) => shadePool({ record: records[0], u, v, diagnostic: "caustic" }));
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} tile stress`, (u, v) => shadePool({ record, u, v, tileScale: 5, phase: 0.5 }));
    drawPanel(ctx, { x: 35 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} source channels`, (u, v) => shadePool({ record, u, v, tileScale: 5, diagnostic: "channels" }));
  });
}

function drawTemporal(ctx, records, phase) {
  drawPanel(ctx, { x: 100, y: 120, w: 460, h: 420 }, `caustic drift phase ${phase.toFixed(2)}`, (u, v) => shadePool({ record: records[0], u, v, phase, tileScale: 1.5 }));
  drawPanel(ctx, { x: 640, y: 120, w: 460, h: 420 }, "caustic-only projection", (u, v) => shadePool({ record: records[0], u, v, phase, tileScale: 1.5, diagnostic: "caustic" }));
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  return records.map((record) => {
    let contribution = 0;
    let disabledContribution = 0;
    let seamError = 0;
    let alphaMin = 1;
    let alphaMax = 0;
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const off = shadePool({ record, u, v, caustics: false });
        const on = shadePool({ record, u, v, caustics: true, tileScale: 2 });
        contribution += Math.abs(luminance(on) - luminance(off));
        disabledContribution += Math.abs(luminance(off) - luminance(shadePool({ record: null, u, v, caustics: false })));
        const alpha = sampleCaustic(record, u, v)[3];
        alphaMin = Math.min(alphaMin, alpha);
        alphaMax = Math.max(alphaMax, alpha);
      }
      const left = sampleCaustic(record, 0.001, y / height);
      const right = sampleCaustic(record, 0.999, y / height);
      seamError += Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
    }
    return {
      id: record.asset.id,
      causticContribution: contribution / (width * height),
      disabledContribution: disabledContribution / (width * height),
      seamError: seamError / height,
      alphaMin,
      alphaMax,
      colorSpace: record.asset.colorSpace,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedCausticValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedCausticValidation.records);
  else if (mode === "near") drawPanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near caustic projection", (u, v) => shadePool({ record: window.__generatedCausticValidation.records[0], u, v, phase: 0.25, tileScale: 2.2 }));
  else if (mode === "far") drawDiagnostics(ctx, window.__generatedCausticValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedCausticValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedCausticValidation.records);
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
  window.__generatedCausticValidation = { ready: true, records, metrics: computeMetrics(records), rendererInfo, capture };
}

init().catch((error) => {
  window.__generatedCausticValidation = { ready: false, error: error.message };
});
