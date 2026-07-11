import {
  BUILDING_MODES,
  BUILDING_TIERS,
  createBuildingLabController,
} from "./lab-controller.js";

function fixedRoute(pathname) {
  return {
    mechanism: pathname.match(/\/mechanism\/([^/]+)/)?.[1] ?? null,
    tier: pathname.match(/\/tier\/([^/]+)/)?.[1] ?? null,
  };
}

const route = fixedRoute(window.location.pathname);
if (route.mechanism && !BUILDING_MODES.includes(route.mechanism)) {
  throw new RangeError(`Unknown mechanism route "${route.mechanism}"`);
}
if (route.tier && !BUILDING_TIERS.includes(route.tier)) {
  throw new RangeError(`Unknown tier route "${route.tier}"`);
}
const canvas = document.querySelector("#scene");
const modeSelect = document.querySelector("#mode");
const tierSelect = document.querySelector("#tier");
const status = document.querySelector("#status");
BUILDING_MODES.forEach((id) => modeSelect.add(new Option(id, id)));
BUILDING_TIERS.forEach((id) => tierSelect.add(new Option(id, id)));
if (route.mechanism) modeSelect.value = route.mechanism;
if (route.tier) tierSelect.value = route.tier;

const controller = await createBuildingLabController({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: Math.min(window.devicePixelRatio, 2),
  mode: modeSelect.value,
  tier: tierSelect.value,
});
window.labController = controller;
modeSelect.disabled = Boolean(route.mechanism);
tierSelect.disabled = Boolean(route.tier);
modeSelect.addEventListener("change", () => controller.setMode(modeSelect.value));
tierSelect.addEventListener("change", () => controller.setTier(tierSelect.value));
window.addEventListener("resize", () => controller.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio, 2)));

async function frame() {
  await controller.renderOnce();
  const metrics = controller.getMetrics();
  status.textContent = `${metrics.mode} · ${metrics.tier} · native WebGPU`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
