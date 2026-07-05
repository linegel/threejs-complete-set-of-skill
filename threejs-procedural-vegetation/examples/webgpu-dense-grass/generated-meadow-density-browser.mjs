import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "meadow-density-a", url: "../../assets/generated-variants/meadow-density-a.png", colorSpace: "NoColorSpace" },
  { id: "meadow-density-b", url: "../../assets/generated-variants/meadow-density-b.png", colorSpace: "NoColorSpace" },
  { id: "meadow-density-c", url: "../../assets/generated-variants/meadow-density-c.png", colorSpace: "NoColorSpace" },
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

function sampleMask(record, u, v, phase = 0, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = (((u + phase * 0.012) * tileScale) % 1 + 1) % 1;
  const wrappedV = (((v - phase * 0.009) * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, data[offset + 3] / 255];
}

function meadowPixel({ record, u, v, phase = 0, tileScale = 1, useMask = true, diagnostic = null }) {
  const [densityChannel, pathChannel, clumpChannel, flowerChannel] = record && useMask ? sampleMask(record, u, v, phase, tileScale) : [0.62, 0.08, 0.42, 0.08];
  const pathClear = clamp01((pathChannel - 0.2) * 1.45);
  const clump = clamp01(Math.pow(clumpChannel, 0.72));
  const density = clamp01((densityChannel * (0.54 + clump * 0.7) - pathClear * 0.82) * 1.22);
  const bladeHeight = clamp01(0.26 + density * 0.62 + clump * 0.18);
  const lod = density > 0.72 ? 1 : density > 0.36 ? 0.55 : 0.16;
  const flower = clamp01(flowerChannel * density * (1 - pathClear));
  const wind = clamp01(0.5 + Math.sin((u * 16 + v * 8 + phase * 5) + clump * 4) * 0.32);

  if (diagnostic === "channels") return [Math.round(densityChannel * 255), Math.round(pathChannel * 255), Math.round(clumpChannel * 255), 255];
  if (diagnostic === "alpha") return [Math.round(flowerChannel * 255), Math.round(flower * 255), Math.round(pathClear * 255), 255];
  if (diagnostic === "density") return [Math.round(density * 255), Math.round(lod * 255), Math.round(wind * 255), 255];
  if (diagnostic === "placement") {
    const blades = (Math.floor(u * 92) + Math.floor(v * 64)) % 7 === 0 && density > 0.32;
    const flowers = (Math.floor(u * 120 + v * 31) % 29 === 0) && flower > 0.18;
    if (flowers) return [245, 205, 75, 255];
    if (blades) return [82 + Math.round(clump * 50), 170 + Math.round(density * 70), 62, 255];
    return [34 + Math.round(pathClear * 45), 72 + Math.round(density * 40), 40, 255];
  }

  const soil = [52 + pathClear * 42, 58 + pathClear * 30, 38 + pathClear * 18];
  const grass = [40 + clump * 55, 116 + density * 110, 40 + wind * 35];
  const flowerTint = [230 + flower * 25, 198 + flower * 35, 72 + flower * 90];
  const base = [
    mix(soil[0], grass[0], density),
    mix(soil[1], grass[1], density),
    mix(soil[2], grass[2], density),
  ];
  return [
    Math.round(mix(base[0], flowerTint[0], flower * 0.35)),
    Math.round(mix(base[1], flowerTint[1], flower * 0.35)),
    Math.round(mix(base[2], flowerTint[2], flower * 0.35)),
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
  ctx.strokeStyle = "rgba(226,255,204,0.38)";
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
  ctx.fillStyle = "#071009";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  drawPanel(ctx, { x: 35, y: 70, w: 250, h: 255 }, "uniform meadow baseline", (u, v) => meadowPixel({ record: records[0], u, v, useMask: false }));
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 315 + index * 285, y: 70, w: 250, h: 255 }, `${record.asset.id} meadow`, (u, v) => meadowPixel({ record, u, v, phase: 0.1, tileScale: 1.1 }));
  });
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 82 + index * 365, y: 410, w: 310, h: 230 }, `${record.asset.id} placement`, (u, v) => meadowPixel({ record, u, v, phase: 0.1, tileScale: 1.1, diagnostic: "placement" }));
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 70, y: 92, w: 330, h: 280 }, "uniform blade field", (u, v) => meadowPixel({ record: records[0], u, v, useMask: false }));
  drawPanel(ctx, { x: 435, y: 92, w: 330, h: 280 }, "mask-shaped meadow", (u, v) => meadowPixel({ record: records[0], u, v }));
  drawPanel(ctx, { x: 800, y: 92, w: 330, h: 280 }, "density/lod/wind", (u, v) => meadowPixel({ record: records[0], u, v, diagnostic: "density" }));
  drawPanel(ctx, { x: 215, y: 445, w: 330, h: 210 }, "R/G/B density path clump", (u, v) => meadowPixel({ record: records[0], u, v, diagnostic: "channels" }));
  drawPanel(ctx, { x: 655, y: 445, w: 330, h: 210 }, "A flower/path response", (u, v) => meadowPixel({ record: records[0], u, v, diagnostic: "alpha" }));
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawPanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} RGB masks`, (u, v) => meadowPixel({ record, u, v, tileScale: 2, diagnostic: "channels" }));
    drawPanel(ctx, { x: 35 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} alpha flowers`, (u, v) => meadowPixel({ record, u, v, tileScale: 2, diagnostic: "alpha" }));
  });
}

