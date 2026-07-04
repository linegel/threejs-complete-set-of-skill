import { WebGPURenderer } from "three/webgpu";

const WIDTH = 1200;
const HEIGHT = 760;
const ASSETS = [
  { id: "ripple-normal-a", url: "../../assets/generated-variants/ripple-normal-a.png", colorSpace: "NoColorSpace" },
  { id: "ripple-normal-b", url: "../../assets/generated-variants/ripple-normal-b.png", colorSpace: "NoColorSpace" },
  { id: "ripple-normal-c", url: "../../assets/generated-variants/ripple-normal-c.png", colorSpace: "NoColorSpace" },
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

function sampleNormal(record, u, v, tileScale = 1) {
  const { width, height, data } = record.imageData;
  const wrappedU = ((u * tileScale) % 1 + 1) % 1;
  const wrappedV = ((v * tileScale) % 1 + 1) % 1;
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (y * width + x) * 4;
  return normalize3(data[offset] / 255 * 2 - 1, data[offset + 1] / 255 * 2 - 1, data[offset + 2] / 255 * 2 - 1);
}

function smoothMask(u, v) {
  const dx = Math.sin(u * Math.PI * 3.2 + 0.4);
  const dy = Math.cos(v * Math.PI * 2.4 - 0.2);
  const flow = Math.sin((u + v) * Math.PI * 5.5);
  return clamp01((dx * 0.34 + dy * 0.33 + flow * 0.18 + 0.55 - 0.35) / 0.65);
}

function asphaltBase(u, v) {
  const cell = (Math.floor(u * 48) + Math.floor(v * 28)) % 2;
  const stripe = Math.abs(((v * 8) % 1) - 0.5) < 0.02 ? 22 : 0;
  return 24 + cell * 5 + stripe;
}

function shadeWetSurface({ record, u, v, wetness, rippleStrength, tileScale = 1, debugNormals = false }) {
  const baseNormal = [0, 0, 1];
  const ripple = record ? sampleNormal(record, u, v, tileScale) : baseNormal;
  const normalProgress = clamp01((wetness - 0.72) / 0.28);
  const normal = normalize3(
    mix(baseNormal[0], ripple[0], rippleStrength * normalProgress),
    mix(baseNormal[1], ripple[1], rippleStrength * normalProgress),
    mix(baseNormal[2], ripple[2], rippleStrength * normalProgress),
  );

  if (debugNormals) {
    return [
      Math.round((normal[0] * 0.5 + 0.5) * 255),
      Math.round((normal[1] * 0.5 + 0.5) * 255),
      Math.round((normal[2] * 0.5 + 0.5) * 255),
      255,
    ];
  }

  const light = normalize3(-0.38, -0.18, 0.91);
  const view = normalize3(0, -0.72, 0.69);
  const halfVector = normalize3(light[0] + view[0], light[1] + view[1], light[2] + view[2]);
  const diffuse = Math.max(0, dot3(normal, light));
  const specularPower = mix(24, 120, wetness);
  const specular = Math.pow(Math.max(0, dot3(normal, halfVector)), specularPower) * wetness;
  const puddle = smoothMask(u, v) * wetness;
  const base = asphaltBase(u, v);
  const rough = mix(base, 16, puddle);
  const blue = mix(rough + 6, 62, puddle * 0.42);
  const highlight = specular * 220;
  return [
    Math.round(clamp01((rough * (0.45 + diffuse * 0.55) + highlight) / 255) * 255),
    Math.round(clamp01((rough * (0.48 + diffuse * 0.6) + highlight) / 255) * 255),
    Math.round(clamp01((blue * (0.52 + diffuse * 0.62) + highlight) / 255) * 255),
    255,
  ];
}

function drawPanel(ctx, bounds, label, renderer) {
  const { x, y, w, h } = bounds;
  const image = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const u = px / Math.max(1, w - 1);
      const v = py / Math.max(1, h - 1);
      const pixel = renderer(u, v, px, py);
      const offset = (py * w + px) * 4;
      image.data[offset] = pixel[0];
      image.data[offset + 1] = pixel[1];
      image.data[offset + 2] = pixel[2];
      image.data[offset + 3] = pixel[3];
    }
  }
  ctx.putImageData(image, x, y);
  ctx.strokeStyle = "rgba(230,245,255,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(238,246,255,0.92)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(label, x + 12, y + 24);
}

function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#101417";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawFinal(ctx, records) {
  const panels = [
    ["dry baseline", null, 0, 0],
    ["wet no ripples", null, 1, 0],
    ["ripple A", records[0], 1, 1],
    ["ripple B", records[1], 1, 1],
    ["ripple C", records[2], 1, 1],
  ];
  for (const [index, [label, record, wetness, strength]] of panels.entries()) {
    drawPanel(ctx, { x: 24 + index * 234, y: 70, w: 220, h: 245 }, label, (u, v) =>
      shadeWetSurface({ record, u, v, wetness, rippleStrength: strength, tileScale: 1.6 }),
    );
  }
  for (const [index, record] of records.entries()) {
    drawPanel(ctx, { x: 82 + index * 365, y: 390, w: 310, h: 230 }, `normal debug ${record.asset.id}`, (u, v) =>
      shadeWetSurface({ record, u, v, wetness: 1, rippleStrength: 1, tileScale: 1.6, debugNormals: true }),
    );
  }
}

