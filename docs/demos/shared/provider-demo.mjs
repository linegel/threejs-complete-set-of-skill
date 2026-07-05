import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const asset = (name) => new URL(`./generated-variants/${name}`, import.meta.url).href;

const DEMOS = {
  "ambient-contact-shading-demo": {
    title: "Ambient Contact Shading Lab",
    skill: "$threejs-ambient-contact-shading",
    claim: "Live directional demo: contact visibility grounds ambient light while direct light and emissive terms remain readable.",
    variants: [
      ["balanced-contact"],
      ["tight-crevices"],
      ["wide-indirect"],
    ],
    modes: [
      ["final", "Final"],
      ["no-ao", "AO Off"],
      ["ao-debug", "AO Debug"],
    ],
    camera: [5.2, 3.7, 6.3],
    target: [0, 0.65, 0],
    factory: createAmbientContactScene,
    evidenceHref: "../../skills/threejs-ambient-contact-shading.html",
    evidenceLabel: "Skill Contract",
  },
  "selective-bloom-demo": {
    title: "Selective HDR Bloom Bench",
    skill: "$threejs-bloom",
    claim: "Live directional demo: emissive signal is isolated from readable base materials before the bloom response is added back.",
    variants: [
      ["warm-filament"],
      ["cyan-plasma"],
      ["mixed-signage"],
    ],
    modes: [
      ["final", "Final"],
      ["base-only", "Base Only"],
      ["bloom-only", "Bloom Only"],
    ],
    camera: [5.6, 3.1, 6.1],
    target: [0, 0.75, 0],
    factory: createBloomScene,
    evidenceHref: "../../skills/threejs-bloom.html",
    evidenceLabel: "Skill Contract",
  },
  "exposure-color-grading-demo": {
    title: "Scene-Referred Exposure Rig",
    skill: "$threejs-exposure-color-grading",
    claim: "Live directional demo: an HDR meter drives asymmetric exposure adaptation before tone-map-domain grading.",
    variants: [
      ["gray-card"],
      ["bright-window"],
      ["emitter-sweep"],
    ],
    modes: [
      ["final", "Final"],
      ["identity-lut", "Identity LUT"],
      ["meter-debug", "Meter Debug"],
    ],
    camera: [5.0, 2.8, 6.2],
    target: [0, 0.85, -0.6],
    factory: createExposureScene,
    evidenceHref: "../../skills/threejs-exposure-color-grading.html",
    evidenceLabel: "Skill Contract",
  },
  "image-pipeline-framegraph-demo": {
    title: "Shared Signal Framegraph",
    skill: "$threejs-image-pipeline",
    claim: "Live directional demo: one scene pass feeds owned color, depth, normal, emissive, and velocity-style signal views.",
    variants: [
      ["beauty-frame"],
      ["velocity-stress"],
      ["diagnostic-heavy"],
    ],
    modes: [
      ["final", "Final"],
      ["signals", "Signals"],
      ["bypass-post", "Bypass Post"],
    ],
    camera: [5.8, 3.8, 6.6],
    target: [0, 0.75, 0],
    factory: createImagePipelineScene,
    evidenceHref: "../../skills/threejs-image-pipeline.html",
    evidenceLabel: "Skill Contract",
  },
  "shadow-cascade-demo": {
    title: "Scalable Shadow Coverage",
    skill: "$threejs-scalable-real-time-shadows",
    claim: "Live directional demo: bounded, cascade-style, and cached-budget views expose coverage, update scope, and bias pressure.",
    variants: [
      ["bounded-yard"],
      ["cascade-run"],
      ["cached-coarse"],
    ],
    modes: [
      ["final", "Final"],
      ["cascade-debug", "Cascade Debug"],
      ["single-map", "Single Map"],
    ],
    camera: [6.4, 4.6, 7.4],
    target: [0, 0.6, 0],
    factory: createShadowScene,
    evidenceHref: "../../skills/threejs-scalable-real-time-shadows.html",
    evidenceLabel: "Skill Contract",
  },
  "sky-atmosphere-haze-demo": {
    title: "Atmosphere And Haze Stack",
    skill: "$threejs-sky-atmosphere-and-haze",
    claim: "Live directional demo: shared sky, sun, depth haze, and LUT diagnostic views preserve one atmosphere parameter model.",
    variants: [
      ["sea-level"],
      ["mountain-air"],
      ["low-orbit"],
    ],
    modes: [
      ["final", "Final"],
      ["no-haze", "No Haze"],
      ["lut-debug", "LUT Debug"],
    ],
    camera: [6.0, 3.4, 6.8],
    target: [0, 0.9, -0.8],
    factory: createSkyAtmosphereScene,
    evidenceHref: "../../skills/threejs-sky-atmosphere-and-haze.html",
    evidenceLabel: "Skill Contract",
  },
  "camera-rig-handoff-demo": {
    title: "Scale-Aware Camera Rig",
    skill: "$threejs-camera-controls-and-rigs",
    claim: "Live directional demo: one camera owner derives chase, side, and handoff poses from subject scale and projection envelopes.",
    variants: [
      ["compact-drone"],
      ["long-ship"],
      ["large-world"],
    ],
    modes: [
      ["final", "Chase"],
      ["side", "Side Rig"],
      ["handoff", "Handoff"],
    ],
    camera: [0, 2.2, 7.2],
    target: [0, 0.7, 0],
    factory: createCameraRigScene,
    evidenceHref: "../../skills/threejs-camera-controls-and-rigs.html",
    evidenceLabel: "Skill Contract",
  },
  "procedural-motion-timeline-demo": {
    title: "Procedural Motion Timeline",
    skill: "$threejs-procedural-motion-systems",
    claim: "Live directional demo: named phases drive analytic launch, staging, docking, and debris motion without frame-count state.",
    variants: [
      ["launch-staging"],
      ["spin-docking"],
      ["debris-release"],
    ],
    modes: [
      ["final", "Final"],
      ["phase-debug", "Phase Debug"],
      ["replay-slice", "Replay Slice"],
    ],
    camera: [6.8, 3.8, 7.2],
    target: [0, 1.1, 0],
    factory: createProceduralMotionScene,
    evidenceHref: "../../skills/threejs-procedural-motion-systems.html",
    evidenceLabel: "Skill Contract",
  },
  "pooled-particles-effects-demo": {
    title: "Pooled Particles And Trails",
    skill: "$threejs-particles-trails-and-effects",
    claim: "Live directional demo: seeded event packets feed a dense visual pool with shell, wake, spark, and bloom-isolated views.",
    variants: [
      ["reentry-plasma"],
      ["impact-sparks"],
      ["debris-dissolve"],
    ],
    modes: [
      ["final", "Final"],
      ["pool-debug", "Pool Debug"],
      ["bloom-off", "Bloom Off"],
    ],
    camera: [5.7, 3.2, 6.4],
    target: [0, 0.75, 0],
    factory: createPooledParticlesScene,
    evidenceHref: "../../skills/threejs-particles-trails-and-effects.html",
    evidenceLabel: "Skill Contract",
  },
  "procedural-geometry-writer-demo": {
    title: "Semantic Mesh Writer Bench",
    skill: "$threejs-procedural-geometry",
    claim: "Live directional demo: semantic dimensions, material groups, hard-edge duplication, and LOD tiers drive inspectable generated geometry.",
    variants: [
      ["hero-profile"],
      ["standard-profile"],
      ["crowd-profile"],
    ],
    modes: [
      ["final", "Final"],
      ["groups", "Groups"],
      ["wire", "Wire"],
    ],
    camera: [5.8, 3.4, 6.2],
    target: [0, 0.75, 0],
    factory: createProceduralGeometryScene,
    evidenceHref: "../../skills/threejs-procedural-geometry.html",
    evidenceLabel: "Skill Contract",
  },
  "water-generated-caustics": {
    title: "Bounded Water Caustic Projection",
    skill: "$threejs-water-optics",
    claim: "Live directional demo: generated caustic fields are scene inputs for bounded-water floor projection.",
    variants: [
      ["caustic-field-a", asset("caustic-field-a.png")],
      ["caustic-field-b", asset("caustic-field-b.png")],
      ["caustic-field-c", asset("caustic-field-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["no-caustics", "No Caustics"],
      ["diagnostic", "Diagnostic"],
    ],
    camera: [5.4, 4.2, 6.8],
    target: [0, 0, 0],
    factory: createWaterScene,
  },
  "rain-generated-ripples": {
    title: "Wet Surface Ripple Normals",
    skill: "$threejs-rain-snow-and-wet-surfaces",
    claim: "Live directional demo: generated ripple normals are scene inputs for wet-surface lighting response.",
    variants: [
      ["ripple-normal-a", asset("ripple-normal-a.png")],
      ["ripple-normal-b", asset("ripple-normal-b.png")],
      ["ripple-normal-c", asset("ripple-normal-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["wet-baseline", "Wet Baseline"],
      ["normal-debug", "Normal Debug"],
    ],
    camera: [4.8, 3.2, 5.7],
    target: [0, 0, 0],
    factory: createRainScene,
  },
  "planet-generated-craters": {
    title: "Reduced-Tier Crater Mask Planet",
    skill: "$threejs-procedural-planets",
    claim: "Live directional demo: generated crater mask channels are scene inputs for sphere relief and material response.",
    variants: [
      ["crater-mask-a", asset("crater-mask-a.png")],
      ["crater-mask-b", asset("crater-mask-b.png")],
      ["crater-mask-c", asset("crater-mask-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["flat", "Flat"],
      ["diagnostic", "Diagnostic"],
    ],
    camera: [0, 2.2, 6.4],
    target: [0, 0, 0],
    factory: createPlanetScene,
  },
  "cloud-generated-weather-maps": {
    title: "Weather Map Cloud Layers",
    skill: "$threejs-volumetric-clouds",
    claim: "Live directional demo: generated weather maps are scene inputs for layered cloud density and erosion response.",
    variants: [
      ["weather-map-a", asset("weather-map-a.png")],
      ["weather-map-b", asset("weather-map-b.png")],
      ["weather-map-c", asset("weather-map-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["weather-debug", "Weather Debug"],
      ["shell-slice", "Shell Slice"],
    ],
    camera: [6.5, 4.2, 7.4],
    target: [0, 0.9, 0],
    factory: createCloudScene,
  },
  "fields-generated-biome-maps": {
    title: "Biome Field Terrain",
    skill: "$threejs-procedural-fields",
    claim: "Live directional demo: generated biome fields are scene inputs for shared terrain height, placement, and material response.",
    variants: [
      ["biome-field-a", asset("biome-field-a.png")],
      ["biome-field-b", asset("biome-field-b.png")],
      ["biome-field-c", asset("biome-field-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["flat", "Flat"],
      ["channel-debug", "Channel Debug"],
    ],
    camera: [5.8, 4.4, 6.2],
    target: [0, 0, 0],
    factory: createFieldScene,
  },
  "frost-generated-crystals": {
    title: "Frost Crystal Surface",
    skill: "$threejs-dynamic-surface-effects",
    claim: "Live directional demo: generated crystal fields are scene inputs for frosted structure, refraction tint, and thaw diagnostics.",
    variants: [
      ["frost-crystal-a", asset("frost-crystal-a.png")],
      ["frost-crystal-b", asset("frost-crystal-b.png")],
      ["frost-crystal-c", asset("frost-crystal-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["structure", "Structure"],
      ["thaw-band", "Thaw Band"],
    ],
    camera: [4.6, 4.0, 5.8],
    target: [0, 0, 0],
    factory: createFrostScene,
  },
  "materials-generated-lava-causes": {
    title: "Lava Cause Material",
    skill: "$threejs-procedural-materials",
    claim: "Live directional demo: generated lava cause maps are scene inputs for PBR crust, roughness, normal relief, and raw emissive response.",
    variants: [
      ["lava-cause-a", asset("lava-cause-a.png")],
      ["lava-cause-b", asset("lava-cause-b.png")],
      ["lava-cause-c", asset("lava-cause-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["cool-crust", "Cool Crust"],
      ["raw-emissive", "Raw Emissive"],
    ],
    camera: [4.9, 3.7, 5.2],
    target: [0, 0, 0],
    factory: createLavaScene,
  },
  "ocean-generated-wave-seeds": {
    title: "Directional Wave Seed Surface",
    skill: "$threejs-spectral-ocean",
    claim: "Live directional demo: generated directional wave seeds are scene inputs for reduced-tier displacement and slope diagnostics.",
    variants: [
      ["directional-wave-seed-a", asset("directional-wave-seed-a.png")],
      ["directional-wave-seed-b", asset("directional-wave-seed-b.png")],
      ["directional-wave-seed-c", asset("directional-wave-seed-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["calm", "Calm"],
      ["slope-debug", "Slope Debug"],
    ],
    camera: [6.8, 4.6, 7.2],
    target: [0, 0, 0],
    factory: createOceanScene,
  },
  "space-generated-starfields": {
    title: "Curved-Ray Starfield Preview",
    skill: "$threejs-black-holes-and-space-effects",
    claim: "Live directional demo: generated star tiles are scene inputs for a repeatable background around a bounded lensing proxy.",
    variants: [
      ["starfield-tile-a", asset("starfield-tile-a.png")],
      ["starfield-tile-b", asset("starfield-tile-b.png")],
      ["starfield-tile-c", asset("starfield-tile-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["no-lens", "No Lens"],
      ["star-debug", "Star Debug"],
    ],
    camera: [0, 1.0, 7.2],
    target: [0, 0, 0],
    factory: createSpaceScene,
  },
  "vegetation-generated-meadow-density": {
    title: "Meadow Density Placement",
    skill: "$threejs-procedural-vegetation",
    claim: "Live directional demo: generated meadow density maps are scene inputs for placement, path clearing, flower tint, and LOD response.",
    variants: [
      ["meadow-density-a", asset("meadow-density-a.png")],
      ["meadow-density-b", asset("meadow-density-b.png")],
      ["meadow-density-c", asset("meadow-density-c.png")],
    ],
    modes: [
      ["final", "Final"],
      ["density-debug", "Density Debug"],
      ["low-lod", "Low LOD"],
    ],
    camera: [5.2, 3.4, 6.0],
    target: [0, 0, 0],
    factory: createMeadowScene,
  },
};

const state = {
  mode: "final",
  variant: 0,
  ready: false,
  time: 0,
};

const canvas = document.querySelector("#demo-canvas");
const statusEl = document.querySelector("#demo-status");
const titleEl = document.querySelector("#demo-title");
const skillEl = document.querySelector("#demo-skill");
const claimEl = document.querySelector("#demo-claim");
const controlsEl = document.querySelector("#demo-controls");
const evidenceEl = document.querySelector("#demo-evidence");
const demoId = document.body.dataset.demo;
const config = DEMOS[demoId];

if (!config) {
  setStatus(`Unknown demo id: ${demoId}`, "error");
  throw new Error(`Unknown provider demo id: ${demoId}`);
}

titleEl.textContent = config.title;
skillEl.textContent = config.skill;
claimEl.textContent = config.claim;
evidenceEl.href = new URL(config.evidenceHref ?? `../../visual-validation/${demoId}/final.design.png`, import.meta.url).href;
evidenceEl.textContent = config.evidenceLabel ?? "QA evidence frame";

const textureLoader = new THREE.TextureLoader();

function setStatus(message, dataState = "") {
  statusEl.textContent = message;
  if (dataState) statusEl.dataset.state = dataState;
  else delete statusEl.dataset.state;
}

function createModeButtons(sceneApi) {
  controlsEl.replaceChildren();
  for (const [mode, label] of config.modes) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(mode === state.mode));
    button.addEventListener("click", () => {
      state.mode = mode;
      sceneApi.setMode(mode);
      for (const child of controlsEl.querySelectorAll("button[data-mode]")) {
        child.setAttribute("aria-pressed", String(child.dataset.mode === mode));
      }
    });
    button.dataset.mode = mode;
    controlsEl.append(button);
  }

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Variant");
  config.variants.forEach(([name], index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = name;
    select.append(option);
  });
  select.addEventListener("change", () => {
    state.variant = Number(select.value);
    sceneApi.setVariant(state.variant);
  });
  controlsEl.append(select);

  const evidence = document.createElement("a");
  evidence.className = "pill";
  evidence.href = evidenceEl.href;
  evidence.textContent = config.evidenceLabel ?? "QA Evidence";
  controlsEl.append(evidence);
}

async function loadTexture(url, { data = false, repeat = [1, 1] } = {}) {
  const texture = await textureLoader.loadAsync(url);
  texture.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

async function loadVariantTextures({ data = true, repeat = [1, 1] } = {}) {
  return Promise.all(config.variants.map(([, url]) => loadTexture(url, { data, repeat })));
}

function makeGridTexture() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#154a55";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 64) {
    for (let x = 0; x < size; x += 64) {
      const v = ((x / 64 + y / 64) % 2) * 10;
      ctx.fillStyle = `rgb(${18 + v}, ${71 + v}, ${80 + v})`;
      ctx.fillRect(x, y, 64, 64);
    }
  }
  ctx.strokeStyle = "rgba(210, 245, 255, 0.28)";
  ctx.lineWidth = 3;
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

function makeAsphaltTexture() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = ((x * 17 + y * 31 + ((x * y) % 97)) % 29) - 14;
      const stripe = Math.abs(((y / 52) % 1) - 0.5) < 0.018 ? 22 : 0;
      const offset = (y * size + x) * 4;
      const base = 34 + n + stripe;
      image.data[offset] = base;
      image.data[offset + 1] = base + 3;
      image.data[offset + 2] = base + 8;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 4);
  return texture;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xb7d7ff, 0x1f2026, 1.8));
  const sun = new THREE.DirectionalLight(0xfff2c7, 4.0);
  sun.position.set(-4, 7, 5);
  scene.add(sun);
}

function makeGroundTexture({ base = "#29302b", line = "rgba(255,255,255,0.16)" } = {}) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function makeTransparentDiscTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.85)");
  gradient.addColorStop(0.52, "rgba(130, 220, 255, 0.28)");
  gradient.addColorStop(1, "rgba(130, 220, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeDarkDiscTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.72)");
  gradient.addColorStop(0.42, "rgba(0, 0, 0, 0.38)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeGlowDiscTexture(core = "rgba(255, 210, 120, 0.96)", rim = "rgba(255, 145, 55, 0)") {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 5, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, core);
  gradient.addColorStop(0.28, core.replace("0.96", "0.48"));
  gradient.addColorStop(1, rim);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeBandTexture(stops) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const grain = ((x * 13 + y * 17 + (x * y) % 37) % 15) - 7;
      image.data[offset] = Math.max(0, Math.min(255, image.data[offset] + grain));
      image.data[offset + 1] = Math.max(0, Math.min(255, image.data[offset + 1] + grain));
      image.data[offset + 2] = Math.max(0, Math.min(255, image.data[offset + 2] + grain));
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSignalTexture(kind) {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const offset = (y * size + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      if (kind === "normal") {
        r = Math.floor(65 + u * 165);
        g = Math.floor(60 + (1 - v) * 160);
        b = Math.floor(185 + Math.sin((u + v) * Math.PI) * 50);
      } else if (kind === "depth") {
        const d = Math.floor(24 + (1 - v) * 205);
        r = d;
        g = d;
        b = d + Math.floor(u * 18);
      } else if (kind === "emissive") {
        const stripe = Math.abs(Math.sin((u * 5.2 + v * 2.1) * Math.PI)) ** 18;
        r = Math.floor(20 + stripe * 235);
        g = Math.floor(28 + stripe * 142);
        b = Math.floor(42 + stripe * 60);
      } else if (kind === "velocity") {
        const line = Math.abs(((x + y * 0.55) % 48) - 24) < 2 ? 1 : 0;
        r = Math.floor(28 + line * 210 + u * 50);
        g = Math.floor(40 + v * 140);
        b = Math.floor(70 + line * 160);
      } else if (kind === "ao") {
        const dx = u - 0.52;
        const dy = v - 0.56;
        const ring = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.3);
        const d = Math.floor(220 - ring * 175);
        r = d;
        g = d;
        b = d;
      } else {
        r = Math.floor(35 + u * 180);
        g = Math.floor(52 + (1 - v) * 140);
        b = Math.floor(70 + Math.sin(u * Math.PI) * 130);
      }
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  for (let i = 32; i < size; i += 48) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeRectOutline(width, depth, color) {
  const hw = width / 2;
  const hd = depth / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -hw, 0, -hd, hw, 0, -hd,
    hw, 0, -hd, hw, 0, hd,
    hw, 0, hd, -hw, 0, hd,
    -hw, 0, hd, -hw, 0, -hd,
  ], 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
  );
}

function updateMaterialMaps(material, texture, keys) {
  for (const key of keys) material[key] = texture;
  material.needsUpdate = true;
}

async function createWaterScene(scene) {
  addLights(scene);
  scene.background = new THREE.Color(0x071018);

  const textures = await loadVariantTextures({ data: true, repeat: [3, 2] });
  const pool = new THREE.Group();
  scene.add(pool);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 5, 48, 32),
    new THREE.MeshStandardMaterial({
      map: makeGridTexture(),
      color: 0x70c7d7,
      roughness: 0.72,
      metalness: 0.0,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  pool.add(floor);

  const caustic = new THREE.Mesh(
    new THREE.PlaneGeometry(8.02, 5.02, 1, 1),
    new THREE.MeshBasicMaterial({
      map: textures[0],
      color: 0xb6f6ff,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  caustic.rotation.x = -Math.PI / 2;
  caustic.position.y = 0.018;
  pool.add(caustic);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 5, 64, 40),
    new THREE.MeshPhysicalMaterial({
      color: 0x6ab7d6,
      transparent: true,
      opacity: 0.36,
      roughness: 0.08,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.12;
  pool.add(water);

  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x20313a, roughness: 0.58 });
  const rimLong = new THREE.BoxGeometry(8.3, 0.42, 0.18);
  const rimShort = new THREE.BoxGeometry(0.18, 0.42, 5.3);
  for (const [x, z, geometry] of [
    [0, -2.65, rimLong],
    [0, 2.65, rimLong],
    [-4.15, 0, rimShort],
    [4.15, 0, rimShort],
  ]) {
    const rim = new THREE.Mesh(geometry, rimMaterial);
    rim.position.set(x, 0.14, z);
    pool.add(rim);
  }

  return {
    setVariant(index) {
      caustic.material.map = textures[index];
      caustic.material.needsUpdate = true;
    },
    setMode(mode) {
      caustic.visible = mode !== "no-caustics";
      water.visible = mode !== "diagnostic";
      caustic.material.opacity = mode === "diagnostic" ? 0.95 : 0.58;
      floor.material.color.set(mode === "diagnostic" ? 0x101820 : 0x70c7d7);
    },
    update(time) {
      for (const texture of textures) {
        texture.offset.x = time * 0.018;
        texture.offset.y = -time * 0.012;
      }
      water.position.y = 0.12 + Math.sin(time * 1.7) * 0.018;
    },
  };
}

async function createRainScene(scene) {
  addLights(scene);
  scene.background = new THREE.Color(0x091016);
  scene.fog = new THREE.Fog(0x091016, 7, 18);

  const normalTextures = await loadVariantTextures({ data: true, repeat: [5.5, 4.5] });
  const asphaltMap = makeAsphaltTexture();
  const material = new THREE.MeshStandardMaterial({
    map: asphaltMap,
    normalMap: normalTextures[0],
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0x8ea3ad,
    roughness: 0.22,
    metalness: 0.0,
  });
  const baselineMaterial = new THREE.MeshStandardMaterial({
    map: asphaltMap,
    color: 0x708089,
    roughness: 0.46,
    metalness: 0.0,
  });
  const normalDebugMaterial = new THREE.MeshBasicMaterial({ map: normalTextures[0] });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9, 6, 80, 52), material);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const streakCount = 520;
  const positions = new Float32Array(streakCount * 2 * 3);
  const seeds = Array.from({ length: streakCount }, (_, i) => ({
    x: ((i * 37) % 1000) / 1000,
    z: ((i * 97) % 1000) / 1000,
    y: ((i * 53) % 1000) / 1000,
    s: 0.65 + (((i * 17) % 100) / 100) * 0.8,
  }));
  const streaks = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3)),
    new THREE.LineBasicMaterial({ color: 0x9ac8ff, transparent: true, opacity: 0.36 }),
  );
  scene.add(streaks);

  return {
    setVariant(index) {
      material.normalMap = normalTextures[index];
      normalDebugMaterial.map = normalTextures[index];
      material.needsUpdate = true;
      normalDebugMaterial.needsUpdate = true;
    },
    setMode(mode) {
      ground.material = mode === "normal-debug"
        ? normalDebugMaterial
        : mode === "wet-baseline"
          ? baselineMaterial
          : material;
      streaks.visible = mode !== "normal-debug";
    },
    update(time) {
      normalTextures.forEach((texture) => {
        texture.offset.x = time * 0.025;
        texture.offset.y = time * 0.018;
      });
      let ptr = 0;
      for (const seed of seeds) {
        const x = (seed.x - 0.5) * 9 + Math.sin(time * 0.35 + seed.z * 4) * 0.25;
        const z = (seed.z - 0.5) * 6;
        const phase = (seed.y - time * 0.42 * seed.s) % 1;
        const y = ((phase + 1) % 1) * 5.4 + 0.2;
        positions[ptr++] = x;
        positions[ptr++] = y;
        positions[ptr++] = z;
        positions[ptr++] = x - 0.08;
        positions[ptr++] = y - 0.48;
        positions[ptr++] = z + 0.03;
      }
      streaks.geometry.attributes.position.needsUpdate = true;
    },
  };
}

async function createPlanetScene(scene) {
  scene.background = new THREE.Color(0x05070c);
  scene.add(new THREE.AmbientLight(0x526077, 0.65));
  const sun = new THREE.DirectionalLight(0xffe2aa, 4.2);
  sun.position.set(-3.8, 2.6, 5.8);
  scene.add(sun);

  const textures = await loadVariantTextures({ data: true, repeat: [1, 1] });
  const geometry = new THREE.SphereGeometry(2, 160, 96);
  const material = new THREE.MeshStandardMaterial({
    color: 0x9e8060,
    displacementMap: textures[0],
    displacementScale: 0.22,
    bumpMap: textures[0],
    bumpScale: 0.18,
    roughness: 0.82,
    metalness: 0.0,
  });
  const flatMaterial = new THREE.MeshStandardMaterial({
    color: 0x817162,
    roughness: 0.9,
    metalness: 0.0,
  });
  const diagnosticMaterial = new THREE.MeshBasicMaterial({ map: textures[0] });
  const planet = new THREE.Mesh(geometry, material);
  scene.add(planet);

  const starGeometry = new THREE.BufferGeometry();
  const starPositions = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const r = 26;
    const theta = ((i * 137.5) % 360) * Math.PI / 180;
    const y = (((i * 53) % 1000) / 1000 - 0.5) * 18;
    const radial = Math.sqrt(Math.max(0.1, 1 - (y / 18) ** 2)) * r;
    starPositions[i * 3] = Math.cos(theta) * radial;
    starPositions[i * 3 + 1] = y;
    starPositions[i * 3 + 2] = Math.sin(theta) * radial;
  }
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xdce7ff, size: 0.025 })));

  return {
    setVariant(index) {
      material.displacementMap = textures[index];
      material.bumpMap = textures[index];
      diagnosticMaterial.map = textures[index];
      material.needsUpdate = true;
      diagnosticMaterial.needsUpdate = true;
    },
    setMode(mode) {
      planet.material = mode === "diagnostic"
        ? diagnosticMaterial
        : mode === "flat"
          ? flatMaterial
          : material;
    },
    update(time) {
      planet.rotation.y = time * 0.18;
      planet.rotation.x = Math.sin(time * 0.2) * 0.05;
    },
  };
}

async function createCloudScene(scene) {
  scene.background = new THREE.Color(0x12202a);
  scene.fog = new THREE.Fog(0x12202a, 7, 18);
  scene.add(new THREE.HemisphereLight(0xd8e7ff, 0x31405a, 1.9));
  const sun = new THREE.DirectionalLight(0xfff0c8, 3.6);
  sun.position.set(-4, 6, 4);
  scene.add(sun);

  const textures = await loadVariantTextures({ data: true, repeat: [1.6, 1.1] });
  const group = new THREE.Group();
  scene.add(group);

  const cloudMaterials = [];
  for (let i = 0; i < 14; i++) {
    const material = new THREE.MeshBasicMaterial({
      map: textures[0],
      color: i % 3 === 0 ? 0xe9f5ff : 0xc7d7ef,
      transparent: true,
      opacity: 0.11 + (i % 4) * 0.012,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    cloudMaterials.push(material);
    const layer = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 2.3, 1, 1), material);
    layer.rotation.x = -Math.PI / 2;
    layer.position.set(((i * 37) % 100) / 100 - 0.5, 0.4 + i * 0.085, (i - 6.5) * 0.28);
    layer.scale.set(1 + (i % 5) * 0.08, 1, 1);
    group.add(layer);
  }

  const debugPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshBasicMaterial({ map: textures[0], transparent: false }),
  );
  debugPanel.position.set(0, 1.8, -2.1);
  debugPanel.visible = false;
  group.add(debugPanel);

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(7.9, 1.6, 4.4),
    new THREE.MeshBasicMaterial({ color: 0x80d8ff, wireframe: true, transparent: true, opacity: 0.34 }),
  );
  shell.position.y = 0.95;
  shell.visible = false;
  group.add(shell);

  return {
    setVariant(index) {
      for (const material of cloudMaterials) updateMaterialMaps(material, textures[index], ["map"]);
      updateMaterialMaps(debugPanel.material, textures[index], ["map"]);
    },
    setMode(mode) {
      debugPanel.visible = mode === "weather-debug";
      shell.visible = mode === "shell-slice";
      for (const material of cloudMaterials) {
        material.opacity = mode === "weather-debug" ? 0.04 : mode === "shell-slice" ? 0.18 : 0.13;
      }
    },
    update(time) {
      textures.forEach((texture, index) => {
        texture.offset.x = time * (0.01 + index * 0.004);
        texture.offset.y = Math.sin(time * 0.08 + index) * 0.015;
      });
      group.position.x = Math.sin(time * 0.12) * 0.25;
    },
  };
}

async function createFieldScene(scene) {
  addLights(scene);
  scene.background = new THREE.Color(0x10150f);
  scene.fog = new THREE.Fog(0x10150f, 8, 20);

  const textures = await loadVariantTextures({ data: true, repeat: [2.2, 2.2] });
  const terrainGeometry = new THREE.PlaneGeometry(7, 7, 112, 112);
  const material = new THREE.MeshStandardMaterial({
    map: textures[0],
    displacementMap: textures[0],
    displacementScale: 0.62,
    bumpMap: textures[0],
    bumpScale: 0.18,
    color: 0x9fbe79,
    roughness: 0.86,
  });
  const flatMaterial = new THREE.MeshStandardMaterial({
    map: makeGroundTexture({ base: "#2d3424", line: "rgba(209,235,169,0.18)" }),
    color: 0x8aa46a,
    roughness: 0.9,
  });
  const debugMaterial = new THREE.MeshBasicMaterial({ map: textures[0] });
  const terrain = new THREE.Mesh(terrainGeometry, material);
  terrain.rotation.x = -Math.PI / 2;
  scene.add(terrain);

  const markers = new THREE.Group();
  scene.add(markers);
  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c67a, roughness: 0.75 });
  for (let i = 0; i < 52; i++) {
    const x = (((i * 43) % 100) / 100 - 0.5) * 6.2;
    const z = (((i * 71) % 100) / 100 - 0.5) * 6.2;
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.36, 5), markerMaterial);
    marker.position.set(x, 0.2 + (((i * 19) % 100) / 100) * 0.18, z);
    marker.rotation.y = i * 0.37;
    markers.add(marker);
  }

  return {
    setVariant(index) {
      updateMaterialMaps(material, textures[index], ["map", "displacementMap", "bumpMap"]);
      updateMaterialMaps(debugMaterial, textures[index], ["map"]);
    },
    setMode(mode) {
      terrain.material = mode === "channel-debug" ? debugMaterial : mode === "flat" ? flatMaterial : material;
      markers.visible = mode !== "channel-debug";
    },
    update(time) {
      markers.children.forEach((marker, index) => {
        marker.rotation.z = Math.sin(time * 1.4 + index) * 0.12;
      });
    },
  };
}