function drawTemporal(ctx, records, phase) {
  drawPanel(ctx, { x: 100, y: 120, w: 460, h: 420 }, `wind phase ${phase.toFixed(2)}`, (u, v) => meadowPixel({ record: records[0], u, v, phase, tileScale: 1.25 }));
  drawPanel(ctx, { x: 640, y: 120, w: 460, h: 420 }, "placement remains mask-tied", (u, v) => meadowPixel({ record: records[0], u, v, phase, tileScale: 1.25, diagnostic: "placement" }));
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  return records.map((record) => {
    let meadowDelta = 0;
    let pathClearing = 0;
    let flowerResponse = 0;
    let densityRange = { min: 1, max: 0 };
    let alphaMin = 1;
    let alphaMax = 0;
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const baseline = meadowPixel({ record, u, v, useMask: false });
        const meadow = meadowPixel({ record, u, v });
        const density = meadowPixel({ record, u, v, diagnostic: "density" })[0] / 255;
        const [densityChannel, pathChannel, , flowerChannel] = sampleMask(record, u, v);
        meadowDelta += Math.abs(luminance(meadow) - luminance(baseline));
        pathClearing += Math.max(0, pathChannel - 0.2) * densityChannel;
        flowerResponse += flowerChannel * densityChannel * Math.max(0, 1 - pathChannel);
        densityRange.min = Math.min(densityRange.min, density);
        densityRange.max = Math.max(densityRange.max, density);
        alphaMin = Math.min(alphaMin, flowerChannel);
        alphaMax = Math.max(alphaMax, flowerChannel);
      }
    }
    return {
      id: record.asset.id,
      meadowDelta: meadowDelta / (width * height),
      pathClearing: pathClearing / (width * height),
      flowerResponse: flowerResponse / (width * height),
      densityRange: densityRange.max - densityRange.min,
      alphaMin,
      alphaMax,
      colorSpace: record.asset.colorSpace,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedMeadowValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedMeadowValidation.records);
  else if (mode === "near") drawPanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near meadow density/path/flower response", (u, v) => meadowPixel({ record: window.__generatedMeadowValidation.records[0], u, v, phase: 0.12, tileScale: 1.8 }));
  else if (mode === "far") drawFinal(ctx, window.__generatedMeadowValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedMeadowValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedMeadowValidation.records);
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
  window.__generatedMeadowValidation = { ready: true, records, metrics: computeMetrics(records), rendererInfo, capture };
}

init().catch((error) => {
  window.__generatedMeadowValidation = { ready: false, error: error.message };
});
