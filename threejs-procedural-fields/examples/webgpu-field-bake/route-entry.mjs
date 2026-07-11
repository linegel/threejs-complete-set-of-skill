import { resolveLockedRoute } from "./route-contract.mjs";

const kind = document.documentElement.dataset.routeKind;
const id = document.documentElement.dataset.routeId;
const manifest = await fetch(new URL("./lab.manifest.json", import.meta.url)).then((response) => {
  if (!response.ok) throw new Error(`Unable to load field lab manifest: ${response.status}`);
  return response.json();
});
const lockedRoute = resolveLockedRoute(manifest, kind, id);

await import("./browser-app.js");
await new Promise((resolve, reject) => {
  const deadline = performance.now() + 30000;
  const poll = () => {
    const controller = globalThis.__fieldBakeValidation;
    if (controller?.error) reject(new Error(controller.error));
    else if (controller?.ready) resolve();
    else if (performance.now() >= deadline) reject(new Error("field lab route initialization timed out"));
    else requestAnimationFrame(poll);
  };
  poll();
});

if (kind === "mechanism") await globalThis.__fieldBakeValidation.setScenario(id);
else await globalThis.__fieldBakeValidation.setTier(id);
Object.defineProperty(globalThis, "__lockedLabRoute", {
  configurable: false,
  enumerable: true,
  writable: false,
  value: lockedRoute,
});
Object.defineProperty(globalThis, "routeSelection", {
  configurable: false,
  enumerable: true,
  writable: false,
  value: Object.freeze(kind === "mechanism" ? { scenario: id } : { tier: id }),
});
document.documentElement.dataset.routeReady = "true";
