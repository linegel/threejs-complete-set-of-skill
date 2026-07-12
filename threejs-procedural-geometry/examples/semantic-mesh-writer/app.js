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

modeSelect.disabled = Boolean(route.mechanism);
tierSelect.disabled = Boolean(route.tier);
const onModeChange = () => controller.setMode(modeSelect.value);
const onTierChange = () => controller.setTier(tierSelect.value);
const resize = () => controller.resize(
  window.innerWidth,
  window.innerHeight,
  Math.min(window.devicePixelRatio, 2),
);
modeSelect.addEventListener("change", onModeChange);
tierSelect.addEventListener("change", onTierChange);
window.addEventListener("resize", resize);

let animationFrameHandle = null;
let acceptingFrames = true;
let disposalPromise = null;
function detachListeners() {
  modeSelect.removeEventListener("change", onModeChange);
  tierSelect.removeEventListener("change", onTierChange);
  window.removeEventListener("resize", resize);
  window.removeEventListener("beforeunload", onBeforeUnload);
}
function disposeApp() {
  if (disposalPromise) return disposalPromise;
  acceptingFrames = false;
  if (animationFrameHandle !== null) cancelAnimationFrame(animationFrameHandle);
  animationFrameHandle = null;
  detachListeners();
  disposalPromise = Promise.resolve(controller.dispose());
  return disposalPromise;
}
function onBeforeUnload() {
  void disposeApp();
}
window.addEventListener("beforeunload", onBeforeUnload, { once: true });
window.labController = Object.freeze({ ...controller, dispose: disposeApp });

let previous = performance.now();
async function frame(now) {
  if (!acceptingFrames) return;
  const delta = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  try {
    await controller.step(delta);
    await controller.renderOnce();
    if (!acceptingFrames) return;
    const metrics = controller.getMetrics();
    status.textContent = `${metrics.mode} · ${metrics.tier} · native WebGPU`;
    animationFrameHandle = requestAnimationFrame(frame);
  } catch (error) {
    acceptingFrames = false;
    animationFrameHandle = null;
    window.__LAB_ERROR__ = Object.freeze({
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
    });
    status.textContent = `runtime error · ${window.__LAB_ERROR__.message}`;
    throw error;
  }
}
if (new URLSearchParams(window.location.search).get("capture") !== "1") {
  animationFrameHandle = requestAnimationFrame(frame);
}