async function createFrostScene(scene) {
  addLights(scene);
  scene.background = new THREE.Color(0x071017);

  const textures = await loadVariantTextures({ data: true, repeat: [2.4, 2.4] });
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 4.2, 24, 16),
    new THREE.MeshStandardMaterial({
      map: makeGroundTexture({ base: "#172331", line: "rgba(194,235,255,0.18)" }),
      color: 0x8fc5db,
      roughness: 0.18,
      metalness: 0.0,
    }),
  );
  base.rotation.x = -Math.PI / 2;
  scene.add(base);

  const frostMaterial = new THREE.MeshBasicMaterial({
    map: textures[0],
    color: 0xd4fbff,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const frost = new THREE.Mesh(new THREE.PlaneGeometry(6.45, 4.25), frostMaterial);
  frost.rotation.x = -Math.PI / 2;
  frost.position.y = 0.035;
  scene.add(frost);

  const thaw = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.78, 64),
    new THREE.MeshBasicMaterial({ color: 0xffc783, transparent: true, opacity: 0.54, side: THREE.DoubleSide }),
  );
  thaw.rotation.x = -Math.PI / 2;
  thaw.position.y = 0.055;
  thaw.visible = false;
  scene.add(thaw);

  return {
    setVariant(index) {
      updateMaterialMaps(frostMaterial, textures[index], ["map"]);
    },
    setMode(mode) {
      thaw.visible = mode === "thaw-band";
      base.visible = mode !== "structure";
      frostMaterial.opacity = mode === "structure" ? 1.0 : mode === "thaw-band" ? 0.56 : 0.82;
    },
    update(time) {
      textures.forEach((texture) => {
        texture.offset.x = Math.sin(time * 0.08) * 0.02;
        texture.offset.y = time * 0.006;
      });
      thaw.position.x = Math.sin(time * 0.7) * 1.7;
      thaw.position.z = Math.cos(time * 0.52) * 0.9;
    },
  };
}

