import { createProceduralDistrictLab } from "./main.js";
import {
  DISTRICT_CAMERAS,
  DISTRICT_MODES,
  DISTRICT_SEEDS,
  DISTRICT_TIERS,
} from "./district-contract.js";
import { resolveDistrictRoute } from "./routes.js";

const canvas = document.querySelector("#district-canvas");
const status = document.querySelector("#status");
const metrics = document.querySelector("#metrics");
const controls = document.querySelector("#controls");
const locked = {
  scenario: document.querySelector('meta[name="locked-scenario"]')?.content || undefined,
  mechanism: document.querySelector('meta[name="locked-mechanism"]')?.content || undefined,
  tier: document.querySelector('meta[name="locked-tier"]')?.content || undefined,
  mode: document.querySelector('meta[name="locked-mode"]')?.content || undefined,
};
const route = resolveDistrictRoute(location.pathname, location.search, locked);
const routeLocks = route.routeLocks;
const captureMode = new URLSearchParams(location.search).get("capture") === "1";

window.__LAB_READY__ = (async () => {
  try {
    status.textContent = "Initializing native WebGPU…";
    const controller = await createProceduralDistrictLab({
      canvas,
      width: canvas.clientWidth || 1200,
      height: canvas.clientHeight || 800,
      dpr: Math.min(devicePixelRatio || 1, 2),
      ...route,
    });
    window.__LAB_CONTROLLER__ = controller;
    window.labController = controller;
    await controller.ready();

    function optionList(values, selected) {
      return values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
    }

    controls.innerHTML = `
      <label>Mode<select data-control="mode" ${routeLocks.mode ? "disabled" : ""}>${optionList(DISTRICT_MODES, route.mode)}</select></label>
      <label>Tier<select data-control="tier" ${routeLocks.tier ? "disabled" : ""}>${optionList(Object.keys(DISTRICT_TIERS), route.tier)}</select></label>
      <label>Camera<select data-control="camera">${optionList(DISTRICT_CAMERAS, route.camera)}</select></label>
      <label>Seed<select data-control="seed">${optionList(DISTRICT_SEEDS.map(String), String(route.seed))}</select></label>
      <button type="button" data-control="pause">Pause</button>
    `;

    controls.querySelector('[data-control="mode"]').addEventListener("change", async (event) => {
      await controller.setMode(event.target.value);
      await controller.renderOnce();
      updateMetrics();
    });
    controls.querySelector('[data-control="tier"]').addEventListener("change", async (event) => {
      await controller.setTier(event.target.value);
      await controller.renderOnce();
      updateMetrics();
    });
    controls.querySelector('[data-control="camera"]').addEventListener("change", async (event) => {
      await controller.setCamera(event.target.value);
      await controller.renderOnce();
      updateMetrics();
    });
    controls.querySelector('[data-control="seed"]').addEventListener("change", async (event) => {
      await controller.setSeed(Number(event.target.value));
      await controller.renderOnce();
      updateMetrics();
    });

    let paused = captureMode;
    const pauseButton = controls.querySelector('[data-control="pause"]');
    pauseButton.textContent = paused ? "Resume" : "Pause";
    pauseButton.addEventListener("click", () => {
      paused = !paused;
      pauseButton.textContent = paused ? "Resume" : "Pause";
    });

    function updateMetrics() {
      const value = controller.getMetrics();
      status.textContent = `${value.backend.toUpperCase()} · ${value.tier} · ${value.mechanism ?? value.mode} · evidence incomplete`;
      metrics.textContent = JSON.stringify({
        fieldDispatches: value.fieldDispatchCount,
        buildings: value.buildingCount,
        facadeOwners: value.facadeOwnershipCount,
        geometryBuilds: value.geometryBuildCount,
        sceneSubmissions: value.sceneSubmissionCount,
        shadowViews: value.shadowViewCount,
        wetness: Number(value.weatherState.wetness.toFixed(3)),
        logicalBytes: controller.describeResources().logicalResidentBytes.value,
        timing: "INSUFFICIENT_EVIDENCE",
      }, null, 2);
    }

    const resize = async () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      await controller.resize(width, height, Math.min(devicePixelRatio || 1, 2));
      await controller.renderOnce();
      updateMetrics();
    };
    window.addEventListener("resize", resize);

    let previous = performance.now();
    let framePending = false;
    async function frame(now) {
      requestAnimationFrame(frame);
      if (paused || framePending) return;
      framePending = true;
      try {
        const delta = Math.min(Math.max((now - previous) / 1000, 0), 1 / 15);
        previous = now;
        await controller.step(delta);
        await controller.renderOnce();
        updateMetrics();
      } catch (error) {
        window.__LAB_ERROR__ = String(error.stack ?? error.message ?? error);
        status.textContent = window.__LAB_ERROR__;
        paused = true;
      } finally {
        framePending = false;
      }
    }

    await controller.renderOnce();
    updateMetrics();
    if (!captureMode) requestAnimationFrame(frame);
    return controller;
  } catch (error) {
    window.__LAB_ERROR__ = String(error.stack ?? error.message ?? error);
    status.textContent = window.__LAB_ERROR__;
    throw error;
  }
})();
