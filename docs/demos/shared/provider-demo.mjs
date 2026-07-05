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
