import {
  Color,
  DataTexture,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";

import {
  TSLCurvedRayAccretionEffect,
  configureColorTexture,
  prepareCurvedRayRenderer,
} from "./curved-ray-accretion.js";

export function createCurvedRayDemoScene({
  seed = 7,
  quality = "standard",
  temporalHistory = false,
  starTexture = null,
} = {}) {
  const scene = new Scene();
  scene.background = new Color(0x02030a);

  const camera = new PerspectiveCamera(55, 1, 0.01, 100);
  camera.position.set(0, 0.14, 2.35);

  const effect = new TSLCurvedRayAccretionEffect({
    seed,
    quality,
    temporalHistory,
    ...(starTexture ? { starTexture } : {}),
    width: 1280,
    height: 720,
  });
  effect.mesh.scale.setScalar(1.18);
  scene.add(effect.mesh);

  return { scene, camera, effect };
}

export function resizeRendererToDisplay(renderer, camera, container) {
  const width = Math.max(1, Math.floor(container?.clientWidth ?? globalThis.innerWidth ?? 1));
  const height = Math.max(1, Math.floor(container?.clientHeight ?? globalThis.innerHeight ?? 1));
  const canvas = renderer.domElement;

  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

export async function runCurvedRayAccretionDemo({
  canvas = globalThis.document?.querySelector("canvas"),
  container = globalThis.document?.body,
  seed = 7,
  quality = "standard",
  temporalHistory = false,
} = {}) {
  if (!canvas) {
    throw new Error("runCurvedRayAccretionDemo requires a canvas element.");
  }

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));

  const demo = createCurvedRayDemoScene({ seed, quality, temporalHistory });
  const prepareResult = await prepareCurvedRayRenderer({
    renderer,
    scene: demo.scene,
    camera: demo.camera,
    effect: demo.effect,
  });

  let animationFrame = 0;
  const renderFrame = (timeMs) => {
    resizeRendererToDisplay(renderer, demo.camera, container);
    demo.effect.update(timeMs * 0.001);
    renderer.render(demo.scene, demo.camera);
    animationFrame = globalThis.requestAnimationFrame(renderFrame);
  };

  animationFrame = globalThis.requestAnimationFrame(renderFrame);

  return {
    ...demo,
    renderer,
    prepareResult,
    stop() {
      globalThis.cancelAnimationFrame(animationFrame);
      demo.effect.dispose();
      renderer.dispose();
    },
  };
}

export function createCurvedRaySmokeReport() {
  const starTexture = configureColorTexture(
    new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType),
    { mipmaps: false },
  );
  const { effect } = createCurvedRayDemoScene({ starTexture });
  const report = {
    pass: true,
    mesh: effect.mesh.type,
    quality: effect.metrics().quality,
    maxAcceptedSteps: effect.metrics().maxAcceptedSteps,
    proxyDraws: effect.metrics().proxyDraws,
    dispatches: effect.metrics().dispatches,
  };

  effect.dispose();
  return report;
}

if (typeof process !== "undefined" && process.argv?.includes("--smoke")) {
  console.log(JSON.stringify(createCurvedRaySmokeReport(), null, 2));
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", async () => {
    const status = document.querySelector("[data-status]");

    try {
      const demo = await runCurvedRayAccretionDemo({
        canvas: document.querySelector("canvas"),
        container: document.querySelector("[data-stage]") ?? document.body,
      });

      if (status) {
        status.textContent = demo.prepareResult.isWebGPUBackend ? "WebGPU" : "Coverage";
      }
    } catch (error) {
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
      }
      console.error(error);
    }
  });
}
