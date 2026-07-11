import { SCULPT_TARGETS } from "./object-catalog.js";
import {
  CORPUS_RUNTIME_PROFILES,
  SCULPT_MODES,
  SCULPT_TIERS,
  createObjectSculptorCorpusController,
  createObjectSculptorCorpusFrameDriver,
  objectSculptorCorpusFrameOwner,
} from "./lab-controller.js";
import {
  CORPUS_CAMERAS,
  corpusRouteFromLocation,
  resolveCorpusInitialState,
} from "./route-state.js";
import { settleCorpusControlAction } from "./frame-driver.js";

const MODE_COPY = Object.freeze({
  final: ["Final reconstruction", "Complete procedural form, authored material zones, and neutral presentation lighting."],
  blockout: ["Blockout", "Identity-critical masses only, before smaller features and surface treatment."],
  hierarchy: ["Semantic hierarchy", "Diagnostic colors separate stable components, pivots, repeated systems, and detachable groups."],
  materials: ["Material study", "Motion is frozen so albedo, roughness, metalness, and silhouette edges can be inspected."],
  "action-ready": ["Action-ready motion", "Named pivots move continuously while sockets and collider construction inputs remain inspectable."],
});

const SUBJECT_FALLBACK_COPY = Object.freeze({
  "articulated-desk-lamp": {
    title: "Articulated Desk Lamp",
    description: "A mechanical product study with serial hinge pivots, swept supports, a shade, cable routing, and constrained motion.",
  },
  "potted-bonsai": {
    title: "Potted Bonsai",
    description: "A rooted botanical sculpture with closed branch rings, tiered opaque foliage, authored sway pivots, and a ceramic vessel.",
  },
  "ceramic-teapot": {
    title: "Ceramic Teapot",
    description: "A rotational ceramic study with a lathed body, swept handle and spout, smooth normals, and a detachable lid.",
  },
});

const CAMERA_LABELS = Object.freeze({
  design: "design",
  profile: "profile",
  attachment: "attachment",
  "close-material": "close material",
});

function requireElement(selector) {
  const value = document.querySelector(selector);
  if (!value) throw new Error(`Missing required corpus UI element "${selector}"`);
  return value;
}

const canvas = requireElement("#scene");
const subjectSelect = requireElement("#subject");
const modeSelect = requireElement("#mode");
const tierSelect = requireElement("#tier");
const cameraSelect = requireElement("#camera");
const status = requireElement("#status");
const subjectTitle = requireElement("#subject-title");
const subjectDescription = requireElement("#subject-description");
const corpusIndex = requireElement(".corpus-index");
const modeTitle = requireElement("#mode-title");
const modeDescription = requireElement("#mode-description");
const metricNodes = requireElement("#metric-nodes");
const metricTriangles = requireElement("#metric-triangles");
const metricDraws = requireElement("#metric-draws");
const metricSubmissions = requireElement("#metric-submissions");
const metricHandoffs = requireElement("#metric-handoffs");
const metricPhysicsStatus = requireElement("#metric-physics-status");
const metricMotion = requireElement("#metric-motion");
const metricDpr = requireElement("#metric-dpr");

window.__LAB_ERROR__ = null;

function addOptions(select, entries) {
  for (const [value, label] of entries) select.add(new Option(label, value));
}

