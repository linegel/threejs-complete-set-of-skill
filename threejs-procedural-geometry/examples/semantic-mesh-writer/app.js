import {
  createGeometryLabController,
  GEOMETRY_MODES,
  GEOMETRY_TIERS,
} from "./lab-controller.js";

function fixedRoute(pathname) {
  const mechanism = pathname.match(/\/mechanism\/([^/]+)/)?.[1] ?? null;
  const tier = pathname.match(/\/tier\/([^/]+)/)?.[1] ?? null;
  return { mechanism, tier };
}

const canvas = document.querySelector("#scene");
const modeSelect = document.querySelector("#mode");
const tierSelect = document.querySelector("#tier");
const status = document.querySelector("#status");
const route = fixedRoute(window.location.pathname);

if (route.mechanism && !GEOMETRY_MODES.includes(route.mechanism)) {
  throw new RangeError(`Unknown mechanism route "${route.mechanism}"`);
}
if (route.tier && !GEOMETRY_TIERS.includes(route.tier)) {
  throw new RangeError(`Unknown tier route "${route.tier}"`);
}

for (const id of GEOMETRY_MODES) modeSelect.add(new Option(id, id));
for (const id of GEOMETRY_TIERS) tierSelect.add(new Option(id, id));
if (route.mechanism) modeSelect.value = route.mechanism;
if (route.tier) tierSelect.value = route.tier;

const controller = await createGeometryLabController({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: Math.min(window.devicePixelRatio, 2),
  mode: modeSelect.value,
  tier: tierSelect.value,
  routeLock: {
    mode: route.mechanism,
    tier: route.tier,
  },
});
window.labController = controller;

modeSelect.disabled = Boolean(route.mechanism);
tierSelect.disabled = Boolean(route.tier);
modeSelect.addEventListener("change", async () => controller.setMode(modeSelect.value));
tierSelect.addEventListener("change", async () => controller.setTier(tierSelect.value));
const resize = () => controller.resize(
  window.innerWidth,
  window.innerHeight,
  Math.min(window.devicePixelRatio, 2),
);
window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  window.removeEventListener("resize", resize);
  controller.dispose();
}, { once: true });

let previous = performance.now();
async function frame(now) {
  const delta = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  await controller.step(delta);
  await controller.renderOnce();
  const metrics = controller.getMetrics();
  status.textContent = `${metrics.mode} · ${metrics.tier} · native WebGPU`;
  requestAnimationFrame(frame);
}
if (new URLSearchParams(window.location.search).get("capture") !== "1") {
  requestAnimationFrame(frame);
}