async function createLavaScene(scene) {
  addLights(scene);
  scene.background = new THREE.Color(0x100908);

  const textures = await loadVariantTextures({ data: true, repeat: [2.0, 2.0] });
  const material = new THREE.MeshStandardMaterial({
    map: textures[0],
    emissiveMap: textures[0],
    displacementMap: textures[0],
    bumpMap: textures[0],
    color: 0x2a201b,
    emissive: 0xff4a12,
    emissiveIntensity: 1.6,
    displacementScale: 0.32,
    bumpScale: 0.22,
    roughness: 0.74,
  });
  const coolMaterial = new THREE.MeshStandardMaterial({
    map: textures[0],
    color: 0x3d3630,
    roughness: 0.92,
    displacementMap: textures[0],
    displacementScale: 0.12,
  });
  const emissiveMaterial = new THREE.MeshBasicMaterial({ map: textures[0], color: 0xff7b25 });
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 5.5, 120, 120), material);
  slab.rotation.x = -Math.PI / 2;
  scene.add(slab);

  const light = new THREE.PointLight(0xff5a1f, 10, 7);
  light.position.set(0, 1.8, 0);
  scene.add(light);

  return {
    setVariant(index) {
      updateMaterialMaps(material, textures[index], ["map", "emissiveMap", "displacementMap", "bumpMap"]);
      updateMaterialMaps(coolMaterial, textures[index], ["map", "displacementMap"]);
      updateMaterialMaps(emissiveMaterial, textures[index], ["map"]);
    },
    setMode(mode) {
      slab.material = mode === "raw-emissive" ? emissiveMaterial : mode === "cool-crust" ? coolMaterial : material;
      light.visible = mode !== "cool-crust";
      light.intensity = mode === "raw-emissive" ? 14 : 10;
    },
    update(time) {
      textures.forEach((texture) => {
        texture.offset.x = time * 0.02;
        texture.offset.y = -time * 0.013;
      });
      light.position.x = Math.sin(time * 0.8) * 1.2;
      light.position.z = Math.cos(time * 0.65) * 1.2;
    },
  };
}

