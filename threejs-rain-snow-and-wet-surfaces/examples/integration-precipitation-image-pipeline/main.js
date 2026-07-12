import { PrecipitationImagePipelineBrowserHost } from "./browser-host.js";
import { resolveIntegrationRoute } from "./route-state.mjs";

async function boot() {
  const canvas = document.querySelector("#lab-canvas");
  const status = document.querySelector("#lab-status");
  if (!canvas || !status) throw new Error("precipitation integration page is incomplete");
  const route = resolveIntegrationRoute(globalThis.location.href);
  const controller = new PrecipitationImagePipelineBrowserHost({ canvas, route });
  await controller.ready();
  globalThis.labController = controller;
  globalThis.__LAB_CONTROLLER__ = controller;
  globalThis.__lab = controller;

  const resize = async () => {
    const rect = canvas.getBoundingClientRect();
    await controller.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), globalThis.devicePixelRatio || 1);
  };
  const observer = new ResizeObserver(() => { void resize(); });
  observer.observe(canvas);
  await resize();

  let previous = performance.now();
  let busy = false;
  let frame = 0;
  controller.renderer.setAnimationLoop((timestamp) => {
    if (busy) return;
    busy = true;
    const delta = Math.min(0.05, Math.max(0, (timestamp - previous) / 1000));
    previous = timestamp;
    Promise.resolve(controller.step(delta))
      .then(() => controller.renderOnce())
      .then(() => {
        if (++frame % 20 === 0) status.textContent = JSON.stringify(controller.getMetrics(), null, 2);
      })
      .catch((error) => {
        controller.renderer.setAnimationLoop(null);
        status.textContent = String(error.stack || error.message);
        globalThis.__labError = error;
      })
      .finally(() => { busy = false; });
  });
  status.textContent = JSON.stringify(controller.getMetrics(), null, 2);
  globalThis.addEventListener("beforeunload", () => {
    observer.disconnect();
    void controller.dispose();
  }, { once: true });
  return controller;
}

const controllerPromise = boot();
globalThis.labController = controllerPromise;
globalThis.__LAB_CONTROLLER__ = controllerPromise;
controllerPromise.catch((error) => {
  const status = document.querySelector("#lab-status");
  if (status) status.textContent = `Native WebGPU blocked: ${error.stack || error.message}`;
  globalThis.__labError = error;
  throw error;
});
