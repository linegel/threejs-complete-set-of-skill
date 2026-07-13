import { FROST_MECHANISMS, FROST_QUALITY_TIERS } from "./frost-surface-effect.js";
import { createFrostLab, FROST_LAB_MODES, parseFrostLabRoute } from "./frost-webgpu-lab.js";

const canvas = document.querySelector("canvas");
const status = document.querySelector("[data-status]");
const readiness = document.querySelector("[data-readiness]");
const metricsDetails = document.querySelector("[data-metrics]");
const route = parseFrostLabRoute(location.pathname, location.search);
const runtimeProfile = globalThis.__LAB_CAPTURE_PROFILE__?.id ?? "correctness";
const automatedCapture = new URLSearchParams(location.search).get("capture") === "1";
const lab = await createFrostLab({ canvas, ...route, seed: 0x00000001, runtimeProfile });

globalThis.labController = lab;
globalThis.__LAB_CONTROLLER__ = lab;
globalThis.__THREEJS_LAB__ = lab;
globalThis.__LAB_READY__ = true;
document.documentElement.dataset.ready = "true";
readiness.textContent = "WebGPU ready";

function populate(select, values, selected) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    select.append(option);
  }
}

const mechanismSelect = document.querySelector("[data-mechanism]");
const tierSelect = document.querySelector("[data-tier]");
const modeSelect = document.querySelector("[data-mode]");
populate(mechanismSelect, FROST_MECHANISMS, route.mechanism);
populate(tierSelect, Object.keys(FROST_QUALITY_TIERS), route.tier);
function refreshModes() {
  modeSelect.replaceChildren();
  populate(modeSelect, lab.getAvailableModes(), lab.mode);
}
refreshModes();
const mechanismLocked = location.pathname.split("/").includes("mechanism");
const tierLocked = location.pathname.split("/").includes("tier");
mechanismSelect.disabled = mechanismLocked;
tierSelect.disabled = tierLocked;
if (!mechanismLocked) mechanismSelect.addEventListener("change", async () => {
  await lab.setMechanism(mechanismSelect.value);
  refreshModes();
});
if (!tierLocked) tierSelect.addEventListener("change", async () => {
  await lab.setTier(tierSelect.value);
  refreshModes();
});
modeSelect.addEventListener("change", () => lab.setMode(modeSelect.value));
document.querySelector("[data-clear]").addEventListener("click", () => lab.resetHistory("manual-clear"));

function pointerUv(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: 1 - Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

let pointerDown = false;
let previousPointer = { x: 0.5, y: 0.5 };
canvas.addEventListener("pointerdown", (event) => {
  pointerDown = true;
  previousPointer = pointerUv(event);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  const next = pointerUv(event);
  if (pointerDown) {
    lab.queuePointerSegment(previousPointer, next, event.pressure > 0 ? event.pressure : 0.8, true);
  }
  previousPointer = next;
});
function finishPointer(event) {
  pointerDown = false;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);

function resize() {
  lab.resize(
    Math.max(1, canvas.clientWidth),
    Math.max(1, canvas.clientHeight),
    Math.min(devicePixelRatio, 2),
  );
}
addEventListener("resize", resize);
resize();

let previousTime = 0;
let nextMetricsUpdate = 0;
if (!automatedCapture) {
  lab.renderer.setAnimationLoop((timestamp) => {
    if (previousTime === 0) previousTime = timestamp;
    let elapsed = Math.max(0, (timestamp - previousTime) / 1000);
    previousTime = timestamp;
    while (elapsed > 0) {
      const step = Math.min(elapsed, 1 / 30);
      lab.step(step);
      elapsed -= step;
    }
    lab.renderOnce();
    if (metricsDetails.open && timestamp >= nextMetricsUpdate) {
      status.textContent = JSON.stringify(lab.getMetrics(), null, 2);
      nextMetricsUpdate = timestamp + 250;
    }
  });
}

addEventListener("pagehide", () => lab.dispose(), { once: true });
