import { FROST_ROUTE_PROBE_RECIPES } from "./capture-recipes.js";

const PUBLISH_PREFIX = "/demos/webgpu-touch-history-frost/";

function immutableStaticPath(routePath) {
  if (routePath === PUBLISH_PREFIX) return "/index.html";
  if (!routePath.startsWith(PUBLISH_PREFIX) || !routePath.endsWith("/")) {
    throw new RangeError(`Frost route path is outside ${PUBLISH_PREFIX}`);
  }
  return `/${routePath.slice(PUBLISH_PREFIX.length)}index.html`;
}

export const FROST_PHYSICAL_ROUTE_MATRIX = Object.freeze(FROST_ROUTE_PROBE_RECIPES.map((recipe) => Object.freeze({
  recipeId: recipe.id,
  kind: recipe.route.kind,
  publishPath: recipe.route.path,
  staticPath: immutableStaticPath(recipe.route.path),
  locks: recipe.route.locks,
  startup: recipe.route.startup,
})));

function requireErrorLedger(errors, label) {
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) throw new Error(`${label} errors must be an object`);
  for (const field of ["page", "console", "request", "device", "postDisposal"]) {
    if (!Array.isArray(errors[field]) || errors[field].length !== 0) {
      throw new Error(`${label} contains ${field} errors`);
    }
  }
}

export function validateFrostPhysicalRouteObservation(expected, observation) {
  if (!expected || typeof expected !== "object" || !observation || typeof observation !== "object") {
    throw new TypeError("Frost physical route observation requires expected and observed records");
  }
  if (observation.recipeId !== expected.recipeId
    || observation.staticPath !== expected.staticPath
    || observation.controllerReady !== true
    || observation.nativeWebGPU !== true
    || observation.deviceIdentityVerified !== true
    || observation.adapterClass !== "hardware"
    || observation.mechanismControlLocked !== expected.locks.mechanism
    || observation.tierControlLocked !== expected.locks.tier
    || JSON.stringify(observation.observedState) !== JSON.stringify(expected.startup)) {
    throw new Error(`${expected.recipeId} physical route identity, lock, backend, or startup state drifted`);
  }
  const finalUrl = new URL(observation.finalUrl);
  if (finalUrl.protocol !== "http:"
    || !new Set(["127.0.0.1", "localhost"]).has(finalUrl.hostname)
    || !finalUrl.pathname.endsWith(expected.staticPath)
    || finalUrl.searchParams.get("physicalReview") !== "1") {
    throw new Error(`${expected.recipeId} physical route final URL drifted`);
  }
  if (typeof observation.finalPixelHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(observation.finalPixelHash)) {
    throw new Error(`${expected.recipeId} physical route omits its render-target pixel hash`);
  }
  if (observation.disposeEvidence?.status !== "PASS"
    || observation.disposeEvidence?.retainedStorageBytes !== 0
    || observation.disposeEvidence?.retainedTargetBytes !== 0) {
    throw new Error(`${expected.recipeId} physical route did not dispose cleanly`);
  }
  requireErrorLedger(observation.errors, expected.recipeId);
  return true;
}

export function validateFrostPhysicalRouteMatrix(
  observations,
  expectedRoutes = FROST_PHYSICAL_ROUTE_MATRIX,
) {
  if (!Array.isArray(observations) || observations.length !== expectedRoutes.length) {
    throw new Error("Frost physical route matrix must contain all ten immutable routes");
  }
  const finalUrls = new Set();
  for (const [index, expected] of expectedRoutes.entries()) {
    const observation = observations[index];
    validateFrostPhysicalRouteObservation(expected, observation);
    if (finalUrls.has(observation.finalUrl)) throw new Error("Frost physical routes reused a final URL");
    finalUrls.add(observation.finalUrl);
  }
  return Object.freeze({
    verdict: "PASS",
    observations: Object.freeze(observations.map((observation) => Object.freeze(structuredClone(observation)))),
  });
}