async function createOceanScene(scene) {
  scene.background = new THREE.Color(0x0b1b2a);
  scene.fog = new THREE.Fog(0x0b1b2a, 8, 24);
  scene.add(new THREE.HemisphereLight(0xc8e8ff, 0x102632, 1.8));
  const sun = new THREE.DirectionalLight(0xffefd0, 3.4);
  sun.position.set(-3, 5, 4);
  scene.add(sun);

  const textures = await loadVariantTextures({ data: true, repeat: [3.5, 2.2] });
  const material = new THREE.MeshStandardMaterial({
    map: makeGroundTexture({ base: "#11334d", line: "rgba(154,225,255,0.13)" }),
    displacementMap: textures[0],
    bumpMap: textures[0],
    displacementScale: 0.42,
    bumpScale: 0.24,
    color: 0x4eb3d5,
    roughness: 0.16,
    metalness: 0.0,
  });
  const calmMaterial = new THREE.MeshStandardMaterial({
    color: 0x407f98,
    roughness: 0.28,
    displacementMap: textures[0],
    displacementScale: 0.08,
  });
  const debugMaterial = new THREE.MeshBasicMaterial({ map: textures[0] });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(9, 6, 150, 96), material);
  surface.rotation.x = -Math.PI / 2;
  scene.add(surface);

  return {
    setVariant(index) {
      updateMaterialMaps(material, textures[index], ["displacementMap", "bumpMap"]);
      updateMaterialMaps(calmMaterial, textures[index], ["displacementMap"]);
      updateMaterialMaps(debugMaterial, textures[index], ["map"]);
    },
    setMode(mode) {
      surface.material = mode === "slope-debug" ? debugMaterial : mode === "calm" ? calmMaterial : material;
    },
    update(time) {
      textures.forEach((texture, index) => {
        texture.offset.x = time * (0.016 + index * 0.004);
        texture.offset.y = time * (0.011 + index * 0.002);
      });
      surface.position.y = Math.sin(time * 0.55) * 0.04;
    },
  };
}

async function createSpaceScene(scene) {
  scene.background = new THREE.Color(0x02040a);
  scene.add(new THREE.AmbientLight(0x34405f, 0.8));

  const textures = await loadVariantTextures({ data: false, repeat: [3, 1.5] });
  const starSphere = new THREE.Mesh(
    new THREE.SphereGeometry(28, 64, 32),
    new THREE.MeshBasicMaterial({ map: textures[0], side: THREE.BackSide }),
  );
  scene.add(starSphere);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  scene.add(core);
  const disk = new THREE.Mesh(
    new THREE.TorusGeometry(1.65, 0.075, 16, 128),
    new THREE.MeshBasicMaterial({ color: 0xffb15c, transparent: true, opacity: 0.82 }),
  );
  disk.rotation.x = Math.PI / 2.65;
  scene.add(disk);
  const lens = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({
      map: makeTransparentDiscTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  lens.position.z = 0.08;
  scene.add(lens);

  const debugPanel = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.4), new THREE.MeshBasicMaterial({ map: textures[0] }));
  debugPanel.position.set(0, 0, -2.2);
  debugPanel.visible = false;
  scene.add(debugPanel);

  return {
    setVariant(index) {
      updateMaterialMaps(starSphere.material, textures[index], ["map"]);
      updateMaterialMaps(debugPanel.material, textures[index], ["map"]);
    },
    setMode(mode) {
      core.visible = mode !== "star-debug" && mode !== "no-lens";
      disk.visible = mode !== "star-debug" && mode !== "no-lens";
      lens.visible = mode !== "star-debug" && mode !== "no-lens";
      debugPanel.visible = mode === "star-debug";
    },
    update(time) {
      textures.forEach((texture) => {
        texture.offset.x = time * 0.003;
      });
      starSphere.rotation.y = time * 0.015;
      disk.rotation.z = time * 0.24;
      lens.scale.setScalar(1 + Math.sin(time * 1.1) * 0.04);
    },
  };
}

async function createMeadowScene(scene) {
  addLights(scene);
  scene.background = new THREE.Color(0x11170f);
  scene.fog = new THREE.Fog(0x11170f, 7, 18);

  const textures = await loadVariantTextures({ data: true, repeat: [2.4, 2.4] });
  const material = new THREE.MeshStandardMaterial({
    map: textures[0],
    displacementMap: textures[0],
    displacementScale: 0.18,
    color: 0x6fa34a,
    roughness: 0.92,
  });
  const debugMaterial = new THREE.MeshBasicMaterial({ map: textures[0] });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(7, 7, 64, 64), material);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const bladeCount = 1100;
  const bladeGeometry = new THREE.PlaneGeometry(0.045, 0.54, 1, 3);
  bladeGeometry.translate(0, 0.27, 0);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0x7fc957,
    roughness: 0.86,
    side: THREE.DoubleSide,
    alphaTest: 0.35,
  });
  const blades = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, bladeCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < bladeCount; i++) {
    const x = (((i * 73) % 1000) / 1000 - 0.5) * 6.5;
    const z = (((i * 191) % 1000) / 1000 - 0.5) * 6.5;
    const h = 0.6 + (((i * 31) % 100) / 100) * 0.7;
    dummy.position.set(x, 0.02, z);
    dummy.rotation.set(0, i * 2.399963, 0);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    blades.setMatrixAt(i, dummy.matrix);
  }
  scene.add(blades);

  const flowers = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.045, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd15c }),
    130,
  );
  for (let i = 0; i < 130; i++) {
    const x = (((i * 109) % 1000) / 1000 - 0.5) * 6.1;
    const z = (((i * 227) % 1000) / 1000 - 0.5) * 6.1;
    dummy.position.set(x, 0.48 + (((i * 17) % 100) / 100) * 0.2, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
  }
  scene.add(flowers);

  return {
    setVariant(index) {
      updateMaterialMaps(material, textures[index], ["map", "displacementMap"]);
      updateMaterialMaps(debugMaterial, textures[index], ["map"]);
    },
    setMode(mode) {
      ground.material = mode === "density-debug" ? debugMaterial : material;
      blades.count = mode === "low-lod" ? 260 : 1100;
      flowers.visible = mode !== "density-debug";
      blades.visible = mode !== "density-debug";
    },
    update(time) {
      blades.rotation.y = Math.sin(time * 0.3) * 0.03;
      bladeMaterial.color.setHSL(0.28 + Math.sin(time * 0.18) * 0.02, 0.48, 0.55);
    },
  };
}

async function createAmbientContactScene(scene) {
  scene.background = new THREE.Color(0x10151a);
  scene.fog = new THREE.Fog(0x10151a, 8, 18);
  const hemi = new THREE.HemisphereLight(0xc8dbff, 0x262018, 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0c5, 4.2);
  sun.position.set(-3.2, 6.2, 4.8);
  scene.add(sun);

  const floorMaterial = new THREE.MeshStandardMaterial({
    map: makeGroundTexture({ base: "#2b302e", line: "rgba(215,230,220,0.13)" }),
    color: 0x8f988d,
    roughness: 0.82,
  });
  const debugFloorMaterial = new THREE.MeshBasicMaterial({ color: 0xd9ded5 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.2, 32, 24), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x7d8784, roughness: 0.88 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.6, 24, 12), wallMaterial);
  wall.position.set(0, 1.3, -2.6);
  scene.add(wall);

  const contactTexture = makeDarkDiscTexture();
  const contactMaterial = new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
  });
  const debugContactMaterial = new THREE.MeshBasicMaterial({
    map: contactTexture,
    color: 0x111111,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  const contacts = [];
  const addContact = (x, z, sx, sz) => {
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactMaterial.clone());
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.024, z);
    disc.scale.set(sx, sz, 1);
    scene.add(disc);
    contacts.push({ disc, sx, sz });
    return disc;
  };

  addContact(-1.45, -0.25, 1.25, 0.72);
  addContact(0.18, 0.4, 1.75, 0.8);
  addContact(1.55, -0.95, 0.95, 0.62);
  const cornerContact = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 2.4), contactMaterial.clone());
  cornerContact.position.set(0, 1.1, -2.575);
  cornerContact.scale.y = 0.82;
  scene.add(cornerContact);

  const objectMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xd9b36c, roughness: 0.58, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ color: 0x72a9c6, roughness: 0.34, metalness: 0.0 }),
    new THREE.MeshStandardMaterial({ color: 0xbfc6ce, roughness: 0.42, metalness: 0.15 }),
  ];
  const debugObjectMaterial = new THREE.MeshBasicMaterial({ color: 0xf2f0e8 });
  const objects = [
    new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), objectMaterials[0]),
    new THREE.Mesh(new THREE.SphereGeometry(0.52, 48, 32), objectMaterials[1]),
    new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, 1.1, 48), objectMaterials[2]),
  ];
  objects[0].position.set(-1.45, 0.48, -0.25);
  objects[1].position.set(0.18, 0.54, 0.4);
  objects[2].position.set(1.55, 0.56, -0.95);
  objects.forEach((object) => {
    object.castShadow = true;
    scene.add(object);
  });

  const emitter = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 1.3, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0x9bdcff,
      emissive: 0x66dfff,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    }),
  );
  emitter.position.set(2.35, 0.75, 0.55);
  scene.add(emitter);
  const emitterLight = new THREE.PointLight(0x66dfff, 5.5, 5);
  emitterLight.position.copy(emitter.position);
  scene.add(emitterLight);

  const profiles = [
    { scale: 1.0, opacity: 0.44, ambient: 1.45, sun: 4.2 },
    { scale: 0.68, opacity: 0.62, ambient: 1.18, sun: 4.6 },
    { scale: 1.42, opacity: 0.32, ambient: 1.72, sun: 3.8 },
  ];

  let activeMode = "final";
  let activeProfile = profiles[0];
  const applyProfile = () => {
    hemi.intensity = activeMode === "ao-debug" ? 0.35 : activeProfile.ambient;
    sun.intensity = activeMode === "ao-debug" ? 0.35 : activeProfile.sun;
    contacts.forEach(({ disc, sx, sz }) => {
      disc.scale.set(sx * activeProfile.scale, sz * activeProfile.scale, 1);
      disc.material.opacity = activeMode === "ao-debug" ? 0.82 : activeProfile.opacity;
    });
    cornerContact.material.opacity = activeMode === "ao-debug" ? 0.62 : activeProfile.opacity * 0.75;
  };

  return {
    setVariant(index) {
      activeProfile = profiles[index] ?? profiles[0];
      applyProfile();
    },
    setMode(mode) {
      activeMode = mode;
      const debug = mode === "ao-debug";
      floor.material = debug ? debugFloorMaterial : floorMaterial;
      wall.material = debug ? debugFloorMaterial : wallMaterial;
      contacts.forEach(({ disc }) => {
        disc.visible = mode !== "no-ao";
        disc.material = debug ? debugContactMaterial.clone() : contactMaterial.clone();
      });
      cornerContact.visible = mode !== "no-ao";
      cornerContact.material = debug ? debugContactMaterial.clone() : contactMaterial.clone();
      objects.forEach((object, index) => {
        object.material = debug ? debugObjectMaterial : objectMaterials[index];
      });
      emitter.visible = !debug;
      emitterLight.visible = !debug;
      applyProfile();
    },
    update(time) {
      objects[0].rotation.set(0.16, time * 0.24, -0.08);
      objects[1].position.y = 0.54 + Math.sin(time * 1.4) * 0.025;
      objects[2].rotation.y = -time * 0.18;
      emitter.material.emissiveIntensity = 2.0 + Math.sin(time * 2.1) * 0.25;
    },
  };
}

