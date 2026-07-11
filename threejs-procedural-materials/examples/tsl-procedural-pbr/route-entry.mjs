import { resolveLockedRoute } from "./route-contract.mjs";

const kind = document.documentElement.dataset.routeKind;
const id = document.documentElement.dataset.routeId;
const manifest = await fetch(new URL("./lab.manifest.json", import.meta.url)).then((response) => {
  if (!response.ok) throw new Error(`Unable to load material lab manifest: ${response.status}`);
  return response.json();
});
const lockedRoute = resolveLockedRoute(manifest, kind, id);

await import("./main.js");
await new Promise((resolve, reject) => {
  const deadline = performance.now() + 30000;
  const poll = () => {
    if (globalThis.labController ?? globalThis.__LAB_CONTROLLER__ ?? globalThis.__proceduralPbrLab) resolve();
    else if (performance.now() >= deadline) reject(new Error("material lab route initialization timed out"));
    else requestAnimationFrame(poll);
  };
  poll();
});

const controller = globalThis.labController ?? globalThis.__LAB_CONTROLLER__ ?? globalThis.__proceduralPbrLab;
await controller.ready();
if (kind === "mechanism") await controller.setScenario(id);
else await controller.setTier(id);
const state = controller.getMetrics().state;
if (kind === "mechanism" && state.scenario !== id) {
  throw new Error(`material mechanism route did not acknowledge ${id}`);
}
if (kind === "tier" && state.tier !== id) {
  throw new Error(`material tier route did not acknowledge ${id}`);
}
Object.defineProperty(globalThis, "__lockedLabRoute", {
  configurable: false,
  enumerable: true,
  writable: false,
  value: lockedRoute,
});
document.documentElement.dataset.routeReady = "true";
