import { float } from "three/tsl";

import {
  WATER_QUALITY_TIERS,
  WebGPUBoundedWaterHeightfield,
  createBoundedWaterMaterial,
  createBoundedWaterMesh,
} from "../../threejs-water-optics/examples/webgpu-bounded-water/webgpu-bounded-water.js";
import { createBoundedWaterHeightQuery } from "../../threejs-water-optics/examples/webgpu-bounded-water/cpu-water-height.js";

const FULL_RESOLUTION = WATER_QUALITY_TIERS.ultra.resolution;
const FULL_MESH_SEGMENTS = WATER_QUALITY_TIERS.ultra.meshSegments;

/**
 * Host-neutral bounded-water stage that validates the integration's declared
 * scale against the selected canonical water tier. Simulation and mesh
 * resources remain owned by that exact tier; no private override survives.
 */
export async function createScaledBoundedWaterStage({
  renderer,
  weatherState = null,
  tier = "high",
  waterScale = 1,
  seed = 1,
  timeNode = float(0),
  parameters = {},
  opticalInputs = null,
} = {}) {
  if (!renderer) throw new TypeError("scaled bounded-water stage requires a renderer");
  if (!WATER_QUALITY_TIERS[tier]) throw new RangeError(`unknown bounded-water tier "${tier}"`);
  if (!Number.isFinite(waterScale) || waterScale <= 0 || waterScale > 1) {
    throw new RangeError("waterScale must be finite inside (0,1]");
  }
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("scaled bounded-water stage requires initialized native WebGPU");
  }

  const selectedTier = WATER_QUALITY_TIERS[tier];
  const resolution = selectedTier.resolution;
  const meshSegments = selectedTier.meshSegments;
  const canonicalWaterScale = resolution / FULL_RESOLUTION;
  if (Math.abs(waterScale - canonicalWaterScale) > Number.EPSILON) {
    throw new RangeError(
      `waterScale ${waterScale} must equal canonical ${tier} tier ratio ${canonicalWaterScale}`,
    );
  }
  const heightfield = new WebGPUBoundedWaterHeightfield(renderer, {
    tier,
    parameters,
  });
  heightfield.initialize();
  const material = createBoundedWaterMaterial({
    heightfield,
    timeNode,
    parameters: heightfield.parameters,
    analyticBandCount: heightfield.tier.analyticBands,
    microBandCount: heightfield.tier.microBands,
    sceneColorNode: opticalInputs?.sceneColorNode ?? null,
    sceneDepthNode: opticalInputs?.sceneDepthNode ?? null,
  });
  const mesh = createBoundedWaterMesh({ heightfield, material });
  const heightQuery = createBoundedWaterHeightQuery({
    analyticBandCount: heightfield.tier.analyticBands,
    parameters: heightfield.parameters,
  });
  let disposed = false;

  return {
    id: "creature-habitat-scaled-bounded-water",
    renderer,
    weatherState,
    tier,
    seed,
    waterScale,
    resolution,
    meshSegments,
    heightfield,
    heightQuery,
    material,
    mesh,
    update(deltaSeconds) {
      if (disposed) throw new Error("scaled bounded-water stage is disposed");
      if (weatherState?.waterDrop) heightfield.setDrop(weatherState.waterDrop);
      const result = heightfield.step(deltaSeconds);
      material.userData.syncSimulationTextures();
      return result;
    },
    describeSignals() {
      return {
        produces: ["bounded-water-height", "bounded-water-derivatives", "bounded-water-touch-history"],
        consumes: weatherState ? ["weather-time", "weather-precipitation", "weather-wind"] : [],
      };
    },
    describeResources() {
      return {
        ...heightfield.describeResources(),
        policy: {
          waterScale,
          referenceResolution: FULL_RESOLUTION,
          actualResolution: resolution,
          referenceMeshSegments: FULL_MESH_SEGMENTS,
          actualMeshSegments: meshSegments,
        },
        geometryBytes: mesh.userData.geometryBytes,
      };
    },
    describeDispatches: () => heightfield.describeDispatches(),
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.geometry.dispose();
      material.dispose();
      heightfield.dispose();
    },
  };
}