async function createBloomScene(scene, { camera } = {}) {
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.Fog(0x07090d, 8, 18);
  scene.add(new THREE.HemisphereLight(0x8fa9c8, 0x14100d, 0.85));
  const key = new THREE.DirectionalLight(0xffe2bc, 2.2);
  key.position.set(-3, 5, 4);
  scene.add(key);

  const baseGroup = new THREE.Group();
  scene.add(baseGroup);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 4.8, 32, 24),
    new THREE.MeshStandardMaterial({
      map: makeGroundTexture({ base: "#151921", line: "rgba(165,190,220,0.12)" }),
      color: 0x9aa4b1,
      roughness: 0.68,
      metalness: 0.04,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  baseGroup.add(floor);

  for (let i = 0; i < 7; i += 1) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.42 + (i % 3) * 0.18, 0.35 + (i % 2) * 0.35, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x5e6873, roughness: 0.58, metalness: 0.15 }),
    );
    block.position.set(-2.7 + i * 0.9, block.geometry.parameters.height / 2, -0.85 + (i % 2) * 1.25);
    baseGroup.add(block);
  }

  const glowTexture = makeGlowDiscTexture();
  const bloomGroup = new THREE.Group();
  scene.add(bloomGroup);
  const cores = [];
  const halos = [];
  const lights = [];
  const corePositions = [
    [-1.65, 0.7, -0.55],
    [0.05, 1.05, 0.35],
    [1.72, 0.78, -0.4],
  ];
  corePositions.forEach(([x, y, z], index) => {
    const core = new THREE.Mesh(
      index === 1 ? new THREE.SphereGeometry(0.28, 32, 24) : new THREE.CylinderGeometry(0.08, 0.08, 1.25, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffa34d,
        emissiveIntensity: 3.2,
        roughness: 0.18,
      }),
    );
    core.position.set(x, y, z);
    if (index !== 1) core.rotation.z = Math.PI / 2;
    bloomGroup.add(core);
    cores.push(core);

    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.8),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: 0xffb15c,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.position.copy(core.position);
    bloomGroup.add(halo);
    halos.push(halo);

    const light = new THREE.PointLight(0xff9a4a, 5, 4.5);
    light.position.copy(core.position);
    scene.add(light);
    lights.push(light);
  });

  const profiles = [
    { colors: [0xffb45d, 0xffd28a, 0xff824e], intensity: 3.2, halo: 0.58 },
    { colors: [0x68e5ff, 0xa4fff4, 0x4bb9ff], intensity: 3.6, halo: 0.66 },
    { colors: [0xff6bc8, 0x78f0ff, 0xffe36b], intensity: 3.45, halo: 0.64 },
  ];
  let profile = profiles[0];
  let activeMode = "final";

  const applyBloomState = () => {
    baseGroup.visible = activeMode !== "bloom-only";
    halos.forEach((halo, index) => {
      halo.visible = activeMode !== "base-only";
      halo.material.color.set(profile.colors[index]);
      halo.material.opacity = activeMode === "bloom-only" ? Math.min(0.92, profile.halo + 0.18) : profile.halo;
    });
    cores.forEach((core, index) => {
      core.visible = activeMode !== "base-only" || activeMode === "bloom-only";
      core.material.emissive.set(profile.colors[index]);
      core.material.color.set(activeMode === "base-only" ? 0x33373c : 0xffffff);
      core.material.emissiveIntensity = activeMode === "base-only" ? 0.0 : profile.intensity;
    });
    lights.forEach((light, index) => {
      light.visible = activeMode === "final";
      light.color.set(profile.colors[index]);
      light.intensity = profile.intensity * 1.35;
    });
  };

  return {
    setVariant(index) {
      profile = profiles[index] ?? profiles[0];
      applyBloomState();
    },
    setMode(mode) {
      activeMode = mode;
      applyBloomState();
    },
    update(time) {
      const pulse = 1 + Math.sin(time * 2.2) * 0.06;
      cores.forEach((core, index) => {
        core.rotation.y += 0.004 + index * 0.001;
        core.material.emissiveIntensity = activeMode === "base-only" ? 0 : profile.intensity * (0.9 + pulse * 0.1);
      });
      halos.forEach((halo, index) => {
        halo.scale.setScalar((1.1 + index * 0.16) * pulse);
        if (camera) halo.lookAt(camera.position);
      });
    },
  };
}

async function createExposureScene(scene) {
  scene.background = new THREE.Color(0x111215);
  scene.fog = new THREE.Fog(0x111215, 8, 18);
  scene.add(new THREE.HemisphereLight(0xc7d2e4, 0x1c1712, 1.1));
  const key = new THREE.DirectionalLight(0xffe5c8, 2.6);
  key.position.set(-2.5, 5.4, 4.0);
  scene.add(key);

  const exposed = [];
  const makeTrackedMaterial = (color, options = {}) => {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.62,
      metalness: options.metalness ?? 0.0,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
    });
    exposed.push({
      material,
      base: new THREE.Color(color),
      emissive: new THREE.Color(options.emissive ?? 0x000000),
      emissiveIntensity: options.emissiveIntensity ?? 0,
    });
    return material;
  };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, 4.8, 18, 12),
    makeTrackedMaterial(0x76736c, { roughness: 0.72 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const swatches = new THREE.Group();
  scene.add(swatches);
  const colors = [0xb84f4a, 0x54a66f, 0x4f77b8, 0xc6b75d, 0xb8b8b8, 0x303236];
  colors.forEach((color, index) => {
    const swatch = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.08), makeTrackedMaterial(color));
    swatch.position.set(-1.75 + (index % 3) * 0.78, 1.25 - Math.floor(index / 3) * 0.7, -2.35);
    swatches.add(swatch);
  });

  const grayCard = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.08), makeTrackedMaterial(0x777777));
  grayCard.position.set(1.35, 0.96, -2.35);
  swatches.add(grayCard);

  const windowMaterial = makeTrackedMaterial(0xffffff, {
    emissive: 0xfff0c0,
    emissiveIntensity: 2.4,
    roughness: 0.16,
  });
  const brightWindow = new THREE.Mesh(new THREE.BoxGeometry(0.88, 1.35, 0.08), windowMaterial);
  brightWindow.position.set(2.35, 1.05, -2.34);
  scene.add(brightWindow);
  const windowLight = new THREE.PointLight(0xffe1ae, 4.5, 7);
  windowLight.position.set(2.2, 1.6, -1.0);
  scene.add(windowLight);

  const uiGroup = new THREE.Group();
  scene.add(uiGroup);
  for (let i = 0; i < 4; i += 1) {
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.08, 0.03),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x7fd4c1 : 0xffb454 }),
    );
    chip.position.set(-2.25 + i * 0.46, 1.95, -1.72);
    uiGroup.add(chip);
  }

  const meterGroup = new THREE.Group();
  meterGroup.visible = false;
  scene.add(meterGroup);
  const meterMaterials = [0x64d6ff, 0xffcf6e, 0x9eff9a].map((color) => new THREE.MeshBasicMaterial({ color }));
  const meterBars = meterMaterials.map((material, index) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, 0.12), material);
    bar.position.set(-0.35 + index * 0.35, 0.55, -1.45);
    meterGroup.add(bar);
    return bar;
  });

  const profiles = [
    { baseLum: 0.18, bright: 0.35, grade: [1.04, 1.0, 0.92], compensation: 0.0, light: 3.8 },
    { baseLum: 0.42, bright: 1.2, grade: [0.92, 1.0, 1.08], compensation: -0.18, light: 6.5 },
    { baseLum: 0.08, bright: 1.65, grade: [1.12, 0.94, 0.86], compensation: 0.22, light: 8.0 },
  ];
  let activeProfile = profiles[0];
  let activeMode = "final";
  let exposureCurrent = 1.0;
  let exposureTarget = 1.0;

  const applyExposure = (exposure, grade) => {
    exposed.forEach(({ material, base, emissive, emissiveIntensity }) => {
      material.color.copy(base);
      material.color.r = clampValue(material.color.r * exposure * grade[0], 0, 1);
      material.color.g = clampValue(material.color.g * exposure * grade[1], 0, 1);
      material.color.b = clampValue(material.color.b * exposure * grade[2], 0, 1);
      material.emissive.copy(emissive);
      material.emissiveIntensity = emissiveIntensity * exposure;
    });
  };

  return {
    setVariant(index) {
      activeProfile = profiles[index] ?? profiles[0];
      windowLight.intensity = activeProfile.light;
    },
    setMode(mode) {
      activeMode = mode;
      meterGroup.visible = mode === "meter-debug";
      uiGroup.visible = mode !== "meter-debug";
    },
    update(time) {
      const sweep = (Math.sin(time * 0.75) + 1) * 0.5;
      brightWindow.position.x = 1.65 + sweep * 1.15;
      windowLight.position.x = brightWindow.position.x;
      const averageLum = activeProfile.baseLum + activeProfile.bright * (0.18 + sweep * 0.82);
      exposureTarget = clampValue((0.18 / Math.max(0.001, averageLum)) * (2 ** activeProfile.compensation), 0.45, 1.85);
      const speed = exposureTarget > exposureCurrent ? 3.2 : 1.1;
      exposureCurrent += (exposureTarget - exposureCurrent) * (1 - Math.exp(-0.016 * speed));
      const grade = activeMode === "identity-lut" || activeMode === "meter-debug" ? [1, 1, 1] : activeProfile.grade;
      applyExposure(exposureCurrent, grade);
      meterBars[0].scale.y = 0.18 + averageLum * 0.72;
      meterBars[1].scale.y = exposureTarget;
      meterBars[2].scale.y = exposureCurrent;
      meterBars.forEach((bar) => {
        bar.position.y = 0.15 + bar.scale.y * 0.5;
      });
      swatches.rotation.y = Math.sin(time * 0.18) * 0.04;
    },
  };
}

async function createImagePipelineScene(scene) {
  scene.background = new THREE.Color(0x0b1016);
  scene.fog = new THREE.Fog(0x0b1016, 8, 20);
  scene.add(new THREE.HemisphereLight(0xb6cdf3, 0x18140f, 1.35));
  const key = new THREE.DirectionalLight(0xffe4bf, 3.2);
  key.position.set(-3.2, 5.8, 4.5);
  scene.add(key);

  const sourceGroup = new THREE.Group();
  scene.add(sourceGroup);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 4.2, 24, 18),
    new THREE.MeshStandardMaterial({
      map: makeGroundTexture({ base: "#18222a", line: "rgba(127,212,193,0.14)" }),
      color: 0x8da1aa,
      roughness: 0.74,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  sourceGroup.add(floor);
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xd69b58, roughness: 0.44, metalness: 0.08 }),
  );
  cube.position.set(-0.85, 0.48, -0.25);
  sourceGroup.add(cube);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 48, 32),
    new THREE.MeshStandardMaterial({
      color: 0x6fa8d9,
      emissive: 0x174f7d,
      emissiveIntensity: 0.85,
      roughness: 0.28,
    }),
  );
  sphere.position.set(0.5, 0.56, 0.35);
  sourceGroup.add(sphere);

  const aoPatch = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.9),
    new THREE.MeshBasicMaterial({
      map: makeDarkDiscTexture(),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  );
  aoPatch.rotation.x = -Math.PI / 2;
  aoPatch.position.set(-0.35, 0.025, 0.05);
  sourceGroup.add(aoPatch);
  const bloomPatch = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshBasicMaterial({
      map: makeGlowDiscTexture("rgba(104, 229, 255, 0.96)", "rgba(104, 229, 255, 0)"),
      color: 0x83f4ff,
      transparent: true,
      opacity: 0.46,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  bloomPatch.position.copy(sphere.position);
  scene.add(bloomPatch);

  const signalGroup = new THREE.Group();
  scene.add(signalGroup);
  const signalKinds = ["color", "depth", "normal", "emissive", "velocity", "ao"];
  const signalPanels = signalKinds.map((kind, index) => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.82),
      new THREE.MeshBasicMaterial({ map: makeSignalTexture(kind) }),
    );
    panel.position.set(2.15 + (index % 2) * 0.96, 1.55 - Math.floor(index / 2) * 0.92, -1.05);
    panel.rotation.y = -0.28;
    signalGroup.add(panel);
    return panel;
  });

  const profiles = [
    { signalScale: 1.0, speed: 0.22, post: 1.0 },
    { signalScale: 1.16, speed: 0.58, post: 0.9 },
    { signalScale: 1.28, speed: 0.34, post: 1.2 },
  ];
  let profile = profiles[0];
  let activeMode = "final";

  const applyMode = () => {
    const signals = activeMode === "signals";
    const bypass = activeMode === "bypass-post";
    signalGroup.visible = activeMode !== "bypass-post";
    aoPatch.visible = !bypass && !signals;
    bloomPatch.visible = !bypass;
    sourceGroup.visible = true;
    signalPanels.forEach((panel, index) => {
      panel.scale.setScalar((signals ? 1.34 : 1.0) * profile.signalScale);
      panel.position.x = signals ? -2.15 + (index % 3) * 1.35 : 2.15 + (index % 2) * 0.96;
      panel.position.y = signals ? 1.35 - Math.floor(index / 3) * 1.2 : 1.55 - Math.floor(index / 2) * 0.92;
      panel.position.z = signals ? -1.7 : -1.05;
      panel.rotation.y = signals ? 0.18 : -0.28;
    });
    floor.material.color.set(bypass ? 0x87929a : 0x8da1aa);
    bloomPatch.material.opacity = bypass ? 0 : 0.46 * profile.post;
    aoPatch.material.opacity = bypass ? 0 : 0.34 * profile.post;
  };

  return {
    setVariant(index) {
      profile = profiles[index] ?? profiles[0];
      applyMode();
    },
    setMode(mode) {
      activeMode = mode;
      applyMode();
    },
    update(time) {
      cube.rotation.set(0.22, time * profile.speed, -0.12);
      sphere.position.y = 0.56 + Math.sin(time * 1.6) * 0.06;
      bloomPatch.position.copy(sphere.position);
      bloomPatch.scale.setScalar(1 + Math.sin(time * 2.0) * 0.05);
      signalGroup.rotation.y = Math.sin(time * 0.18) * 0.03;
    },
  };
}

