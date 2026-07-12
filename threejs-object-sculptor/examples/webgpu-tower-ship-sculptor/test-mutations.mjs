import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  analyzeIndexedSurfaceTopology,
  buildHullGeometry,
  createTowerShip,
  summarizeTowerShip,
} from "./tower-ship-factory.js";
import { validateTowerShipActionReady } from "./validate-action-ready.mjs";

const sculptSpec = JSON.parse(readFileSync(new URL("./object-sculpt-spec.json", import.meta.url), "utf8"));

const puncturedHull = buildHullGeometry(17, 12);
const puncturedIndices = Array.from(puncturedHull.getIndex().array);
puncturedHull.setIndex(puncturedIndices.slice(0, -3));
const puncturedTopology = analyzeIndexedSurfaceTopology(puncturedHull);
assert.equal(puncturedTopology.closedTwoManifold, false, "the production topology check must reject a missing cap triangle");
assert(puncturedTopology.boundaryEdges > 0, "a removed cap triangle must expose boundary edges");
assert.equal(puncturedTopology.boundaryLoops, 1, "a removed cap triangle must expose exactly one undeclared boundary loop");
assert.equal(puncturedTopology.undeclaredOpenBoundaryLoops, 1, "Tower Ship declares no permitted hull openings");
puncturedHull.dispose();

const reversedFaceHull = buildHullGeometry(17, 12);
const reversedIndices = Array.from(reversedFaceHull.getIndex().array);
[reversedIndices[1], reversedIndices[2]] = [reversedIndices[2], reversedIndices[1]];
reversedFaceHull.setIndex(reversedIndices);
const reversedFaceTopology = analyzeIndexedSurfaceTopology(reversedFaceHull);
assert.equal(reversedFaceTopology.boundaryEdges, 0, "a reversed face can preserve edge incidence while still being invalid");
assert(reversedFaceTopology.inconsistentWindingEdges > 0, "directed-edge proof must expose reversed winding");
assert.equal(reversedFaceTopology.closedTwoManifold, false, "winding inconsistency must fail the closed outward hull contract");
reversedFaceHull.dispose();

const ship = createTowerShip({ tier: "full", seed: 1 });
const baseline = summarizeTowerShip(ship.root);
assert.equal(baseline.oars, 24);
validateTowerShipActionReady(sculptSpec, ship.root);

const removed = ship.runtime.oars.pop();
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /oar runtime count is 23/, "the production validator must reject an incomplete oar bank");
ship.runtime.oars.push(removed);
validateTowerShipActionReady(sculptSpec, ship.root);

const first = ship.runtime.oars[0];
const socket = ship.runtime.sockets.get(`${first.name}-socket`);
first.remove(socket);
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /is not parent-local/, "the production validator must reject a detached oar socket");
first.add(socket);
validateTowerShipActionReady(sculptSpec, ship.root);

const mastStep = ship.runtime.sockets.get("mast-step");
ship.runtime.sockets.delete("mast-step");
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /attachment socket mast-step/, "the production validator must reject a missing declared attachment socket");
ship.runtime.sockets.set("mast-step", mastStep);
validateTowerShipActionReady(sculptSpec, ship.root);

const hullProxy = ship.runtime.colliders.get("hull-compound");
ship.runtime.colliders.set("hull-compound", {
  ...hullProxy,
  colliderId: { ...hullProxy.colliderId, generation: 0 },
});
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /generation must be a positive integer/, "the production validator must reject a stale collider generation");
ship.runtime.colliders.set("hull-compound", hullProxy);

const towerProxy = ship.runtime.colliders.get("tower-box");
ship.runtime.colliders.set("tower-box", {
  ...towerProxy,
  shape: { ...towerProxy.shape, sizeWorldUnits: [6.6, Number.NaN, 4.2] },
});
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /sizeWorldUnits must contain 3 finite values/, "the production validator must reject nonfinite authoring dimensions");
ship.runtime.colliders.set("tower-box", towerProxy);

const lowerRoof = ship.runtime.destructionGroups.get("lower-roof");
ship.runtime.destructionGroups.delete("lower-roof");
assert.throws(() => validateTowerShipActionReady(sculptSpec, ship.root), /destruction group lower-roof/, "the production validator must reject a missing destruction group");
ship.runtime.destructionGroups.set("lower-roof", lowerRoof);
validateTowerShipActionReady(sculptSpec, ship.root);

ship.dispose();
console.log(JSON.stringify({ ok: true, negativeControls: ["punctured-hull", "reversed-hull-face", "oar-count", "socket-parent", "missing-attachment-socket", "collider-generation", "collider-authoring-dimensions", "destruction-group"] }, null, 2));
