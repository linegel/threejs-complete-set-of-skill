import {
  createTowerShipLabController,
  resolveFrameDeltaSeconds,
  TOWER_SHIP_CAMERAS,
  TOWER_SHIP_MODES,
  TOWER_SHIP_TIERS,
} from "./lab-controller.js";

const MODE_COPY = Object.freeze({
  final: ["Final reconstruction", "Reference-shaped geometry, mixed materials, and authored light."],
  blockout: ["Blockout", "Identity-critical masses only; surface polish and deck props are suppressed."],
  hierarchy: ["Semantic hierarchy", "Color separates hull, tower, rig, oars, and detachable detail systems."],
  materials: ["Material study", "Neutral motion state for wood, paper, cloth, rope, and metal response."],
  interaction: ["Interaction proof", "Twenty-four oars row from named hinge sockets while the sail and lanterns react."],
});

function fixedRoute(pathname) {
  return {
    mechanism: pathname.match(/\/mechanism\/([^/]+)/)?.[1] ?? null,
    tier: pathname.match(/\/tier\/([^/]+)/)?.[1] ?? null,
  };
}

function addOptions(select, values) {
  for (const value of values) select.add(new Option(value.replaceAll("-", " "), value));
}

const canvas = document.querySelector("#scene");
const modeSelect = document.querySelector("#mode");
const tierSelect = document.querySelector("#tier");
const cameraSelect = document.querySelector("#camera");
const status = document.querySelector("#status");
const modeTitle = document.querySelector("#mode-title");
const modeDescription = document.querySelector("#mode-description");
const metricNodes = document.querySelector("#metric-nodes");
const metricTriangles = document.querySelector("#metric-triangles");
const metricOars = document.querySelector("#metric-oars");
const referencePanel = document.querySelector("#reference-panel");
const referenceImage = document.querySelector("#reference-image");
const compareButton = document.querySelector("#compare");
const route = fixedRoute(window.location.pathname);
referenceImage.src = new URL("./reference/tower-ship-reference.png", import.meta.url).href;

if (route.mechanism && !TOWER_SHIP_MODES.includes(route.mechanism)) throw new RangeError(`Unknown mechanism route "${route.mechanism}"`);
if (route.tier && !TOWER_SHIP_TIERS.includes(route.tier)) throw new RangeError(`Unknown tier route "${route.tier}"`);

addOptions(modeSelect, TOWER_SHIP_MODES);
addOptions(tierSelect, TOWER_SHIP_TIERS);
addOptions(cameraSelect, TOWER_SHIP_CAMERAS);
if (route.mechanism) modeSelect.value = route.mechanism;
if (route.tier) tierSelect.value = route.tier;
modeSelect.disabled = Boolean(route.mechanism);
tierSelect.disabled = Boolean(route.tier);

const controller = await createTowerShipLabController({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: Math.min(window.devicePixelRatio, 2),
  mode: modeSelect.value,
  tier: tierSelect.value,
  camera: cameraSelect.value,
});
window.labController = controller;

function updateModeCopy() {
  const [title, description] = MODE_COPY[modeSelect.value];
  modeTitle.textContent = title;
  modeDescription.textContent = description;
}

modeSelect.addEventListener("change", async () => {
  await controller.setMode(modeSelect.value);
  updateModeCopy();
});
tierSelect.addEventListener("change", async () => controller.setTier(tierSelect.value));
cameraSelect.addEventListener("change", async () => controller.setCamera(cameraSelect.value));
compareButton.addEventListener("click", () => {
  const open = referencePanel.toggleAttribute("data-open");
  compareButton.setAttribute("aria-pressed", String(open));
  compareButton.textContent = open ? "Hide reference" : "Compare reference";
});
window.addEventListener("resize", () => controller.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio, 2)));
updateModeCopy();

let previous = performance.now();
let lastHudUpdate = 0;
async function frame(now) {
  const delta = resolveFrameDeltaSeconds(now, previous);
  previous = now;
  await controller.step(delta);
  await controller.renderOnce();
  if (now - lastHudUpdate > 240) {
    lastHudUpdate = now;
    const metrics = controller.getMetrics();
    status.textContent = `${metrics.mode} · ${metrics.tier} · native WebGPU`;
    metricNodes.textContent = metrics.nodes.toLocaleString();
    metricTriangles.textContent = Math.round(metrics.triangles).toLocaleString();
    metricOars.textContent = metrics.oars;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
