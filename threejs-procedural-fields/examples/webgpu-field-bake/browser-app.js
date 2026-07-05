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

import {
  FIELD_ALGORITHM,
  FIELD_PARITY_CHANNELS,
  fixedProbes,
  sampleField,
  sampleFieldDerived,
  stableCoordinates,
} from "./field-bundle.mjs";

const canvas = document.getElementById("view");
const status = document.getElementById("status");

function setStatus(message) {
  status.textContent = message;
}

function probeGpuInputs(probe) {
  return {
    coordinate: stableCoordinates(probe),
    seed: probe.seed ?? FIELD_ALGORITHM.defaultSeed,
    warpStrength: probe.domain === "sphere" ? FIELD_ALGORITHM.warp.amplitude : 0,
  };
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

  const coordinateUniform = uniform(new Vector3(1, 0, 0));
  const seedUniform = uniform(FIELD_ALGORITHM.defaultSeed);
  const warpStrengthUniform = uniform(FIELD_ALGORITHM.warp.amplitude);

  // Data readback must bypass the material pipeline: colorNode routes through
  // opacity/alpha handling and the output color transform, which forces the
  // alpha lane to 1 and re-encodes the RGB lanes. fragmentNode writes the raw
  // field vec4 to the FloatType target untouched.
  const packedMaterial = new MeshBasicNodeMaterial();
  packedMaterial.fragmentNode = sampleField({
    coordinate: coordinateUniform,
    seed: seedUniform,
    warpStrength: warpStrengthUniform,
  });

  const derivedMaterial = new MeshBasicNodeMaterial();
  derivedMaterial.fragmentNode = sampleFieldDerived({
    coordinate: coordinateUniform,
    seed: seedUniform,
    warpStrength: warpStrengthUniform,
  });

  const mesh = new Mesh(new PlaneGeometry(2, 2), packedMaterial);
  const scene = new Scene();
  scene.add(mesh);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new RenderTarget(1, 1, { type: FloatType });

  async function readMaterial(material, probe) {
    const inputs = probeGpuInputs(probe);
    coordinateUniform.value.set(inputs.coordinate[0], inputs.coordinate[1], inputs.coordinate[2]);
    seedUniform.value = inputs.seed;
    warpStrengthUniform.value = inputs.warpStrength;
    mesh.material = material;
    await renderer.renderAsync(scene, camera);
    renderer.setRenderTarget(target);
    await renderer.renderAsync(scene, camera);
    renderer.setRenderTarget(null);
    // r185 signature: (renderTarget, x, y, w, h, textureIndex = 0, faceIndex = 0);
    // it allocates and returns the typed array itself - passing a destination
    // buffer as arg 6 is read as textureIndex and crashes the backend lookup.
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
    return Array.from(pixels);
  }

  async function captureFieldReadback(probes = fixedProbes) {
    const samples = [];
    for (const probe of probes) {
      const packed = await readMaterial(packedMaterial, probe);
      const derived = await readMaterial(derivedMaterial, probe);
      samples.push({
        probe,
        values: {
          ...unpackVector(FIELD_PARITY_CHANNELS.slice(0, 4), packed),
          ...unpackVector(FIELD_PARITY_CHANNELS.slice(4), derived),
        },
      });
    }
    return {
      version: 1,
      renderer: {
        threeRevision: REVISION,
        isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
        outputBufferType: renderer.getOutputBufferType?.() ?? null,
      },
      constants: {
        hash: FIELD_ALGORITHM.hash,
        bands: FIELD_ALGORITHM.bands,
        derived: FIELD_ALGORITHM.derived,
      },
      channels: FIELD_PARITY_CHANNELS,
      samples,
    };
  }

  return {
    renderer,
    ready: true,
    captureFieldReadback,
  };
}

window.__fieldBakeValidation = {
  ready: false,
  error: null,
  captureFieldReadback: null,
};

createApp()
  .then((app) => {
    window.__fieldBakeValidation = {
      ready: true,
      error: null,
      captureFieldReadback: app.captureFieldReadback,
    };
    setStatus("ready");
  })
  .catch((error) => {
    window.__fieldBakeValidation.error = error.stack ?? error.message;
    setStatus(error.message);
    console.error(error);
  });
