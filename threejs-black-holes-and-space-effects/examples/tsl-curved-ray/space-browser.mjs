import { mountSpaceIntegratorLab } from "./space-lab.mjs";

const animate = new URL(globalThis.location.href).searchParams.get("capture") !== "1";
const mountedPromise = mountSpaceIntegratorLab({
  canvas: document.querySelector("canvas"),
  status: document.querySelector("[data-status]"),
  metrics: document.querySelector("[data-metrics]"),
  animate,
});
const controllerPromise = mountedPromise.then(({ lab }) => lab);
globalThis.labController = controllerPromise;
globalThis.__LAB_CONTROLLER__ = controllerPromise;
globalThis.__LAB_READY__ = controllerPromise;
controllerPromise.catch(() => {});

mountedPromise.then((mounted) => {
  globalThis.labController = mounted.lab;
  globalThis.__LAB_CONTROLLER__ = mounted.lab;
  globalThis.__THREE_LAB_STOP__ = mounted.stop;
}).catch((error) => {
  globalThis.__LAB_ERROR__ = error;
  const status = document.querySelector("[data-status]");
  if (status) status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
