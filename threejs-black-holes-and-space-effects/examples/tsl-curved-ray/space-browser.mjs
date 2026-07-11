import { mountSpaceIntegratorLab } from "./space-lab.mjs";

const animate = new URL(globalThis.location.href).searchParams.get("capture") !== "1";
mountSpaceIntegratorLab({
  canvas: document.querySelector("canvas"),
  status: document.querySelector("[data-status]"),
  metrics: document.querySelector("[data-metrics]"),
  animate,
}).then((mounted) => {
  globalThis.__THREE_LAB_STOP__ = mounted.stop;
}).catch((error) => {
  const status = document.querySelector("[data-status]");
  if (status) status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
