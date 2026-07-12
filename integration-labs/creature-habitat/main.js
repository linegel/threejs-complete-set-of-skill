import { createHabitatController } from "./habitat-controller.js";
import {
  HABITAT_CAMERAS,
  HABITAT_MODES,
  HABITAT_TIERS,
  resolveHabitatRoute,
} from "./route-state.mjs";

function optionList(select, values, selected) {
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    return option;
  }));
}

function renderStatus(controller, element, route) {
  const metrics = controller.getMetrics();
  const status = {
    acceptance: "incomplete — native runtime implemented; evidence not captured",
    route,
    backend: metrics.rendererBackend,
    revision: metrics.threeRevision,
    tier: metrics.tier,
    mode: metrics.mode,
    camera: metrics.camera,
    timeSeconds: Number(metrics.timeSeconds.toFixed(3)),
    creatures: `${metrics.visibleCreatures}/${metrics.activeCreatures}`,
    contacts: metrics.contacts,
    immutableSpawnAudit: metrics.immutableSpawnAudit,
    gpuTiming: metrics.gpuTiming,
    performance: metrics.currentAdapterPerformance,
  };
  if (metrics.mode === "owner-graph") status.ownerGraph = controller.describePipeline().owners;
  if (metrics.mode === "shadow-parity") status.shadowParity = metrics.shadowParity;
  element.textContent = JSON.stringify(status, null, 2);
}

async function boot() {
  const route = resolveHabitatRoute(globalThis.location.href);
  const canvas = document.querySelector("[data-habitat-canvas]");
  const status = document.querySelector("[data-habitat-status]");
  const modeSelect = document.querySelector("[data-control=mode]");
  const tierSelect = document.querySelector("[data-control=tier]");
  const cameraSelect = document.querySelector("[data-control=camera]");
  if (!canvas || !status || !modeSelect || !tierSelect || !cameraSelect) {
    throw new Error("Creature Habitat page is missing required controller elements");
  }

  status.textContent = "Initializing native WebGPU…";
  optionList(modeSelect, HABITAT_MODES, route.mode);
  optionList(tierSelect, HABITAT_TIERS, route.tier);
  optionList(cameraSelect, HABITAT_CAMERAS, route.camera);
  tierSelect.disabled = route.tierLocked;
  modeSelect.disabled = route.modeLocked;

  const controller = await createHabitatController({
    canvas,
    initialTier: route.tier,
    initialSeed: route.seed,
    initialMechanism: route.mechanism,
    tierLocked: route.tierLocked,
    modeLocked: route.modeLocked,
    lockedMode: route.mode,
  });
  await controller.setScenario(route.scenario);
  await controller.setMode(route.mode);
  await controller.setCamera(route.camera);
  globalThis.__lab = controller;
  globalThis.labController = controller;
  globalThis.__LAB_CONTROLLER__ = controller;
  globalThis.__CREATURE_HABITAT_ROUTE__ = route;
  renderStatus(controller, status, route);

  const updateControl = (select, setter) => {
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        await setter(select.value);
        renderStatus(controller, status, route);
      } catch (error) {
        status.textContent = `Controller error: ${error.message}`;
        throw error;
      } finally {
        select.disabled = (select === tierSelect && route.tierLocked)
          || (select === modeSelect && route.modeLocked);
      }
    });
  };
  updateControl(modeSelect, (value) => controller.setMode(value));
  updateControl(tierSelect, (value) => controller.setTier(value));
  updateControl(cameraSelect, (value) => controller.setCamera(value));

  document.querySelector("[data-reset-history]")?.addEventListener("click", async () => {
    await controller.resetHistory("manual-ui-reset");
    renderStatus(controller, status, route);
  });

  const resize = async () => {
    const rect = canvas.getBoundingClientRect();
    await controller.resize(
      Math.max(1, Math.round(rect.width)),
      Math.max(1, Math.round(rect.height)),
      globalThis.devicePixelRatio || 1,
    );
  };
  const resizeObserver = new ResizeObserver(() => { void resize(); });
  resizeObserver.observe(canvas);
  await resize();

  let previousTimestamp = performance.now();
  let busy = false;
  let statusFrame = 0;
  if (new URLSearchParams(globalThis.location.search).get("capture") !== "1") {
    controller.renderer.setAnimationLoop((timestamp) => {
      if (busy) return;
      busy = true;
      const deltaSeconds = Math.min(0.05, Math.max(0, (timestamp - previousTimestamp) / 1000));
      previousTimestamp = timestamp;
      Promise.resolve()
        .then(() => controller.step(deltaSeconds))
        .then(() => controller.renderOnce())
        .then(() => {
          statusFrame += 1;
          if (statusFrame % 20 === 0) renderStatus(controller, status, route);
        })
        .catch((error) => {
          controller.renderer.setAnimationLoop(null);
          status.textContent = `Runtime error: ${error.stack || error.message}`;
          globalThis.__labError = error;
          globalThis.__LAB_ERROR__ = error.stack || error.message;
        })
        .finally(() => { busy = false; });
    });
  }

  globalThis.addEventListener("beforeunload", () => {
    resizeObserver.disconnect();
    void controller.dispose();
  }, { once: true });
  return controller;
}

const controllerPromise = boot();
globalThis.__LAB_READY__ = controllerPromise.then(() => true);
globalThis.__LAB_CONTROLLER_PROMISE__ = controllerPromise;
globalThis.labController = controllerPromise;
globalThis.__LAB_CONTROLLER__ = controllerPromise;
controllerPromise.catch((error) => {
  const status = document.querySelector("[data-habitat-status]");
  if (status) status.textContent = `Initialization blocked: ${error.stack || error.message}`;
  globalThis.__labError = error;
  globalThis.__LAB_ERROR__ = error.stack || error.message;
  throw error;
});