async function createShadowScene(scene, { renderer } = {}) {
  scene.background = new THREE.Color(0x101318);
  scene.fog = new THREE.Fog(0x101318, 8, 24);
  if (renderer?.shadowMap) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  scene.add(new THREE.HemisphereLight(0xbbcadc, 0x282018, 1.2));
  const sun = new THREE.DirectionalLight(0xffe8be, 5.2);
  sun.position.set(-5, 7.5, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 26;
  scene.add(sun);
  scene.add(sun.target);

  const configureBounds = (extent) => {
    const cam = sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  };
  configureBounds(7.5);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 9, 40, 28),
    new THREE.MeshStandardMaterial({
      map: makeGroundTexture({ base: "#252923", line: "rgba(225,235,210,0.1)" }),
      color: 0x8c947d,
      roughness: 0.84,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const casters = [];
  const casterMaterial = new THREE.MeshStandardMaterial({ color: 0xbca46f, roughness: 0.52 });
  for (let i = 0; i < 22; i += 1) {
    const h = 0.45 + (i % 5) * 0.28;
    const caster = new THREE.Mesh(new THREE.BoxGeometry(0.34, h, 0.34), casterMaterial);
    caster.position.set((((i * 47) % 100) / 100 - 0.5) * 10.5, h / 2, -3.4 + (i % 6) * 1.25);
    caster.castShadow = true;
    caster.receiveShadow = true;
    scene.add(caster);
    casters.push(caster);
  }

  const hero = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.34, 0.11, 96, 16),
    new THREE.MeshStandardMaterial({ color: 0x7bb9d6, roughness: 0.38, metalness: 0.08 }),
  );
  hero.position.set(0, 0.86, 0);
  hero.castShadow = true;
  hero.receiveShadow = true;
  scene.add(hero);

  const debugGroup = new THREE.Group();
  scene.add(debugGroup);
  [
    [3.0, 2.3, 0x7fd4c1],
    [6.0, 4.5, 0xffb454],
    [10.5, 7.6, 0xd98cff],
  ].forEach(([w, d, color], index) => {
    const outline = makeRectOutline(w, d, color);
    outline.position.y = 0.055 + index * 0.012;
    debugGroup.add(outline);
  });
  const singleMapOutline = makeRectOutline(4.2, 3.2, 0xff6f5c);
  singleMapOutline.position.y = 0.09;
  scene.add(singleMapOutline);

  const profiles = [
    { extent: 4.2, visible: 10, sunX: -4.2, debugScale: 0.9 },
    { extent: 7.5, visible: 22, sunX: -5.2, debugScale: 1.0 },
    { extent: 10.0, visible: 22, sunX: -6.6, debugScale: 1.15 },
  ];
  let profile = profiles[1];
  let activeMode = "final";

  const applyShadowState = () => {
    const extent = activeMode === "single-map" ? 3.2 : profile.extent;
    configureBounds(extent);
    debugGroup.visible = activeMode === "cascade-debug";
    singleMapOutline.visible = activeMode === "single-map";
    debugGroup.scale.setScalar(profile.debugScale);
    sun.position.x = profile.sunX;
    casters.forEach((caster, index) => {
      caster.visible = index < profile.visible;
    });
  };

  return {
    setVariant(index) {
      profile = profiles[index] ?? profiles[1];
      applyShadowState();
    },
    setMode(mode) {
      activeMode = mode;
      applyShadowState();
    },
    update(time) {
      hero.rotation.set(time * 0.34, time * 0.56, 0);
      hero.position.x = Math.sin(time * 0.35) * 0.55;
      sun.target.position.set(Math.sin(time * 0.12) * 0.25, 0, -0.2);
      sun.shadow.needsUpdate = true;
    },
  };
}

async function createSkyAtmosphereScene(scene) {
  scene.background = new THREE.Color(0x102032);
  scene.add(new THREE.HemisphereLight(0xc6e8ff, 0x1f1c22, 1.15));
  const sunLight = new THREE.DirectionalLight(0xffe5af, 3.5);
  sunLight.position.set(-4.5, 4.8, 4.2);
  scene.add(sunLight);

  const skyTextures = [
    makeBandTexture([[0, "#07111e"], [0.32, "#1f5f92"], [0.7, "#9ac7d8"], [1, "#f0c38a"]]),
    makeBandTexture([[0, "#050b16"], [0.36, "#245b87"], [0.72, "#b7d4de"], [1, "#f2d2a0"]]),
    makeBandTexture([[0, "#02040a"], [0.42, "#111f4e"], [0.73, "#4a84b0"], [1, "#d8a875"]]),
  ];
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(30, 64, 32),
    new THREE.MeshBasicMaterial({ map: skyTextures[0], side: THREE.BackSide }),
  );
  scene.add(sky);

  const terrain = new THREE.Group();
  scene.add(terrain);
  for (let i = 0; i < 9; i += 1) {
    const ridge = new THREE.Mesh(
      new THREE.ConeGeometry(0.8 + (i % 3) * 0.25, 1.4 + (i % 4) * 0.35, 4),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x354238 : 0x2b3330, roughness: 0.9 }),
    );
    ridge.position.set(-4.4 + i * 1.1, 0.28, -2.45 - (i % 2) * 0.25);
    ridge.rotation.y = Math.PI / 4;
    terrain.add(ridge);
  }

  const hazeGroup = new THREE.Group();
  scene.add(hazeGroup);
  const hazeMaterials = [
    new THREE.MeshBasicMaterial({ color: 0xbadfff, transparent: true, opacity: 0.18, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0xffd6aa, transparent: true, opacity: 0.14, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0x8ac5ff, transparent: true, opacity: 0.12, depthWrite: false }),
  ];
  hazeMaterials.forEach((material, index) => {
    const layer = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.1), material);
    layer.position.set(0, 1.0 + index * 0.35, -2.0 - index * 0.8);
    hazeGroup.add(layer);
  });

  const sunDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.72),
    new THREE.MeshBasicMaterial({
      map: makeGlowDiscTexture("rgba(255, 235, 170, 0.96)", "rgba(255, 190, 80, 0)"),
      color: 0xffe7aa,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sunDisc.position.set(-2.7, 2.7, -2.0);
  scene.add(sunDisc);

  const debugGroup = new THREE.Group();
  debugGroup.visible = false;
  scene.add(debugGroup);
  ["color", "depth", "emissive", "velocity"].forEach((kind, index) => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 1.05),
      new THREE.MeshBasicMaterial({ map: makeSignalTexture(kind) }),
    );
    panel.position.set(1.6 + (index % 2) * 1.2, 1.65 - Math.floor(index / 2) * 1.18, -1.75);
    panel.rotation.y = -0.22;
    debugGroup.add(panel);
  });

  const profiles = [
    { texture: 0, haze: 1.0, terrainY: 0.0, sun: [-2.7, 2.7, -2.0], light: 3.5 },
    { texture: 1, haze: 0.58, terrainY: -0.12, sun: [-1.4, 3.15, -2.2], light: 4.0 },
    { texture: 2, haze: 0.28, terrainY: -0.52, sun: [0.4, 2.35, -2.5], light: 2.7 },
  ];
  let profile = profiles[0];
  let activeMode = "final";

  const applyAtmosphere = () => {
    sky.material.map = skyTextures[profile.texture];
    sky.material.needsUpdate = true;
    terrain.position.y = profile.terrainY;
    sunDisc.position.fromArray(profile.sun);
    sunLight.intensity = profile.light;
    hazeGroup.visible = activeMode !== "no-haze" && activeMode !== "lut-debug";
    debugGroup.visible = activeMode === "lut-debug";
    hazeMaterials.forEach((material, index) => {
      material.opacity = profile.haze * (0.18 - index * 0.025);
    });
  };

  return {
    setVariant(index) {
      profile = profiles[index] ?? profiles[0];
      applyAtmosphere();
    },
    setMode(mode) {
      activeMode = mode;
      applyAtmosphere();
    },
    update(time) {
      sky.rotation.y = time * 0.01;
      hazeGroup.children.forEach((layer, index) => {
        layer.position.x = Math.sin(time * (0.09 + index * 0.03)) * (0.18 + index * 0.08);
      });
      sunDisc.scale.setScalar(1 + Math.sin(time * 0.7) * 0.035);
    },
  };
}

function computeStableCameraPose(camera, target, desired, upHint) {
  const forward = new THREE.Vector3().subVectors(target, desired).normalize();
  const up = upHint.clone().normalize();
  if (Math.abs(forward.dot(up)) > 0.985) {
    up.set(Math.abs(forward.y) < 0.9 ? 0 : 1, Math.abs(forward.y) < 0.9 ? 1 : 0, 0).normalize();
  }
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const correctedUp = new THREE.Vector3().crossVectors(right, forward).normalize();
  const back = forward.clone().multiplyScalar(-1);
  const basis = new THREE.Matrix4().makeBasis(right, correctedUp, back);
  camera.position.copy(desired);
  camera.quaternion.setFromRotationMatrix(basis).normalize();
}

