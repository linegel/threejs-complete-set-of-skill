import assert from "node:assert/strict";
import test from "node:test";

import { BoundedContactRegistry, fanoutContactSnapshot } from "../contact-registry.mjs";
import {
  HABITAT_MECHANISM_LOCK,
  HABITAT_MODES,
  HABITAT_TIER_CONFIG,
  HABITAT_TIERS,
  resolveHabitatRoute,
} from "../route-state.mjs";

test("bounded contact registry evicts deterministically and decays without mutating source events", () => {
  const registry = new BoundedContactRegistry({ capacity: 2, lifetimeSeconds: 1 });
  registry.push({ x: 1, z: 2, timeSeconds: 0, sourceInstance: 0 });
  registry.push({ x: 3, z: 4, timeSeconds: 0.25, sourceInstance: 1 });
  registry.push({ x: 5, z: 6, timeSeconds: 0.5, sourceInstance: 2 });
  const snapshot = registry.active(0.75);
  assert.equal(snapshot.length, 2);
  assert.deepEqual(snapshot.map((event) => event.sourceInstance), [1, 2]);
  assert.equal(snapshot[0].weight, 0.5);
  assert(Object.isFrozen(snapshot));
  assert(snapshot.every(Object.isFrozen));
  assert.equal(registry.active(1.6).length, 0);
});

test("water and vegetation receive the exact same frozen contact snapshot identity", () => {
  const registry = new BoundedContactRegistry();
  registry.push({ x: 0, z: 0, timeSeconds: 1, sourceInstance: 0 });
  const snapshot = registry.active(1);
  let vegetationInput;
  let waterInput;
  fanoutContactSnapshot(snapshot, (events) => { vegetationInput = events; }, (events) => { waterInput = events; });
  assert.strictEqual(vegetationInput, snapshot);
  assert.strictEqual(waterInput, snapshot);
  assert.strictEqual(vegetationInput, waterInput);
});

test("route parser locks standalone tiers and rejects unknown selectors", () => {
  const route = resolveHabitatRoute("http://127.0.0.1/demos/creature-habitat/tier/hero/?mode=outline&camera=subject");
  assert.equal(route.tier, "hero");
  assert.equal(route.tierLocked, true);
  assert.equal(route.mode, "outline");
  assert.equal(route.camera, "subject");
  assert.deepEqual(HABITAT_TIERS, ["hero", "balanced", "budgeted"]);
  assert.deepEqual(HABITAT_MODES, [
    "final",
    "no-post",
    "contact-events",
    "water-ripples",
    "vegetation-trampling",
    "culling",
    "outline",
    "shadow-parity",
    "owner-graph",
  ]);
  assert.throws(
    () => resolveHabitatRoute("http://127.0.0.1/demos/creature-habitat/tier/hero/?tier=budgeted"),
    /locked tier route/,
  );
  assert.throws(
    () => resolveHabitatRoute("http://127.0.0.1/demos/creature-habitat/?mode=made-up"),
    /unknown creature-habitat mode/,
  );
});

test("every generated mechanism path locks its canonical mode and tier", () => {
  for (const [mechanism, lock] of Object.entries(HABITAT_MECHANISM_LOCK)) {
    const route = resolveHabitatRoute(
      `http://127.0.0.1/demos/creature-habitat/mechanism/${mechanism}/`,
    );
    assert.equal(route.mechanism, mechanism);
    assert.equal(route.mode, lock.mode);
    assert.equal(route.tier, lock.tier);
    assert.equal(route.modeLocked, true);
    assert.equal(route.tierLocked, true);
    assert.throws(
      () => resolveHabitatRoute(
        `http://127.0.0.1/demos/creature-habitat/mechanism/${mechanism}/?mode=${lock.mode === "final" ? "outline" : "final"}`,
      ),
      /locked mechanism route.*rejects mode/,
    );
    assert.throws(
      () => resolveHabitatRoute(
        `http://127.0.0.1/demos/creature-habitat/mechanism/${mechanism}/?tier=${lock.tier === "hero" ? "budgeted" : "hero"}`,
      ),
      /locked mechanism route.*rejects tier/,
    );
  }
});

test("conflicting mechanism path/query and actual resolution policies are exact", () => {
  assert.throws(
    () => resolveHabitatRoute(
      "http://127.0.0.1/demos/creature-habitat/mechanism/owner-graph/?mechanism=shared-world-wind",
    ),
    /rejects query mechanism/,
  );
  assert.deepEqual(
    HABITAT_TIERS.map((tier) => [tier, HABITAT_TIER_CONFIG[tier].sceneScale, HABITAT_TIER_CONFIG[tier].waterScale]),
    [
      ["hero", 1, 1],
      ["balanced", 1, 0.75],
      ["budgeted", 0.85, 0.5],
    ],
  );
});
