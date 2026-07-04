import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
} from "three";
import { RenderPipeline, WebGPURenderer } from "three/webgpu";
import { pass, renderOutput } from "three/tsl";

import { CameraDirectionController, computeScreenOccupancy } from "./CameraDirectionController.mjs";

export async function createCameraRigDemo({ canvas, documentRef = globalThis.document } = {}) {
  const renderer = new WebGPURenderer({ canvas, antialias: true, reversedDepthBuffer: true });
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("WebGPU backend required for the canonical camera rig example. Route explicit WebGPU-unavailable fallback teaching to threejs-compatibility-fallbacks.");
  }
  const tier = "full";
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 16 / 9, 0.3, 2000);
  camera.position.set(0, 2, 12);

  const subject = new Mesh(
    new BoxGeometry(1.5, 0.8, 4),
    new MeshStandardMaterial({ color: 0x8da8ff }),
  );
  scene.add(subject);

  const controller = new CameraDirectionController(camera, {
    subject,
    subjectBounds: new Sphere(new Vector3(), 2.2),
  });
  const debugElement = documentRef?.querySelector?.("[data-camera-debug]") ?? null;
  const debugForward = new Vector3();
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputNode = renderOutput(pass(scene, camera).getTextureNode("output"));

  const buttons = documentRef?.querySelectorAll?.("[data-camera-mode]") ?? [];
  for (const button of buttons) {
    button.addEventListener("click", () => controller.startHandoff(button.dataset.cameraMode));
  }

  let last = 0;
  renderer.setAnimationLoop((time) => {
    const dt = Math.min((time - last) / 1000 || 1 / 60, 1 / 20);
    last = time;
    const mode = controller.update(dt);
    if (debugElement) {
      camera.updateMatrixWorld(true);
      camera.getWorldDirection(debugForward);
      const target = controller.subjectWorldPosition(controller.scratch.target);
      const distance = Math.max(0.001, camera.position.distanceTo(target));
      const occupancy = computeScreenOccupancy(camera, distance, controller.subjectRadius(), controller.scratch);
      debugElement.textContent = JSON.stringify({
        tier,
        mode,
        cameraPosition: camera.position.toArray().map((value) => Number(value.toFixed(3))),
        forward: debugForward.toArray().map((value) => Number(value.toFixed(3))),
        occupancy: {
          vertical: Number(occupancy.vertical.toFixed(3)),
          horizontal: Number(occupancy.horizontal.toFixed(3)),
        },
      }, null, 2);
    }
    renderPipeline.render();
  });

  return { renderer, renderPipeline, scene, camera, controller, tier, debugElement };
}