async function createCameraRigScene(scene, { camera, controls } = {}) {
  scene.background = new THREE.Color(0x081018);
  scene.fog = new THREE.Fog(0x081018, 9, 26);
  scene.add(new THREE.HemisphereLight(0xb8d4ff, 0x182018, 1.35));
  const sun = new THREE.DirectionalLight(0xffe4bd, 3.6);
  sun.position.set(-4.2, 6.2, 5.0);
  scene.add(sun);
  if (controls) controls.enabled = false;

  const world = new THREE.Group();
  scene.add(world);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 10, 36, 20),
    new THREE.MeshStandardMaterial({
      map: makeGroundTexture({ base: "#13212a", line: "rgba(127,212,193,0.13)" }),
      color: 0x758894,
      roughness: 0.82,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  world.add(ground);

  const subject = new THREE.Group();
  world.add(subject);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.36, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x7eb6d6, roughness: 0.35, metalness: 0.08 }),
  );
  subject.add(body);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.36, 0.72, 24),
    new THREE.MeshStandardMaterial({ color: 0xd9b66c, roughness: 0.42 }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -1.52;
  subject.add(nose);
  const finMaterial = new THREE.MeshStandardMaterial({ color: 0xc76d58, roughness: 0.55 });
  for (const x of [-0.52, 0.52]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.72, 0.52), finMaterial);
    fin.position.set(x, -0.18, 0.7);
    subject.add(fin);
  }
  const thruster = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 1.0),
    new THREE.MeshBasicMaterial({
      map: makeGlowDiscTexture("rgba(255, 176, 72, 0.96)", "rgba(255, 90, 24, 0)"),
      color: 0xffb454,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  thruster.position.z = 1.45;
  subject.add(thruster);

  const guideGroup = new THREE.Group();
  world.add(guideGroup);
  const chaseGuide = makeRectOutline(2.2, 1.3, 0x7fd4c1);
  chaseGuide.rotation.x = -Math.PI / 2;
  chaseGuide.position.y = 0.03;
  guideGroup.add(chaseGuide);
  const sideGuide = makeRectOutline(3.8, 2.2, 0xffb454);
  sideGuide.rotation.x = -Math.PI / 2;
  sideGuide.position.y = 0.05;
  guideGroup.add(sideGuide);

  const farChunks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.32, 0.32, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x526873, roughness: 0.8 }),
    80,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 80; i += 1) {
    dummy.position.set((((i * 37) % 100) / 100 - 0.5) * 15, 0.16, (((i * 61) % 100) / 100 - 0.5) * 8);
    dummy.scale.setScalar(0.5 + ((i * 17) % 30) / 45);
    dummy.updateMatrix();
    farChunks.setMatrixAt(i, dummy.matrix);
  }
  world.add(farChunks);

  const profiles = [
    { scale: 0.78, speed: 0.7, far: 34, label: "compact" },
    { scale: 1.32, speed: 0.45, far: 52, label: "long" },
    { scale: 1.95, speed: 0.32, far: 96, label: "large" },
  ];
  let profile = profiles[0];
  let activeMode = "final";
  const virtualOrigin = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const chasePose = new THREE.Vector3();
  const sidePose = new THREE.Vector3();
  const handoffStart = new THREE.Vector3(0, 2.2, 7.2);
  const handoffTarget = new THREE.Vector3();

  const applyProjection = () => {
    if (!camera) return;
    camera.fov = activeMode === "handoff" ? 42 : activeMode === "side" ? 48 : 45;
    camera.near = Math.max(0.08, profile.scale * 0.05);
    camera.far = profile.far;
    camera.updateProjectionMatrix();
  };

  return {
    setVariant(index) {
      profile = profiles[index] ?? profiles[0];
      subject.scale.setScalar(profile.scale);
      applyProjection();
    },
    setMode(mode) {
      activeMode = mode;
      guideGroup.visible = mode !== "final";
      applyProjection();
    },
    update(time) {
      const subjectLength = 2.4 * profile.scale;
      subject.position.set(Math.sin(time * profile.speed) * 1.5, 0.72 + Math.sin(time * 1.3) * 0.08, Math.cos(time * profile.speed * 0.74) * 1.1);
      subject.rotation.y = Math.sin(time * profile.speed) * 0.22;
      subject.rotation.z = Math.sin(time * 1.7) * 0.035;
      thruster.lookAt(camera?.position ?? new THREE.Vector3(0, 2, 7));
      guideGroup.position.copy(subject.position);
      virtualOrigin.set(
        activeMode === "handoff" ? 1000000 + Math.sin(time * 0.1) * 64 : 0,
        0,
        activeMode === "handoff" ? -2000000 + Math.cos(time * 0.1) * 64 : 0,
      );
      world.position.copy(virtualOrigin).multiplyScalar(-0.000001);

      cameraTarget.copy(subject.position).add(new THREE.Vector3(0, subjectLength * 0.16, -subjectLength * 0.16));
      chasePose.copy(subject.position).add(new THREE.Vector3(0, subjectLength * 0.62, subjectLength * 2.2));
      sidePose.copy(subject.position).add(new THREE.Vector3(subjectLength * 3.2, subjectLength * 0.92, subjectLength * 1.1));
      const handoffT = activeMode === "handoff" ? (Math.sin(time * 0.5) + 1) * 0.5 : 0;
      handoffTarget.copy(sidePose).lerp(chasePose, handoffT);
      cameraPosition
        .copy(activeMode === "side" ? sidePose : activeMode === "handoff" ? handoffTarget : chasePose);
      if (activeMode === "handoff") {
        const ease = 1 - (1 - handoffT) ** 1.8;
        cameraPosition.lerpVectors(handoffStart, handoffTarget, ease);
      }
      if (camera) {
        computeStableCameraPose(camera, cameraTarget, cameraPosition, new THREE.Vector3(0, 1, 0));
      }
      farChunks.rotation.y = Math.sin(time * 0.05) * 0.02;
    },
  };
}

function smoothstep(edge0, edge1, x) {
  const t = clampValue((x - edge0) / Math.max(0.00001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

async function createProceduralMotionScene(scene) {
  scene.background = new THREE.Color(0x070b12);
  scene.fog = new THREE.Fog(0x070b12, 9, 28);
  scene.add(new THREE.HemisphereLight(0xb5caff, 0x19120e, 1.2));
  const sun = new THREE.DirectionalLight(0xffdfb0, 3.2);
  sun.position.set(-4.5, 6.4, 5.0);
  scene.add(sun);

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.35, 0.16, 64),
    new THREE.MeshStandardMaterial({ color: 0x38444a, roughness: 0.72, metalness: 0.08 }),
  );
  pad.position.y = 0.08;
  scene.add(pad);

  const rocket = new THREE.Group();
  scene.add(rocket);
  const stageA = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.55, 32), new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.48 }));
  stageA.position.y = 0.78;
  rocket.add(stageA);
  const stageB = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.95, 32), new THREE.MeshStandardMaterial({ color: 0x78a9d0, roughness: 0.42 }));
  stageB.position.y = 1.98;
  rocket.add(stageB);
  const capsule = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 32), new THREE.MeshStandardMaterial({ color: 0xd9b66c, roughness: 0.4 }));
  capsule.position.y = 2.72;
  rocket.add(capsule);
  const flame = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 1.05),
    new THREE.MeshBasicMaterial({
      map: makeGlowDiscTexture("rgba(255, 205, 72, 0.96)", "rgba(255, 72, 16, 0)"),
      color: 0xffb454,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  flame.rotation.x = -Math.PI / 2;
  rocket.add(flame);

  const dock = new THREE.Group();
  scene.add(dock);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.045, 16, 96), new THREE.MeshStandardMaterial({ color: 0xbfc6cc, roughness: 0.38, metalness: 0.2 }));
  ring.rotation.x = Math.PI / 2;
  dock.position.set(0, 2.5, -1.4);
  dock.add(ring);
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.18), new THREE.MeshStandardMaterial({ color: 0xffb454, roughness: 0.4 }));
  port.position.z = 1.05;
  dock.add(port);

  const debris = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.055, 0),
    new THREE.MeshStandardMaterial({ color: 0xd08b5c, roughness: 0.62 }),
    120,
  );
  const dummy = new THREE.Object3D();
  scene.add(debris);

  const debugGroup = new THREE.Group();
  scene.add(debugGroup);
  for (let i = 0; i < 4; i += 1) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.1 + i * 0.18, 0.12),
      new THREE.MeshBasicMaterial({ color: [0x7fd4c1, 0xffb454, 0xd98cff, 0x86e36f][i] }),
    );
    marker.position.set(-1.8 + i * 0.42, 0.08 + marker.geometry.parameters.height / 2, 1.8);
    debugGroup.add(marker);
  }
  const replayLine = makeRectOutline(4.2, 2.8, 0x7fd4c1);
  replayLine.rotation.x = -Math.PI / 2;
  replayLine.position.y = 0.05;
  scene.add(replayLine);

  const profiles = [
    { phase: "launch", speed: 0.92, debris: 32 },
    { phase: "dock", speed: 0.58, debris: 16 },
    { phase: "debris", speed: 0.74, debris: 120 },
  ];
  let profile = profiles[0];
  let activeMode = "final";

  return {
    setVariant(index) {
      profile = profiles[index] ?? profiles[0];
    },
    setMode(mode) {
      activeMode = mode;
      debugGroup.visible = mode === "phase-debug";
      replayLine.visible = mode === "replay-slice";
    },
    update(time) {
      const sequenceTime = (time * profile.speed) % 12;
      const ascentT = smoothstep(0.7, 5.8, sequenceTime);
      const stageT = smoothstep(4.2, 6.4, sequenceTime);
      const dockT = smoothstep(5.6, 10.8, sequenceTime);
      rocket.visible = true;
      dock.visible = profile.phase !== "launch" || activeMode !== "replay-slice";
      const launchHeight = ascentT * ascentT * 3.8;
      rocket.position.set(Math.sin(ascentT * Math.PI) * 0.55, 0.18 + launchHeight, Math.cos(ascentT * Math.PI) * -0.62);
      rocket.rotation.z = Math.sin(time * 2.4) * 0.018 * (1 - ascentT);
      rocket.rotation.y = ascentT * 0.8 + dockT * Math.PI * 2.0;
      stageA.position.x = stageT * -0.95;
      stageA.position.z = stageT * 0.42;
      stageA.rotation.z = stageT * 0.9;
      flame.visible = activeMode !== "phase-debug" && ascentT < 0.96;
      flame.position.y = -0.05;
      flame.scale.setScalar(0.62 + Math.sin(time * 24) * 0.08);
      dock.rotation.z = time * (profile.phase === "dock" ? 0.85 : 0.38) * (1 - smoothstep(9.4, 11.4, sequenceTime));
      if (profile.phase === "dock") {
        rocket.position.lerpVectors(new THREE.Vector3(2.8, 2.1, 1.8), dock.position.clone().add(new THREE.Vector3(0, 0, 1.08)), dockT);
        rocket.rotation.z = Math.PI / 2 + Math.sin(time * 0.8) * 0.05 * (1 - dockT);
      }
      const count = profile.debris;
      debris.count = count;
      for (let i = 0; i < count; i += 1) {
        const release = smoothstep(4.8 + (i % 12) * 0.04, 8.5, sequenceTime);
        const angle = i * 2.399963 + time * 0.24;
        const radius = release * (0.45 + (i % 9) * 0.08);
        dummy.position.set(Math.cos(angle) * radius, 0.8 + release * (0.4 + (i % 7) * 0.12), Math.sin(angle) * radius);
        dummy.rotation.set(time * 0.4 + i, time * 0.31, i * 0.2);
        dummy.scale.setScalar(0.55 + release * 0.9);
        dummy.updateMatrix();
        debris.setMatrixAt(i, dummy.matrix);
      }
      debris.instanceMatrix.needsUpdate = true;
      debugGroup.children.forEach((marker, index) => {
        marker.scale.y = [ascentT, stageT, dockT, sequenceTime / 12][index] * 2.0 + 0.1;
      });
    },
  };
}