function drawBaseline(ctx, records) {
  const panels = [
    ["dry asphalt baseline", null, 0, 0],
    ["wet asphalt no ripple normal", null, 1, 0],
    ["wetness-gated ripple response", records[0], 1, 1],
  ];
  for (const [index, [label, record, wetness, strength]] of panels.entries()) {
    drawPanel(ctx, { x: 56 + index * 382, y: 90, w: 330, h: 260 }, label, (u, v) =>
      shadeWetSurface({ record, u, v, wetness, rippleStrength: strength, tileScale: 2.2 }),
    );
  }
  drawPanel(ctx, { x: 120, y: 440, w: 440, h: 210 }, "normal gate before wetness threshold", (u, v) =>
    shadeWetSurface({ record: records[0], u, v, wetness: 0.35, rippleStrength: 1, tileScale: 2.2, debugNormals: true }),
  );
  drawPanel(ctx, { x: 640, y: 440, w: 440, h: 210 }, "normal gate after wetness threshold", (u, v) =>
    shadeWetSurface({ record: records[0], u, v, wetness: 1, rippleStrength: 1, tileScale: 2.2, debugNormals: true }),
  );
}

function drawDiagnostics(ctx, records) {
  for (const [index, record] of records.entries()) {
    drawPanel(ctx, { x: 30 + index * 390, y: 70, w: 350, h: 250 }, `${record.asset.id} tiled seam stress`, (u, v) =>
      shadeWetSurface({ record, u, v, wetness: 1, rippleStrength: 1, tileScale: 5 }),
    );
    drawPanel(ctx, { x: 30 + index * 390, y: 390, w: 350, h: 250 }, `${record.asset.id} normal field`, (u, v) =>
      shadeWetSurface({ record, u, v, wetness: 1, rippleStrength: 1, tileScale: 5, debugNormals: true }),
    );
  }
}

function drawTemporal(ctx, records, progress) {
  drawPanel(ctx, { x: 70, y: 110, w: 500, h: 430 }, `rain progress ${progress.toFixed(2)}`, (u, v) =>
    shadeWetSurface({ record: records[0], u, v, wetness: progress, rippleStrength: 1, tileScale: 2 }),
  );
  drawPanel(ctx, { x: 630, y: 110, w: 500, h: 430 }, "normal contribution gate", (u, v) =>
    shadeWetSurface({ record: records[0], u, v, wetness: progress, rippleStrength: 1, tileScale: 2, debugNormals: true }),
  );
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function computeMetrics(records) {
  const metrics = [];
  for (const record of records) {
    let responseDelta = 0;
    let dryInfluence = 0;
    let seamError = 0;
    const width = 128;
    const height = 96;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const flatWet = shadeWetSurface({ record: null, u, v, wetness: 1, rippleStrength: 0 });
        const rippleWet = shadeWetSurface({ record, u, v, wetness: 1, rippleStrength: 1, tileScale: 3 });
        const dryFlat = shadeWetSurface({ record: null, u, v, wetness: 0, rippleStrength: 0 });
        const dryRipple = shadeWetSurface({ record, u, v, wetness: 0, rippleStrength: 1, tileScale: 3 });
        responseDelta += Math.abs(luminance(rippleWet) - luminance(flatWet));
        dryInfluence += Math.abs(luminance(dryRipple) - luminance(dryFlat));
      }
      const left = sampleNormal(record, 0.001, y / height, 1);
      const right = sampleNormal(record, 0.999, y / height, 1);
      seamError += Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
    }
    metrics.push({
      id: record.asset.id,
      wetResponseDelta: responseDelta / (width * height),
      dryInfluence: dryInfluence / (width * height),
      seamError: seamError / height,
      colorSpace: record.asset.colorSpace,
    });
  }
  return metrics;
}

async function initialize() {
  const renderer = new WebGPURenderer({ antialias: false });
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("Generated ripple validation requires renderer.backend.isWebGPUBackend === true.");
  }
  const records = await Promise.all(ASSETS.map(loadImage));
  const rendererInfo = {
    threeRevision: "185",
    renderer: "WebGPURenderer",
    isPrimaryBackend: true,
    coordinateSystem: renderer.coordinateSystem ?? null,
    initialized: renderer.initialized === true,
    outputBufferType: typeof renderer.getOutputBufferType === "function" ? renderer.getOutputBufferType() : null,
    compatibilityMode: renderer.backend?.compatibilityMode ?? null,
    trackTimestamp: renderer.backend?.trackTimestamp ?? null,
    features: renderer.backend?.device?.features ? [...renderer.backend.device.features] : null,
    limits: renderer.backend?.device?.limits ? { ...renderer.backend.device.limits } : null,
    unavailableReason: null,
    info: renderer.info,
  };
  window.__generatedRippleValidation = {
    ready: true,
    assets: ASSETS,
    metrics: computeMetrics(records),
    rendererInfo,
    async capture(state) {
      const { canvas, ctx } = makeCanvas();
      if (state.mode === "diagnostics") drawDiagnostics(ctx, records);
      else if (state.mode === "baseline") drawBaseline(ctx, records);
      else if (state.mode === "temporal") drawTemporal(ctx, records, state.progress ?? 1);
      else if (state.mode === "near") {
        drawPanel(ctx, { x: 170, y: 80, w: 860, h: 580 }, "grazing wet asphalt with ripple-normal-a", (u, v) =>
          shadeWetSurface({ record: records[0], u, v, wetness: 1, rippleStrength: 1, tileScale: 3.5 }),
        );
      } else if (state.mode === "far") drawDiagnostics(ctx, records);
      else drawFinal(ctx, records);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data),
      };
    },
  };
}

initialize().catch((error) => {
  window.__generatedRippleValidation = { ready: false, error: error.message };
});
