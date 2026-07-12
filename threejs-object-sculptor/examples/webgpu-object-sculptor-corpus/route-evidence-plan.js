// Keep the physical-browser runner independent from the render graph so it can
// load from the immutable static server without resolving Three.js itself. The
// route validator compares these ordered IDs with the runtime-owned constants.
export const CORPUS_ROUTE_SCENARIO_IDS = Object.freeze([
  "articulated-desk-lamp",
  "potted-bonsai",
  "ceramic-teapot",
]);
export const CORPUS_ROUTE_MECHANISM_IDS = Object.freeze([
  "final",
  "blockout",
  "hierarchy",
  "materials",
  "action-ready",
]);
export const CORPUS_ROUTE_TIER_IDS = Object.freeze(["full", "budgeted", "minimum"]);
export const CORPUS_ROUTE_CAMERA_IDS = Object.freeze([
  "design",
  "profile",
  "attachment",
  "close-material",
]);

export const CORPUS_IN_APP_ROUTE_PLAN = Object.freeze([
  Object.freeze({ kind: "scenario", ids: CORPUS_ROUTE_SCENARIO_IDS, selectorId: "subject" }),
  Object.freeze({ kind: "mechanism", ids: CORPUS_ROUTE_MECHANISM_IDS, selectorId: "mode" }),
  Object.freeze({ kind: "tier", ids: CORPUS_ROUTE_TIER_IDS, selectorId: "tier" }),
  Object.freeze({ kind: "camera", ids: CORPUS_ROUTE_CAMERA_IDS, selectorId: "camera" }),
].flatMap(({ kind, ids, selectorId }) => ids.map((id) => Object.freeze({
  routeId: `${kind}:${id}`,
  kind,
  id,
  urlPath: `${kind}/${id}/`,
  selectorId,
}))));

export const CORPUS_ROUTE_EVIDENCE_QUERY = "?capture=1";
export const CORPUS_ROUTE_EVIDENCE_FILENAME = "route-runtime-evidence.json";
export const CORPUS_ROUTE_EVIDENCE_ORIGIN = "http://127.0.0.1:4174";
export const CORPUS_ROUTE_EVIDENCE_BASE_PATH = "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/";
export const CORPUS_ROUTE_EVIDENCE_RUNNER_PATH = `${CORPUS_ROUTE_EVIDENCE_BASE_PATH}in-app-evidence.html`;
export const CORPUS_ROUTE_EVIDENCE_RUNNER_URL = `${CORPUS_ROUTE_EVIDENCE_ORIGIN}${CORPUS_ROUTE_EVIDENCE_RUNNER_PATH}${CORPUS_ROUTE_EVIDENCE_QUERY}`;
export const CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH = "/.well-known/object-sculptor-corpus-immutable.json";
