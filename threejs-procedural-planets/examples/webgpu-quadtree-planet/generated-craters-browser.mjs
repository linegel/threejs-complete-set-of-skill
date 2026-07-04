import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "crater-mask-a", url: "../../assets/generated-variants/crater-mask-a.png", colorSpace: "NoColorSpace" },
  { id: "crater-mask-b", url: "../../assets/generated-variants/crater-mask-b.png", colorSpace: "NoColorSpace" },
  { id: "crater-mask-c", url: "../../assets/generated-variants/crater-mask-c.png", colorSpace: "NoColorSpace" },
];

const clamp01 = (value) => Math.min(1, Math.max(0, value));

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

function sampleMask(record, u, v) {
  const { width, height, data } = record.imageData;
  const wrappedU = ((u % 1) + 1) % 1;
  const wrappedV = ((v % 1) + 1) % 1;
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

function sphereUv(normal) {
  const u = Math.atan2(normal[2], normal[0]) / (Math.PI * 2) + 0.5;
  const v = Math.asin(clamp01(normal[1] * 0.5 + 0.5) * 2 - 1) / Math.PI + 0.5;
  return [u, v];
}

function craterSignal(record, normal, stress = 1) {
  const [u, v] = sphereUv(normal);
  const [floor, rim, ejecta, age] = sampleMask(record, u * stress, v * stress);
  const relief = rim * 0.16 + ejecta * 0.07 - floor * 0.13;
  const albedo = [
    72 + floor * 28 + ejecta * 58 + age * 14,
    68 + floor * 22 + ejecta * 46 + age * 10,
    62 + floor * 18 + ejecta * 34 + age * 18,
  ];
  return { floor, rim, ejecta, age, relief, albedo };
}

function shadePlanet(record, sx, sy, radius, stress = 1, diagnostic = null) {
  const nx = sx / radius;
  const ny = sy / radius;
  const rr = nx * nx + ny * ny;
  if (rr > 1) return [8, 11, 15, 255];
  const nz = Math.sqrt(1 - rr);
  const normal = normalize3(nx, ny, nz);
  const signal = craterSignal(record, normal, stress);

  if (diagnostic === "channels") {
    return [
      Math.round(signal.floor * 255),
      Math.round(signal.rim * 255),
      Math.round(signal.ejecta * 255),
      255,
    ];
  }
  if (diagnostic === "age") {
    const age = Math.round(signal.age * 255);
    return [age, age, age, 255];
  }
  if (diagnostic === "relief") {
    const value = Math.round(clamp01(signal.relief * 2 + 0.5) * 255);
    return [value, value, value, 255];
  }

  const displaced = normalize3(normal[0] * (1 + signal.relief), normal[1] * (1 + signal.relief), normal[2]);
  const light = normalize3(-0.45, 0.36, 0.82);
  const shade = 0.26 + Math.max(0, dot3(displaced, light)) * 0.86;
  const rimHighlight = signal.rim * 46;
  return [
    Math.round(clamp01((signal.albedo[0] * shade + rimHighlight) / 255) * 255),
    Math.round(clamp01((signal.albedo[1] * shade + rimHighlight) / 255) * 255),
    Math.round(clamp01((signal.albedo[2] * shade + rimHighlight) / 255) * 255),
    255,
  ];
}

function drawPanel(ctx, bounds, label, renderer) {
  const { x, y, w, h } = bounds;
  const image = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const pixel = renderer(px, py, px / Math.max(1, w - 1), py / Math.max(1, h - 1));
      const offset = (py * w + px) * 4;
      image.data[offset] = pixel[0];
      image.data[offset + 1] = pixel[1];
      image.data[offset + 2] = pixel[2];
      image.data[offset + 3] = pixel[3];
    }
  }
  ctx.putImageData(image, x, y);
  ctx.strokeStyle = "rgba(226,235,245,0.38)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(240,246,255,0.94)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(label, x + 12, y + 25);
}

