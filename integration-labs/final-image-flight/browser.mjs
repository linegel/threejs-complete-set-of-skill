import { createFinalImageFlightLab } from "./main.mjs";
import {
  FINAL_IMAGE_FLIGHT_CAMERAS,
  FINAL_IMAGE_FLIGHT_MODES,
  FINAL_IMAGE_FLIGHT_SEEDS,
} from "./routes.mjs";

const canvas = document.querySelector("[data-flight-canvas]");
const status = document.querySelector("[data-flight-status]");
const modeSelect = document.querySelector("[data-flight-mode]");
const cameraSelect = document.querySelector("[data-flight-camera]");
const seedSelect = document.querySelector("[data-flight-seed]");

if (!canvas) throw new Error("Final Image Flight browser entry requires [data-flight-canvas]");
if (!navigator.gpu) {
  const error = new Error("Native WebGPU is unavailable; Final Image Flight does not activate a fallback");
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

appendOptions(modeSelect, FINAL_IMAGE_FLIGHT_MODES);
appendOptions(cameraSelect, FINAL_IMAGE_FLIGHT_CAMERAS);
appendOptions(seedSelect, FINAL_IMAGE_FLIGHT_SEEDS, (value) => `0x${value.toString(16).padStart(8, "0")}`);

try {
  const searchParams = new URLSearchParams(location.search);
  const automatedCapture = searchParams.get("capture") === "1"
    || searchParams.get("physicalReview") === "1";
  const lab = await createFinalImageFlightLab({
    canvas,
    documentRef: document,
    locationRef: location,
    startAnimationLoop: automatedCapture !== true,
  });
  const controller = lab.labController;
  globalThis.__FINAL_IMAGE_FLIGHT__ = lab;
  globalThis.__LAB_CONTROLLER__ = controller;
  globalThis.labController = controller;
  // Capture hosts lock 1200x800; ensure logical extent matches before first metrics.
  if (automatedCapture && typeof controller.resize === "function") {
    await controller.resize(1200, 800, 1);
  }
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
    seedSelect.value = String(FINAL_IMAGE_FLIGHT_SEEDS[0]);
    seedSelect.addEventListener("change", async () => {
      await controller.setSeed(Number(seedSelect.value));
      await controller.renderOnce();
    });
  }
  const resize = async () => {
    if (automatedCapture) {
      await controller.resize(1200, 800, 1);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    await controller.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), devicePixelRatio || 1);
  };
  const observer = new ResizeObserver(() => void resize());
  if (!automatedCapture) observer.observe(canvas);
  window.addEventListener("pagehide", () => {
    observer.disconnect();
    if (!automatedCapture) void controller.dispose();
  }, { once: true });
  const readiness = (async () => {
    await resize();
    await controller.ready?.();
  })();
  globalThis.__LAB_READY__ = readiness;
  await readiness;
  if (status) status.textContent = "Native WebGPU active. Acceptance remains incomplete until the v2 evidence bundle is captured and validated.";
} catch (error) {
  globalThis.__LAB_ERROR__ = error;
  if (status) status.textContent = `BLOCKED: ${error.message}`;
  throw error;
}
