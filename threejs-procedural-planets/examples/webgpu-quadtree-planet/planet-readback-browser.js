import {
  FloatType,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  REVISION,
  RenderTarget,
  Scene,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { uniform } from "three/tsl";

import { BODY_PRESETS } from "./planet-config.js";
import {
  PLANET_FIELD_ALGORITHM,
  PLANET_FIXED_DIRECTIONS,
  PLANET_PARITY_CHANNELS,
  PLANET_PARITY_SEEDS,
} from "./planet-field-constants.js";
import {
  samplePlanetParity0,
  samplePlanetParity1,
} from "./planet-fields.js";

const canvas = document.getElementById("view");
const status = document.getElementById("status");

function setStatus(message) {
  status.textContent = message;
}

function fixedProbes() {
  const probes = [];
  for (const preset of Object.values(BODY_PRESETS)) {
    for (const seed of PLANET_PARITY_SEEDS) {
      for (const direction of PLANET_FIXED_DIRECTIONS) {
        probes.push({ preset: preset.id, seed, direction });
      }
    }
  }
  return probes;
}

function unpackVector(channels, vector) {
  return Object.fromEntries(channels.map((channel, index) => [channel, vector[index]]));
}

async function createApp() {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    outputBufferType: FloatType,
  });
  renderer.setSize(1, 1, false);
  await renderer.init();

  const directionUniform = uniform(new Vector3(1, 0, 0));
  const seedUniform = uniform(PLANET_PARITY_SEEDS[0]);
  const rockyUniform = uniform(0);
  const seaLevelUniform = uniform(BODY_PRESETS.pelagia.seaLevel);
  const humidityBiasUniform = uniform(BODY_PRESETS.pelagia.humidityBias);
  const temperatureBiasUniform = uniform(BODY_PRESETS.pelagia.temperatureBias);

  const shaderInputs = {
    direction: directionUniform,
    seed: seedUniform,
    rocky: rockyUniform,
    seaLevel: seaLevelUniform,
    humidityBias: humidityBiasUniform,
    temperatureBias: temperatureBiasUniform,
  };

  const materials = [
    new MeshBasicNodeMaterial(),
    new MeshBasicNodeMaterial(),
  ];
  // Raw parity data must use fragmentNode. colorNode routes through material
  // alpha/output handling and is not a faithful float readback surface.
  materials[0].fragmentNode = samplePlanetParity0(shaderInputs);
  materials[1].fragmentNode = samplePlanetParity1(shaderInputs);

  const mesh = new Mesh(new PlaneGeometry(2, 2), materials[0]);
  const scene = new Scene();
  scene.add(mesh);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new RenderTarget(1, 1, { type: FloatType });

  function setProbeUniforms(probe) {
    const preset = BODY_PRESETS[probe.preset];
    directionUniform.value.set(probe.direction[0], probe.direction[1], probe.direction[2]);
    seedUniform.value = probe.seed;
    rockyUniform.value = preset.kind === "rocky" ? 1 : 0;
    seaLevelUniform.value = preset.seaLevel;
    humidityBiasUniform.value = preset.humidityBias;
    temperatureBiasUniform.value = preset.temperatureBias;
  }

  async function readMaterial(material, probe) {
    setProbeUniforms(probe);
    mesh.material = material;
    renderer.setRenderTarget(target);
    await renderer.renderAsync(scene, camera);
    renderer.setRenderTarget(null);
    // r185 readback allocates and returns the typed array. A destination buffer
    // argument would be read as textureIndex and fail backend lookup.
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
    return Array.from(pixels);
  }

  async function capturePlanetReadback(probes = fixedProbes()) {
    const samples = [];
    for (const probe of probes) {
      const pack0 = await readMaterial(materials[0], probe);
      const pack1 = await readMaterial(materials[1], probe);
      samples.push({
        preset: probe.preset,
        seed: probe.seed,
        direction: probe.direction,
        values: {
          ...unpackVector(PLANET_PARITY_CHANNELS.slice(0, 4), pack0),
          ...unpackVector(PLANET_PARITY_CHANNELS.slice(4, 8), pack1),
        },
      });
    }
    return {
      version: 1,
      algorithmVersion: PLANET_FIELD_ALGORITHM.version,
      renderer: {
        threeRevision: REVISION,
        isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
        outputBufferType: renderer.getOutputBufferType?.() ?? null,
      },
      constants: {
        hash: PLANET_FIELD_ALGORITHM.hash,
        fbm: PLANET_FIELD_ALGORITHM.fbm,
        heightWeights: PLANET_FIELD_ALGORITHM.heightWeights,
      },
      channels: PLANET_PARITY_CHANNELS,
      samples,
    };
  }

  return {
    ready: true,
    capturePlanetReadback,
  };
}

window.__planetReadbackValidation = {
  ready: false,
  error: null,
  capturePlanetReadback: null,
};

createApp()
  .then((app) => {
    window.__planetReadbackValidation = {
      ready: true,
      error: null,
      capturePlanetReadback: app.capturePlanetReadback,
    };
    setStatus("ready");
  })
  .catch((error) => {
    window.__planetReadbackValidation.error = error.stack ?? error.message;
    setStatus(error.message);
    console.error(error);
  });
