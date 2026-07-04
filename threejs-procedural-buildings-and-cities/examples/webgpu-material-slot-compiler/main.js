import { Scene, PerspectiveCamera } from "three";
import { RenderPipeline, WebGPURenderer } from "three/webgpu";
import { pass, mrt, renderOutput } from "three/tsl";

import { createBuildingPlan } from "./building-plan.js";
import { compileBuilding } from "./compiler.js";
import { createBuildingNodeMaterials } from "./materials.js";

export async function createMaterialSlotCompilerDemo({ canvas } = {}) {
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 400);
  camera.position.set(36, 42, 58);
  const materials = createBuildingNodeMaterials();
  const plan = createBuildingPlan({ name: "single tower", footprint: "single", seed: 11 });
  const compiled = compileBuilding(plan, materials);
  scene.add(compiled.root);

  const renderPipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT?.(mrt({ output: "output", normal: "normal", emissive: "emissive" }));
  renderPipeline.outputNode = renderOutput(scenePass.getTextureNode?.("output") ?? scenePass);
  renderPipeline.outputColorTransform = true;
  return { renderer, renderPipeline, scene, camera, plan, compiled };
}