function finiteOrNull(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function integerText(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
}

function uniqueQueryValue(params, key) {
  const values = [...new Set(params.getAll(key))];
  if (values.length > 1) throw new RangeError(`Conflicting ${key} query values: ${values.join(", ")}`);
  return values[0] ?? null;
}

function runtimeOptionsFromLocation({ search = "" } = {}) {
  const params = new URLSearchParams(search);
  const profile = uniqueQueryValue(params, "profile") ?? "correctness";
  if (!CORPUS_RUNTIME_PROFILES.includes(profile)) {
    throw new RangeError(`Unknown corpus runtime profile "${profile}"`);
  }
  const timestampValue = uniqueQueryValue(params, "timestampQueriesRequired");
  const normalizedTimestamp = timestampValue?.toLowerCase() ?? null;
  if (normalizedTimestamp !== null && !["1", "0", "true", "false"].includes(normalizedTimestamp)) {
    throw new RangeError("timestampQueriesRequired must be true, false, 1, or 0");
  }
  const timestampQueriesRequired = normalizedTimestamp === "1" || normalizedTimestamp === "true";
  if (timestampQueriesRequired && profile !== "performance") {
    throw new Error("timestampQueriesRequired is only valid with profile=performance");
  }
  return Object.freeze({ profile, timestampQueriesRequired });
}

function targetCopy(id) {
  const definition = SCULPT_TARGETS.find((entry) => entry.id === id);
  return {
    title: definition?.title ?? SUBJECT_FALLBACK_COPY[id]?.title ?? id,
    description: definition?.description ?? SUBJECT_FALLBACK_COPY[id]?.description ?? "Generated procedural asset.",
  };
}

function updateSubjectCopy(id) {
  const copy = targetCopy(id);
  const index = Math.max(SCULPT_TARGETS.findIndex((entry) => entry.id === id), 0);
  document.documentElement.dataset.subject = id;
  subjectTitle.textContent = copy.title;
  subjectDescription.textContent = copy.description;
  corpusIndex.textContent = `${String(index + 1).padStart(2, "0")} / ${String(SCULPT_TARGETS.length).padStart(2, "0")} · generated procedural asset`;
  document.title = `${copy.title} · Object Sculptor Corpus`;
}

function updateModeCopy(id) {
  const [title, description] = MODE_COPY[id] ?? [id, "Procedural inspection mode."];
  modeTitle.textContent = title;
  modeDescription.textContent = description;
}

function physicsStatus(metrics, handoffCount) {
  const statusValue = metrics.physicsHandoffStatus
    ?? metrics.canonicalPhysicsProxyStatus
    ?? metrics.physicsStatus;
  if (typeof statusValue === "string" && statusValue.length > 0) return statusValue;
  return handoffCount > 0 ? "adapter blocked" : "none";
}

function motionWitnessLabel(witness) {
  if (!witness || typeof witness !== "object") {
    return { text: "unmeasured", title: "No controller motion witness was published." };
  }
  const statusLabels = {
    "measured-live-pose-delta": "measured",
    "awaiting-pose-delta": "awaiting",
    "frozen-authored-pose": "frozen",
    "blocked-no-pose-delta": "blocked",
  };
  const statusLabel = statusLabels[witness.status] ?? witness.status ?? "unknown";
  const channels = Number.isFinite(witness.activeChannelCount) ? witness.activeChannelCount : 0;
  let delta = "Δ0";
  if (witness.maxRotationDeltaRadians > 0) delta = `Δr${witness.maxRotationDeltaRadians.toFixed(3)}`;
  else if (witness.maxTranslationDeltaMeters > 0) delta = `Δx${witness.maxTranslationDeltaMeters.toFixed(3)}m`;
  else if (witness.maxScaleDelta > 0) delta = `Δs${witness.maxScaleDelta.toFixed(3)}`;
  const activeChannelValues = Array.isArray(witness.activeChannels) ? witness.activeChannels : [];
  const activeChannels = activeChannelValues.length > 0
    ? `${activeChannelValues.slice(0, 8).join(", ")}${activeChannelValues.length > 8 ? `, +${activeChannelValues.length - 8} more` : ""}`
    : "none";
  return {
    text: `${statusLabel} · ${channels}ch · ${delta}`,
    title: `${witness.status}; ${channels} active channels; translation Δ ${witness.maxTranslationDeltaMeters ?? 0} m; rotation Δ ${witness.maxRotationDeltaRadians ?? 0} rad; scale Δ ${witness.maxScaleDelta ?? 0}; channels: ${activeChannels}`,
  };
}

function updateHud(metrics) {
  const ready = metrics.firstFrameCompleted === true && metrics.nativeWebGPU === true;
  const runtimeProfile = metrics.runtimeProfile ?? "unknown-profile";
  status.dataset.state = ready ? "ready" : "starting";
  status.textContent = ready
    ? `Ready · ${metrics.subjectId} · ${runtimeProfile} WebGPU`
    : `Starting · ${metrics.subjectId ?? subjectSelect.value} · ${runtimeProfile} WebGPU`;

  if (metrics.subjectId && subjectSelect.value !== metrics.subjectId) subjectSelect.value = metrics.subjectId;
  if (metrics.mode && modeSelect.value !== metrics.mode) modeSelect.value = metrics.mode;
  if (metrics.tier && tierSelect.value !== metrics.tier) tierSelect.value = metrics.tier;
  if (metrics.camera && cameraSelect.value !== metrics.camera) cameraSelect.value = metrics.camera;
  updateSubjectCopy(metrics.subjectId ?? subjectSelect.value);
  updateModeCopy(metrics.mode ?? modeSelect.value);

  const draws = finiteOrNull(metrics.drawCalls, metrics.rendererInfo?.render?.calls);
  const submissions = finiteOrNull(metrics.renderSubmissions);
  const handoffCount = finiteOrNull(metrics.physicsHandoffCount, metrics.colliderConstructionInputs, metrics.colliders);
  const dpr = finiteOrNull(metrics.dpr);
  const motion = motionWitnessLabel(metrics.motionWitness);
  const shadowPolicy = metrics.lightShadowPolicy;

  metricNodes.textContent = integerText(metrics.nodes);
  metricTriangles.textContent = integerText(metrics.triangles);
  metricDraws.textContent = integerText(draws);
  metricSubmissions.textContent = integerText(submissions);
  metricHandoffs.textContent = handoffCount === null ? "—" : `${Math.round(handoffCount)} inputs`;
  metricPhysicsStatus.textContent = physicsStatus(metrics, handoffCount ?? 0);
  metricMotion.textContent = motion.text;
  metricMotion.title = motion.title;
  metricDpr.textContent = dpr === null ? runtimeProfile : `${dpr.toFixed(2)}× · ${runtimeProfile}`;
  metricDpr.title = `${runtimeProfile} profile; ${metrics.timingMethod ?? "timing method unavailable"}; shadow map ${shadowPolicy?.mapSize ?? "—"} px; ${shadowPolicy?.enabledCasterCount ?? "—"}/${shadowPolicy?.authoredCasterCount ?? "—"} authored casters enabled; antialias policy match ${shadowPolicy?.antialiasMatchesCurrentTier ?? "—"}`;
}

function reportRuntimeError(value) {
  const error = value instanceof Error ? value : new Error(String(value));
  window.__LAB_ERROR__ = Object.freeze({ name: error.name, message: error.message });
  document.body.dataset.runtime = "error";
  status.dataset.state = "error";
  status.textContent = `Error · ${error.message}`;
  console.error(error);
}

async function boot() {
  const targetIds = SCULPT_TARGETS.map((entry) => entry.id);
  if (targetIds.length < 3) throw new Error("The Object Sculptor corpus requires three distinct procedural subjects");

  addOptions(subjectSelect, SCULPT_TARGETS.map((entry) => [entry.id, entry.title]));
  addOptions(modeSelect, SCULPT_MODES.map((id) => [id, id.replaceAll("-", " ")]));
  addOptions(tierSelect, SCULPT_TIERS.map((id) => [id, id]));
  addOptions(cameraSelect, CORPUS_CAMERAS.map((id) => [id, CAMERA_LABELS[id] ?? id.replaceAll("-", " ")]));

  const route = corpusRouteFromLocation(window.location);
  const routeState = resolveCorpusInitialState(route);
  const runtimeOptions = runtimeOptionsFromLocation(window.location);
  const frameOwner = objectSculptorCorpusFrameOwner(window.location.search);
  const initial = {
    subjectId: routeState.scenario,
    mode: routeState.mechanism,
    tier: routeState.tier,
    camera: routeState.camera,
  };

  subjectSelect.value = initial.subjectId;
  modeSelect.value = initial.mode;
  tierSelect.value = initial.tier;
  cameraSelect.value = initial.camera;
  subjectSelect.disabled = route.scenario !== null;
  modeSelect.disabled = route.mechanism !== null;
  tierSelect.disabled = route.tier !== null;
  cameraSelect.disabled = route.camera !== null;
  updateSubjectCopy(initial.subjectId);
  updateModeCopy(initial.mode);
  document.documentElement.dataset.profile = runtimeOptions.profile;

  const controller = await createObjectSculptorCorpusController({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: Math.min(window.devicePixelRatio, 1.5),
    subjectId: initial.subjectId,
    mode: initial.mode,
    tier: initial.tier,
    camera: initial.camera,
    profile: runtimeOptions.profile,
    timestampQueriesRequired: runtimeOptions.timestampQueriesRequired,
  });
  let frameDriver;
  try {
    frameDriver = createObjectSculptorCorpusFrameDriver({
      controller,
      onMetrics: updateHud,
      onError: reportRuntimeError,
      routeLocks: route,
    });
  } catch (error) {
    try {
      await controller.dispose();
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], "Failed to create the frame owner and dispose its controller");
    }
    throw error;
  }
  const labController = frameDriver.publicController;
  window.labController = labController;

  function restoreControlsFromMetrics() {
    const metrics = labController.getMetrics();
    subjectSelect.value = metrics.subjectId;
    modeSelect.value = metrics.mode;
    tierSelect.value = metrics.tier;
    cameraSelect.value = metrics.camera;
    updateSubjectCopy(metrics.subjectId);
    updateModeCopy(metrics.mode);
  }

  function observeAction(promise, onSuccess) {
    void settleCorpusControlAction(promise, {
      onApplied: onSuccess,
      onRestore: restoreControlsFromMetrics,
    }).catch(() => {
      // The frame driver already publishes the exact failure through reportRuntimeError().
    });
  }

  function onSubjectChange() {
    observeAction(labController.setSubject(subjectSelect.value), () => updateSubjectCopy(subjectSelect.value));
  }

  function onModeChange() {
    observeAction(labController.setMode(modeSelect.value), () => updateModeCopy(modeSelect.value));
  }

  function onTierChange() {
    observeAction(labController.setTier(tierSelect.value));
  }

  function onCameraChange() {
    observeAction(labController.setCamera(cameraSelect.value));
  }

  function onResize() {
    observeAction(labController.resize(
      window.innerWidth,
      window.innerHeight,
      Math.min(window.devicePixelRatio, 1.5),
    ));
  }

  let listenersAttached = true;
  function detachListeners() {
    if (!listenersAttached) return false;
    listenersAttached = false;
    subjectSelect.removeEventListener("change", onSubjectChange);
    modeSelect.removeEventListener("change", onModeChange);
    tierSelect.removeEventListener("change", onTierChange);
    cameraSelect.removeEventListener("change", onCameraChange);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    return true;
  }

  function onPageHide(event) {
    if (event.persisted) {
      frameDriver.suspend();
      return;
    }
    detachListeners();
    // pagehide itself cannot await promises. Acceptance harnesses must explicitly
    // await window.labController.dispose(); this path only preserves safe ordering.
    void frameDriver.close().catch(() => {
      // Disposal errors are already published by the frame driver.
    });
  }

  function onPageShow(event) {
    if (event.persisted && frameOwner === "live-page") frameDriver.resume();
  }

  subjectSelect.addEventListener("change", onSubjectChange);
  modeSelect.addEventListener("change", onModeChange);
  tierSelect.addEventListener("change", onTierChange);
  cameraSelect.addEventListener("change", onCameraChange);
  window.addEventListener("resize", onResize);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  if (frameOwner === "live-page") frameDriver.start();
  else updateHud(labController.getMetrics());
}

boot().catch(reportRuntimeError);
