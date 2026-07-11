import { mountNativePooledEffectsLab } from "./lab.mjs";

const canvas = document.querySelector("canvas");
const status = document.querySelector("[data-status]");
const metrics = document.querySelector("[data-metrics]");

const animate = new URL(globalThis.location.href).searchParams.get("capture") !== "1";
mountNativePooledEffectsLab({ canvas, status, metrics, animate }).then((mounted) => {
  globalThis.__THREE_LAB_STOP__ = mounted.stop;
}).catch((error) => {
  if (status) status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
