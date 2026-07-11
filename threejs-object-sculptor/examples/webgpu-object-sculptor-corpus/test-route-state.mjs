import assert from "node:assert/strict";

import { SCULPT_MODES, SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import {
  CORPUS_CAMERAS,
  corpusRouteFromLocation,
  corpusStateChanged,
  resolveCorpusInitialState,
} from "./route-state.js";

assert.deepEqual(CORPUS_CAMERAS, ["design", "profile", "attachment", "close-material"]);
assert.equal(Object.isFrozen(CORPUS_CAMERAS), true);

const generalRoute = corpusRouteFromLocation({
  pathname: "/demos/webgpu-object-sculptor-corpus/",
  search: "",
});
assert.deepEqual(generalRoute, { scenario: null, mechanism: null, tier: null, camera: null });
assert.equal(Object.isFrozen(generalRoute), true);

const expectedDefaults = {
  scenario: "potted-bonsai",
  mechanism: "action-ready",
  tier: "budgeted",
  camera: "design",
};
assert.deepEqual(resolveCorpusInitialState(generalRoute), expectedDefaults);
assert.deepEqual(resolveCorpusInitialState(generalRoute), expectedDefaults, "route defaults must be deterministic");
assert.deepEqual(resolveCorpusInitialState(), expectedDefaults);

assert.deepEqual(
  corpusRouteFromLocation({
    pathname: "/scenario/ceramic-teapot/mechanism/materials/tier/minimum/camera/close-material/",
    search: "",
  }),
  { scenario: "ceramic-teapot", mechanism: "materials", tier: "minimum", camera: "close-material" },
);

assert.deepEqual(
  corpusRouteFromLocation({
    pathname: "/demos/webgpu-object-sculptor-corpus/",
    search: "?scenario=articulated-desk-lamp&mechanism=action-ready&tier=full&camera=attachment",
  }),
  { scenario: "articulated-desk-lamp", mechanism: "action-ready", tier: "full", camera: "attachment" },
);

assert.deepEqual(
  corpusRouteFromLocation({
    pathname: "/scenario/potted-bonsai/mechanism/action-ready/tier/budgeted/",
    search: "?scenario=potted-bonsai&mechanism=action-ready&tier=budgeted",
  }),
  { scenario: "potted-bonsai", mechanism: "action-ready", tier: "budgeted", camera: null },
  "matching physical and query locks must reconcile without conflict",
);

for (const [kind, pathValue, queryValue] of [
  ["scenario", "potted-bonsai", "ceramic-teapot"],
  ["mechanism", "final", "materials"],
  ["tier", "full", "minimum"],
  ["camera", "design", "profile"],
]) {
  assert.throws(
    () => corpusRouteFromLocation({ pathname: `/${kind}/${pathValue}/`, search: `?${kind}=${queryValue}` }),
    new RegExp(`Conflicting ${kind}`),
  );
}

for (const [kind, label] of [
  ["scenario", "sculpt target"],
  ["mechanism", "sculpt mechanism"],
  ["tier", "sculpt tier"],
  ["camera", "corpus camera"],
]) {
  assert.throws(
    () => corpusRouteFromLocation({ pathname: `/${kind}/unknown/`, search: "" }),
    new RegExp(`Unknown ${label}`),
  );
  assert.throws(
    () => corpusRouteFromLocation({ pathname: "/", search: `?${kind}=unknown` }),
    new RegExp(`Unknown ${label}`),
  );
}

assert.throws(
  () => corpusRouteFromLocation({ pathname: "/", search: "?scenario=potted-bonsai&scenario=ceramic-teapot" }),
  /Conflicting scenario values in query/,
);
assert.throws(
  () => corpusRouteFromLocation({ pathname: "/tier/full/tier/minimum/", search: "" }),
  /Conflicting tier values in pathname/,
);
assert.throws(
  () => corpusRouteFromLocation({ pathname: "/scenario/", search: "" }),
  /Missing scenario route value/,
);
assert.throws(() => resolveCorpusInitialState(null), /route must be an object/);
assert.throws(() => resolveCorpusInitialState({ scenario: "unknown" }), /Unknown sculpt target/);

assert.equal(corpusStateChanged("potted-bonsai", "potted-bonsai", SCULPT_TARGET_IDS, "scenario"), false);
assert.equal(corpusStateChanged("potted-bonsai", "ceramic-teapot", SCULPT_TARGET_IDS, "scenario"), true);
assert.equal(corpusStateChanged("final", "materials", SCULPT_MODES, "mechanism"), true);
assert.equal(corpusStateChanged("budgeted", "budgeted", new Set(SCULPT_TIERS), "tier"), false);
assert.throws(() => corpusStateChanged("potted-bonsai", "unknown", SCULPT_TARGET_IDS, "scenario"), /Unknown scenario/);
assert.throws(() => corpusStateChanged("potted-bonsai", "ceramic-teapot", [], "scenario"), /allowed values/);

console.log(JSON.stringify({
  ok: true,
  defaults: expectedDefaults,
  cameras: CORPUS_CAMERAS,
}, null, 2));
