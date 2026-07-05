import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const asset = (name) => new URL(`./generated-variants/${name}`, import.meta.url).href;

const DEMOS = {
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
evidenceEl.href = new URL(`../../visual-validation/${demoId}/final.design.png`, import.meta.url).href;

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
  evidence.textContent = "QA Evidence";
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

  const sceneApi = await config.factory(scene);
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