async function createPooledParticlesScene(scene, { camera } = {}) {
  scene.background = new THREE.Color(0x08070b);
  scene.fog = new THREE.Fog(0x08070b, 7, 20);
  scene.add(new THREE.HemisphereLight(0x6e7fa0, 0x1b110d, 0.85));
  const key = new THREE.DirectionalLight(0xffd2aa, 2.3);
  key.position.set(-3, 5, 4);
  scene.add(key);

  const ship = new THREE.Group();
  scene.add(ship);
  const hull = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.36, 1.9, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xb9c6cf, roughness: 0.4, metalness: 0.08 }),
  );
  hull.rotation.x = Math.PI / 2;
  ship.add(hull);
  const shellTexture = makeGlowDiscTexture("rgba(255, 170, 72, 0.75)", "rgba(180, 50, 255, 0)");
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 48, 24),
    new THREE.MeshBasicMaterial({
      map: shellTexture,
      color: 0xff8a42,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  shell.scale.set(0.82, 0.56, 1.9);
  ship.add(shell);

  const wakeGroup = new THREE.Group();
  scene.add(wakeGroup);
  const wakeMaterials = [
    new THREE.MeshBasicMaterial({ color: 0xff8738, transparent: true, opacity: 0.30, depthWrite: false, blending: THREE.AdditiveBlending }),
    new THREE.MeshBasicMaterial({ color: 0x8c6cff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
    new THREE.MeshBasicMaterial({ color: 0x6fdcff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
  ];
  wakeMaterials.forEach((material, index) => {
    const wake = new THREE.Mesh(new THREE.ConeGeometry(0.42 + index * 0.25, 2.5 + index * 0.8, 36, 1, true), material);
    wake.rotation.x = -Math.PI / 2;
    wake.position.z = 1.2 + index * 0.45;
    wakeGroup.add(wake);
  });

  const sparkTexture = makeGlowDiscTexture("rgba(255, 235, 160, 0.96)", "rgba(255, 80, 24, 0)");
  const sparkMaterial = new THREE.MeshBasicMaterial({
    map: sparkTexture,
    color: 0xffd07a,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparkCount = 360;
  const sparkMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.12), sparkMaterial, sparkCount);
  const dummy = new THREE.Object3D();
  scene.add(sparkMesh);

  const debugPanels = new THREE.Group();
  scene.add(debugPanels);
  ["emissive", "velocity", "ao"].forEach((kind, index) => {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82), new THREE.MeshBasicMaterial({ map: makeSignalTexture(kind) }));
    panel.position.set(-2.1 + index * 1.0, 1.9, -1.4);
    debugPanels.add(panel);
  });

  const profiles = [
    { flow: new THREE.Vector3(0.05, -0.2, 1).normalize(), shell: 1.0, sparks: 220, wake: 1.0 },
    { flow: new THREE.Vector3(-0.4, -0.35, 0.8).normalize(), shell: 0.65, sparks: 360, wake: 0.72 },
    { flow: new THREE.Vector3(0.2, -0.15, 0.96).normalize(), shell: 0.38, sparks: 130, wake: 0.45 },
  ];
  let profile = profiles[0];
  let activeMode = "final";

  const applyMode = () => {
    debugPanels.visible = activeMode === "pool-debug";
    shell.visible = activeMode !== "pool-debug";
    wakeGroup.visible = activeMode !== "pool-debug";
    sparkMaterial.blending = activeMode === "bloom-off" ? THREE.NormalBlending : THREE.AdditiveBlending;
    wakeMaterials.forEach((material, index) => {
      material.opacity = activeMode === "bloom-off" ? 0.08 + index * 0.02 : (0.30 - index * 0.07) * profile.wake;
    });
    shell.material.opacity = activeMode === "bloom-off" ? 0.12 : 0.38 * profile.shell;
  };

  return {
    setVariant(index) {
      profile = profiles[index] ?? profiles[0];
      sparkMesh.count = profile.sparks;
      applyMode();
    },
    setMode(mode) {
      activeMode = mode;
      applyMode();
    },
    update(time) {
      ship.position.set(Math.sin(time * 0.24) * 0.45, 0.95 + Math.sin(time * 0.8) * 0.08, -0.25);
      ship.rotation.y = Math.sin(time * 0.35) * 0.28;
      ship.rotation.z = Math.sin(time * 0.53) * 0.06;
      wakeGroup.position.copy(ship.position);
      wakeGroup.rotation.copy(ship.rotation);
      shell.scale.set(0.82 + Math.sin(time * 2.1) * 0.04, 0.56 + Math.sin(time * 1.7) * 0.03, 1.9);
      for (let i = 0; i < profile.sparks; i += 1) {
        const phase = ((i * 0.618033 + time * (0.12 + (i % 5) * 0.015)) % 1 + 1) % 1;
        const angle = i * 2.399963;
        const spread = phase * (1.2 + (i % 11) * 0.035);
        dummy.position.copy(ship.position).add(new THREE.Vector3(
          Math.cos(angle) * spread * 0.65,
          -phase * 0.7 + Math.sin(angle * 1.7) * 0.12,
          1.1 + phase * (1.8 + (i % 7) * 0.08),
        ));
        dummy.scale.setScalar((1 - phase) * 1.2 + 0.18);
        if (camera) dummy.lookAt(camera.position);
        dummy.updateMatrix();
        sparkMesh.setMatrixAt(i, dummy.matrix);
      }
      sparkMesh.instanceMatrix.needsUpdate = true;
      debugPanels.rotation.y = Math.sin(time * 0.25) * 0.04;
    },
  };
}

function buildFrameWriterGeometry({ profileSamples = 64, lengthSegments = 72, railWidth = 0.72 } = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const groups = [];
  const outerW = 4.6;
  const outerH = 3.2;
  const innerW = outerW - railWidth * 2;
  const innerH = outerH - railWidth * 2;

  const depthAt = (t) => {
    const crown = 0.355 * Math.sin(Math.PI * t) ** 0.56;
    const innerBead = 0.105 * Math.exp(-(((t - 0.085) / 0.033) ** 2));
    const outerBead = 0.092 * Math.exp(-(((t - 0.905) / 0.038) ** 2));
    const innerGroove = -0.115 * Math.exp(-(((t - 0.205) / 0.043) ** 2));
    const outerGroove = -0.102 * Math.exp(-(((t - 0.735) / 0.052) ** 2));
    return (crown + innerBead + outerBead + innerGroove + outerGroove) * railWidth;
  };
  const addVertex = (x, y, z, u, v, color) => {
    positions.push(x, y, z);
    normals.push(0, 0, 1);
    uvs.push(u, v);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };
  const addRail = (orientation, materialIndex, color) => {
    const startIndex = indices.length;
    const base = positions.length / 3;
    for (let s = 0; s <= lengthSegments; s += 1) {
      const ss = s / lengthSegments;
      for (let p = 0; p <= profileSamples; p += 1) {
        const t = p / profileSamples;
        let x = 0;
        let y = 0;
        if (orientation === "top") {
          x = -outerW / 2 + ss * outerW;
          y = innerH / 2 + t * railWidth;
        } else if (orientation === "bottom") {
          x = outerW / 2 - ss * outerW;
          y = -innerH / 2 - t * railWidth;
        } else if (orientation === "left") {
          x = -innerW / 2 - t * railWidth;
          y = -outerH / 2 + ss * outerH;
        } else {
          x = innerW / 2 + t * railWidth;
          y = outerH / 2 - ss * outerH;
        }
        addVertex(x, y, depthAt(t), ss * 4, t * railWidth * 2, color);
      }
    }
    const row = profileSamples + 1;
    for (let s = 0; s < lengthSegments; s += 1) {
      for (let p = 0; p < profileSamples; p += 1) {
        const a = base + s * row + p;
        const b = base + (s + 1) * row + p;
        const c = base + s * row + p + 1;
        const d = base + (s + 1) * row + p + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex });
  };
  addRail("top", 0, new THREE.Color(0xd2a462));
  addRail("bottom", 1, new THREE.Color(0xb88455));
  addRail("left", 2, new THREE.Color(0x8fb7c5));
  addRail("right", 3, new THREE.Color(0x79a68c));
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.groups = groups;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    writer: {
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      groups: groups.length,
      profileSamples,
      lengthSegments,
    },
  };
  return geometry;
}

async function createProceduralGeometryScene(scene) {
  scene.background = new THREE.Color(0x10100d);
  scene.fog = new THREE.Fog(0x10100d, 8, 18);
  addLights(scene);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0xd2a462, roughness: 0.48, metalness: 0.05, vertexColors: true }),
    new THREE.MeshStandardMaterial({ color: 0xb88455, roughness: 0.58, metalness: 0.04, vertexColors: true }),
    new THREE.MeshStandardMaterial({ color: 0x8fb7c5, roughness: 0.42, metalness: 0.03, vertexColors: true }),
    new THREE.MeshStandardMaterial({ color: 0x79a68c, roughness: 0.54, metalness: 0.03, vertexColors: true }),
  ];
  const wireMaterial = new THREE.MeshBasicMaterial({ color: 0xf4e7ca, wireframe: true });
  const groupMaterials = [
    new THREE.MeshBasicMaterial({ color: 0xffb454 }),
    new THREE.MeshBasicMaterial({ color: 0x7fd4c1 }),
    new THREE.MeshBasicMaterial({ color: 0xd98cff }),
    new THREE.MeshBasicMaterial({ color: 0x8be36c }),
  ];
  const mesh = new THREE.Mesh(buildFrameWriterGeometry({ profileSamples: 64, lengthSegments: 72 }), materials);
  mesh.rotation.x = -0.15;
  mesh.position.y = 1.05;
  scene.add(mesh);

  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 1.75),
    new THREE.MeshStandardMaterial({ color: 0x252a2d, roughness: 0.82 }),
  );
  backing.position.set(0, 1.05, -0.08);
  scene.add(backing);

  const normalDebug = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7fd4c1, transparent: true, opacity: 0.72 }));
  scene.add(normalDebug);
  const updateNormals = () => {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const lines = [];
    const stride = Math.max(1, Math.floor(position.count / 140));
    for (let i = 0; i < position.count; i += stride) {
      const x = position.getX(i);
      const y = position.getY(i) + 1.05;
      const z = position.getZ(i);
      lines.push(x, y, z, x + normal.getX(i) * 0.08, y + normal.getY(i) * 0.08, z + normal.getZ(i) * 0.08);
    }
    normalDebug.geometry.dispose();
    normalDebug.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  };
  updateNormals();

  const profiles = [
    { profileSamples: 72, lengthSegments: 96, scale: 1.0 },
    { profileSamples: 48, lengthSegments: 64, scale: 0.96 },
    { profileSamples: 24, lengthSegments: 32, scale: 0.9 },
  ];
  let activeMode = "final";
  let profile = profiles[0];

  const rebuild = () => {
    mesh.geometry.dispose();
    mesh.geometry = buildFrameWriterGeometry(profile);
    mesh.scale.setScalar(profile.scale);
    updateNormals();
  };

  return {
    setVariant(index) {
      profile = profiles[index] ?? profiles[0];
      rebuild();
    },
    setMode(mode) {
      activeMode = mode;
      mesh.material = mode === "wire" ? wireMaterial : mode === "groups" ? groupMaterials : materials;
      normalDebug.visible = mode !== "final";
      backing.visible = mode !== "groups";
    },
    update(time) {
      mesh.rotation.y = Math.sin(time * 0.25) * 0.16;
      normalDebug.rotation.copy(mesh.rotation);
      backing.rotation.y = mesh.rotation.y;
    },
  };
}

async function init() {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  await renderer.init();

  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("Provider demos require renderer.backend.isWebGPUBackend === true.");
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  camera.position.fromArray(config.camera);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.fromArray(config.target);
  controls.update();

  const sceneApi = await config.factory(scene, { renderer, camera, controls });
  sceneApi.setMode(state.mode);
  sceneApi.setVariant(state.variant);
  createModeButtons(sceneApi);
  const probeSize = 128;
  const probeTarget = new THREE.RenderTarget(probeSize, probeSize, {
    samples: 1,
    type: THREE.UnsignedByteType,
  });
  probeTarget.texture.colorSpace = THREE.SRGBColorSpace;
  renderer.initRenderTarget?.(probeTarget);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  state.ready = true;
  setStatus("Live WebGPU demo ready. Drag to orbit; use the controls for debug views.", "ready");

  window.__providerDemo = {
    ready: true,
    demoId,
    getState: () => ({
      ...state,
      backend: renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unknown",
      rendererInfo: renderer.info,
    }),
    setMode: (mode) => {
      state.mode = mode;
      sceneApi.setMode(mode);
    },
    setVariant: (index) => {
      state.variant = index;
      sceneApi.setVariant(index);
    },
    captureProbe: async () => {
      state.probing = true;
      let pixels;
      try {
        sceneApi.update(state.time, state);
        renderer.setRenderTarget(probeTarget);
        await renderer.renderAsync(scene, camera);
        renderer.setRenderTarget(null);
        pixels = await renderer.readRenderTargetPixelsAsync(probeTarget, 0, 0, probeSize, probeSize);
      } finally {
        renderer.setRenderTarget(null);
        state.probing = false;
      }
      let min = 255;
      let max = 0;
      let opaquePixels = 0;
      let hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 1) {
        const value = pixels[i];
        min = Math.min(min, value);
        max = Math.max(max, value);
        hash = Math.imul(hash ^ value, 16777619) >>> 0;
        if (i % 4 === 3 && value > 0) opaquePixels += 1;
      }
      return {
        width: probeSize,
        height: probeSize,
        byteLength: pixels.length,
        min,
        max,
        opaquePixels,
        hash: hash.toString(16).padStart(8, "0"),
        mode: state.mode,
        variant: state.variant,
      };
    },
  };

  function frame() {
    const dt = clock.getDelta();
    if (!state.probing) {
      state.time += dt;
      controls.update();
      sceneApi.update(state.time, state);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

init().catch((error) => {
  console.error(error);
  window.__providerDemo = {
    ready: false,
    demoId,
    error: error.message,
  };
  setStatus(error.message, "error");
});
