import { Vector2 } from "three/webgpu";

import { createWebGPUDenseGrassSystem } from "./dense-grass-system.js";

/** Renderer/output-neutral adapter shared by Weathered World and Creature Habitat. */
export async function createDenseVegetationSceneAdapter({
  renderer,
  scene,
  camera,
  pipeline,
  weather,
  worldUnitsPerMeter = 1,
  tier = "medium",
  seed = 1,
} = {}) {
  if (!renderer || !scene || !camera || !pipeline || !weather) {
    throw new Error("vegetation integration adapter requires host renderer, scene, camera, pipeline, and weather");
  }
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("vegetation integration adapter requires an initialized native WebGPU renderer");
  }
  if (!(worldUnitsPerMeter > 0) || !Number.isFinite(worldUnitsPerMeter)) {
    throw new Error("vegetation worldUnitsPerMeter must be finite and positive");
  }

  const system = await createWebGPUDenseGrassSystem(renderer, {
    tier,
    seed,
    worldUnitsPerMeter,
  });
  scene.add(system.object);
  let disposed = false;

  return {
    system,
    update({ contacts = [], time = weather.time ?? 0 } = {}) {
      if (disposed) throw new Error("vegetation integration adapter is disposed");
      const direction = weather.windDirection ?? { x: 1, z: 0 };
      system.setWind({
        direction: new Vector2(direction.x, direction.z ?? direction.y ?? 0),
        strength: weather.windStrength ?? 0,
        speed: weather.windSpeed ?? 0,
      });
      system.setTouches(contacts);
      system.update({ elapsed: time, camera });
    },
    describeOwnership() {
      return {
        owns: ["vegetation placement storage", "vegetation geometry", "rooted deformation", "touch response"],
        consumes: ["host renderer", "host camera", "host pipeline", "shared weather", "shared creature contacts"],
        doesNotOwn: ["renderer", "camera", "weather", "shadow policy", "tone map", "output transform"],
        worldUnitsPerMeter,
        scaledPatchSize: system.options.patchSize,
        authoredPatchSizeMeters: system.options.patchSizeMeters,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(system.object);
      system.dispose();
    },
  };
}
