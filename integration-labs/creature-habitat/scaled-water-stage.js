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
 * Host-neutral bounded-water stage with an explicit integration resolution
 * policy. `waterScale` scales both simulation width/height and mesh segments;
 * no descriptor-only scale survives into the runtime.
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

  const resolution = Math.max(32, Math.round(FULL_RESOLUTION * waterScale));
  const meshSegments = Math.max(24, Math.round(FULL_MESH_SEGMENTS * waterScale));
  const heightfield = new WebGPUBoundedWaterHeightfield(renderer, {
    tier,
    resolution,
    tierOverrides: { meshSegments },
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
  const mesh = createBoundedWaterMesh({ heightfield, segments: meshSegments, material });
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