function makeCanvas() {
  const canvas = document.getElementById("validation-canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#080b0f";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawSpherePanel(ctx, bounds, label, record, stress = 1, diagnostic = null) {
  const radius = Math.min(bounds.w, bounds.h) * 0.43;
  drawPanel(ctx, bounds, label, (px, py) => {
    const sx = px - bounds.w * 0.5;
    const sy = bounds.h * 0.5 - py;
    return shadePlanet(record, sx, sy, radius, stress, diagnostic);
  });
}

function drawFinal(ctx, records) {
  records.forEach((record, index) => {
    drawSpherePanel(ctx, { x: 42 + index * 384, y: 74, w: 342, h: 330 }, `${record.asset.id} spherical projection`, record);
  });
  records.forEach((record, index) => {
    drawSpherePanel(ctx, { x: 90 + index * 360, y: 442, w: 260, h: 238 }, `${record.asset.id} relief`, record, 1, "relief");
  });
}

function drawBaseline(ctx, records) {
  drawPanel(ctx, { x: 80, y: 92, w: 310, h: 300 }, "flat reduced-tier sphere", (px, py) => {
    const radius = 125;
    const nx = (px - 155) / radius;
    const ny = (150 - py) / radius;
    const rr = nx * nx + ny * ny;
    if (rr > 1) return [8, 11, 15, 255];
    const nz = Math.sqrt(1 - rr);
    const shade = 0.25 + Math.max(0, dot3(normalize3(nx, ny, nz), normalize3(-0.45, 0.36, 0.82))) * 0.86;
    const value = Math.round(86 * shade);
    return [value, value - 4, value - 10, 255];
  });
  drawSpherePanel(ctx, { x: 450, y: 92, w: 310, h: 300 }, "crater mask response", records[0]);
  drawSpherePanel(ctx, { x: 820, y: 92, w: 310, h: 300 }, "age/noise alpha channel", records[0], 1, "age");
  drawSpherePanel(ctx, { x: 260, y: 450, w: 300, h: 230 }, "floor/rim/ejecta channels", records[0], 1, "channels");
  drawSpherePanel(ctx, { x: 640, y: 450, w: 300, h: 230 }, "signed relief diagnostic", records[0], 1, "relief");
}

function drawDiagnostics(ctx, records) {
  records.forEach((record, index) => {
    drawSpherePanel(ctx, { x: 35 + index * 390, y: 70, w: 350, h: 260 }, `${record.asset.id} channel RGB`, record, 1, "channels");
    drawSpherePanel(ctx, { x: 35 + index * 390, y: 400, w: 350, h: 260 }, `${record.asset.id} seam stress`, record, 4);
  });
}

function drawTemporal(ctx, records, phase) {
  const stress = 1 + phase * 0.85;
  drawSpherePanel(ctx, { x: 135, y: 110, w: 400, h: 400 }, `view phase ${phase.toFixed(2)}`, records[0], stress);
  drawSpherePanel(ctx, { x: 665, y: 110, w: 400, h: 400 }, "relief remains mask-tied", records[0], stress, "relief");
}

function computeMetrics(records) {
  return records.map((record) => {
    let floor = 0;
    let rim = 0;
    let ejecta = 0;
    let rimFloorAbsDelta = 0;
    let ageMin = 1;
    let ageMax = 0;
    let seamError = 0;
    const samples = 96;
    for (let y = 0; y < samples; y++) {
      for (let x = 0; x < samples; x++) {
        const u = x / (samples - 1);
        const v = y / (samples - 1);
        const [f, r, e, a] = sampleMask(record, u, v);
        floor += f;
        rim += r;
        ejecta += e;
        rimFloorAbsDelta += Math.abs(r - f);
        ageMin = Math.min(ageMin, a);
        ageMax = Math.max(ageMax, a);
      }
      const left = sampleMask(record, 0.001, y / samples);
      const right = sampleMask(record, 0.999, y / samples);
      seamError += Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]) + Math.abs(left[3] - right[3]);
    }
    const denom = samples * samples;
    return {
      id: record.asset.id,
      floorMean: floor / denom,
      rimMean: rim / denom,
      ejectaMean: ejecta / denom,
      alphaRange: ageMax - ageMin,
      rimFloorDelta: rimFloorAbsDelta / denom,
      seamError: seamError / samples,
      colorSpace: record.asset.colorSpace,
      reducedTierOnly: true,
    };
  });
}

function capture(state = {}) {
  const { canvas, ctx } = makeCanvas();
  const mode = state.mode ?? "final";
  if (mode === "baseline") drawBaseline(ctx, window.__generatedCraterValidation.records);
  else if (mode === "diagnostics") drawDiagnostics(ctx, window.__generatedCraterValidation.records);
  else if (mode === "near") drawSpherePanel(ctx, { x: 260, y: 70, w: 680, h: 620 }, "near crater channel response", window.__generatedCraterValidation.records[0], 1.5);
  else if (mode === "far") drawFinal(ctx, window.__generatedCraterValidation.records);
  else if (mode === "temporal") drawTemporal(ctx, window.__generatedCraterValidation.records, state.phase ?? 0);
  else drawFinal(ctx, window.__generatedCraterValidation.records);
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
    rendererInfo = {
      threeRevision: "185",
      renderer: "WebGPURenderer",
      initialized: false,
      isPrimaryBackend: false,
      coordinateSystem: null,
      outputBufferType: null,
      compatibilityMode: false,
      trackTimestamp: false,
      unavailableReason: error.message,
      features: [],
      limits: {},
      info: renderer.info ?? {},
    };
  }
  const records = await Promise.all(ASSETS.map(loadImage));
  window.__generatedCraterValidation = {
    ready: true,
    records,
    metrics: computeMetrics(records),
    rendererInfo,
    capture,
  };
}

init().catch((error) => {
  window.__generatedCraterValidation = { ready: false, error: error.message };
});
