import { createRelativisticSpaceShotLab } from "./main.mjs";
import {
  RELATIVISTIC_CAMERAS,
  RELATIVISTIC_MODES,
  RELATIVISTIC_SEEDS,
} from "./routes.mjs";

const canvas = document.querySelector("[data-space-canvas]");
const status = document.querySelector("[data-space-status]");
const modeSelect = document.querySelector("[data-space-mode]");
const cameraSelect = document.querySelector("[data-space-camera]");
const seedSelect = document.querySelector("[data-space-seed]");

if (!canvas) throw new Error("Relativistic Space Shot browser entry requires [data-space-canvas]");
if (!navigator.gpu) {
  const error = new Error("Native WebGPU is unavailable; Relativistic Space Shot does not activate a fallback");
  globalThis.__LAB_ERROR__ = error;
  if (status) status.textContent = `BLOCKED: ${error.message}`;
  throw error;
}

function appendOptions(select, values, format = String) {
  if (!select) return;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = format(value);
    select.append(option);
  }
}

appendOptions(modeSelect, RELATIVISTIC_MODES);
appendOptions(cameraSelect, RELATIVISTIC_CAMERAS);
appendOptions(seedSelect, RELATIVISTIC_SEEDS, (value) => `0x${value.toString(16).padStart(8, "0")}`);

try {
  const lab = await createRelativisticSpaceShotLab({ canvas, documentRef: document, locationRef: location });
  const controller = lab.labController;
  globalThis.__RELATIVISTIC_SPACE_SHOT__ = lab;
  globalThis.__LAB_CONTROLLER__ = controller;
  globalThis.labController = controller;
  if (modeSelect) {
    modeSelect.value = lab.route.mode;
    modeSelect.disabled = lab.route.modeLocked;
    modeSelect.addEventListener("change", async () => {
      await controller.setMode(modeSelect.value);
      await controller.renderOnce();
    });
  }
  if (cameraSelect) {
    cameraSelect.value = "design";
    cameraSelect.addEventListener("change", async () => {
      await controller.setCamera(cameraSelect.value);
      await controller.renderOnce();
    });
  }
  if (seedSelect) {
    seedSelect.value = String(RELATIVISTIC_SEEDS[0]);
    seedSelect.addEventListener("change", async () => {
      await controller.setSeed(Number(seedSelect.value));
      await controller.renderOnce();
    });
  }
  const resize = async () => {
    const rect = canvas.getBoundingClientRect();
    await controller.resize(
      Math.max(1, Math.round(rect.width)),
      Math.max(1, Math.round(rect.height)),
      devicePixelRatio || 1,
    );
  };
  const observer = new ResizeObserver(() => void resize());
  observer.observe(canvas);
  window.addEventListener("pagehide", () => {
    observer.disconnect();
    void controller.dispose();
  }, { once: true });
  await resize();
  await controller.ready();
  if (status) status.textContent = "Native WebGPU active. Acceptance remains incomplete until the v2 evidence bundle is captured and validated.";
} catch (error) {
  globalThis.__LAB_ERROR__ = error;
  if (status) status.textContent = `BLOCKED: ${error.message}`;
  throw error;
}
