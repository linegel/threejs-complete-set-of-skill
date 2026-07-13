import { createWeatherSurfaceLab, parseWeatherLabRoute, WEATHER_MODES } from "./weather-webgpu-lab.js";
import { WEATHER_MECHANISMS, WEATHER_QUALITY_TIERS } from "./precipitation-system.js";

const canvas = document.querySelector("canvas");
const status = document.querySelector("[data-status]");
const route = parseWeatherLabRoute(location.pathname, location.search);
const lab = await createWeatherSurfaceLab({ canvas, ...route, seed: 0x00000001 });

globalThis.__LAB_CONTROLLER__ = lab;
globalThis.labController = lab;
globalThis.__LAB_READY__ = true;

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
populate(mechanismSelect, WEATHER_MECHANISMS, route.mechanism);
populate(tierSelect, Object.keys(WEATHER_QUALITY_TIERS), route.tier);
populate(modeSelect, WEATHER_MODES, "final");

const mechanismLocked = location.pathname.split("/").includes("mechanism");
const tierLocked = location.pathname.split("/").includes("tier");
mechanismSelect.disabled = mechanismLocked;
tierSelect.disabled = tierLocked;
if (!mechanismLocked) mechanismSelect.addEventListener("change", () => lab.setScenario(mechanismSelect.value));
if (!tierLocked) tierSelect.addEventListener("change", () => lab.setTier(tierSelect.value));
modeSelect.addEventListener("change", () => lab.setMode(modeSelect.value));

const forcing = document.querySelector("[data-forcing]");
forcing.addEventListener("input", () => {
  lab.targetForcing = Number(forcing.value);
});

function resize() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  lab.resize(width, height, Math.min(devicePixelRatio, 2));
}

addEventListener("resize", resize);
resize();

const captureMode = new URLSearchParams(location.search).get("capture") === "1";
if (captureMode) {
  // Capture owns time/stepping; free-running RAF would desync locked capture state.
  status.textContent = JSON.stringify(lab.getMetrics(), null, 2);
} else {
  let previousTime = 0;
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
    status.textContent = JSON.stringify(lab.getMetrics(), null, 2);
  });
}

addEventListener("pagehide", () => lab.dispose(), { once: true });
