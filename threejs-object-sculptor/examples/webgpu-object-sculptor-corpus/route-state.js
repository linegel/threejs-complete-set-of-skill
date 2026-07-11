import { SCULPT_MODES, SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";

export const CORPUS_CAMERAS = Object.freeze([
  "design",
  "profile",
  "attachment",
  "close-material",
]);

const DEFAULT_CORPUS_STATE = Object.freeze({
  scenario: "potted-bonsai",
  mechanism: "action-ready",
  tier: "budgeted",
  camera: "design",
});

function pathValues(pathname, kind) {
  const segments = String(pathname).split("/").filter(Boolean);
  const values = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== kind) continue;
    if (index + 1 >= segments.length) throw new RangeError(`Missing ${kind} route value`);
    values.push(decodeURIComponent(segments[index + 1]));
  }
  return values;
}

function queryValues(params, kind) {
  return params.getAll(kind);
}

function oneValue(values, kind, source) {
  if (values.length === 0) return null;
  const unique = [...new Set(values)];
  if (unique.length !== 1) {
    throw new RangeError(`Conflicting ${kind} values in ${source}: ${unique.join(", ")}`);
  }
  return unique[0];
}

function reconcileRoute(kind, queryValue, pathnameValue) {
  if (queryValue !== null && pathnameValue !== null && queryValue !== pathnameValue) {
    throw new RangeError(`Conflicting ${kind} route "${pathnameValue}" and query "${queryValue}"`);
  }
  return queryValue ?? pathnameValue;
}

function validateAllowed(value, allowed, label, { nullable = true } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.length === 0 || !allowed.includes(value)) {
    throw new RangeError(`Unknown ${label} "${value}"`);
  }
  return value;
}

export function corpusRouteFromLocation({ pathname = "", search = "" } = {}) {
  const params = new URLSearchParams(search);
  const read = (kind, allowed, label = kind) => validateAllowed(
    reconcileRoute(
      kind,
      oneValue(queryValues(params, kind), kind, "query"),
      oneValue(pathValues(pathname, kind), kind, "pathname"),
    ),
    allowed,
    label,
  );

  return Object.freeze({
    scenario: read("scenario", SCULPT_TARGET_IDS, "sculpt target"),
    mechanism: read("mechanism", SCULPT_MODES, "sculpt mechanism"),
    tier: read("tier", SCULPT_TIERS, "sculpt tier"),
    camera: read("camera", CORPUS_CAMERAS, "corpus camera"),
  });
}

export function resolveCorpusInitialState(route = {}) {
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    throw new TypeError("corpus route must be an object");
  }
  return Object.freeze({
    scenario: validateAllowed(route.scenario ?? DEFAULT_CORPUS_STATE.scenario, SCULPT_TARGET_IDS, "sculpt target", { nullable: false }),
    mechanism: validateAllowed(route.mechanism ?? DEFAULT_CORPUS_STATE.mechanism, SCULPT_MODES, "sculpt mechanism", { nullable: false }),
    tier: validateAllowed(route.tier ?? DEFAULT_CORPUS_STATE.tier, SCULPT_TIERS, "sculpt tier", { nullable: false }),
    camera: validateAllowed(route.camera ?? DEFAULT_CORPUS_STATE.camera, CORPUS_CAMERAS, "corpus camera", { nullable: false }),
  });
}

export function corpusStateChanged(current, next, allowed, label = "corpus state") {
  const values = Array.isArray(allowed) ? allowed : allowed instanceof Set ? [...allowed] : null;
  if (!values || values.length === 0) throw new TypeError(`${label} allowed values must be a nonempty array or Set`);
  validateAllowed(next, values, label, { nullable: false });
  if (current !== null && current !== undefined) validateAllowed(current, values, label, { nullable: false });
  return current !== next;
}
