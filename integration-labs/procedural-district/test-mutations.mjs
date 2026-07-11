import assert from "node:assert/strict";

import {
  DISTRICT_VALIDATION_CODES,
  assertDistrictRouteLock,
  createDistrictValidationSnapshot,
  normalizeDistrictRouteLocks,
  validateDistrictSnapshot,
} from "./district-contract.js";

function expectCode(mutator, code) {
  const snapshot = createDistrictValidationSnapshot({
    facadeOwnershipKeys: ["building-a|front|0:1"],
    fieldIdentity: "district-shared-cause-field-v2",
    geometryBuildCount: 3,
    geometryDigest: "fnv32:deadcafe",
  });
  mutator(snapshot);
  const result = validateDistrictSnapshot(snapshot);
  assert.equal(result.ok, false, `mutation ${code} must fail`);
  assert.ok(result.errors.some((entry) => entry.code === code), `mutation must emit ${code}`);
}

expectCode(
  (snapshot) => snapshot.facadeOwnershipKeys.push(snapshot.facadeOwnershipKeys[0]),
  DISTRICT_VALIDATION_CODES.DUPLICATE_FACADE,
);
expectCode(
  (snapshot) => snapshot.passes.push({ id: "private-third-beauty", kind: "lit-scene", reachable: true }),
  DISTRICT_VALIDATION_CODES.DUPLICATE_PASS,
);
expectCode(
  (snapshot) => snapshot.ownerClaims.push({ semantic: "output-transform", owner: "private-output-owner" }),
  DISTRICT_VALIDATION_CODES.DUPLICATE_OWNER,
);
expectCode(
  (snapshot) => snapshot.signalClaims.push({ id: "district.cause-field", producer: "private-field-producer" }),
  DISTRICT_VALIDATION_CODES.DUPLICATE_SIGNAL,
);
expectCode(
  (snapshot) => snapshot.causeFieldIdentities.push("private-material-cause-field"),
  DISTRICT_VALIDATION_CODES.PRIVATE_FIELD,
);
expectCode(
  (snapshot) => { snapshot.fieldCoordinateClaims[2].worldToFieldScale = 1; },
  DISTRICT_VALIDATION_CODES.FIELD_DOMAIN_DRIFT,
);
expectCode(
  (snapshot) => snapshot.materialOwnerClaims.push("private-building-material-owner"),
  DISTRICT_VALIDATION_CODES.MATERIAL_OWNER,
);
expectCode(
  (snapshot) => { snapshot.geometryAfterWeather.buildCount += 1; },
  DISTRICT_VALIDATION_CODES.GEOMETRY_REBUILT,
);
expectCode(
  (snapshot) => { snapshot.geometryAfterWeather.digest = "fnv32:changed0"; },
  DISTRICT_VALIDATION_CODES.GEOMETRY_REBUILT,
);

const lockedRoute = normalizeDistrictRouteLocks({
  mechanism: "shared-cause-field",
  mode: "shared-field",
  tier: "balanced",
});
assert.throws(
  () => assertDistrictRouteLock(lockedRoute, "mode", "final"),
  new RegExp(DISTRICT_VALIDATION_CODES.ROUTE_LOCK_BYPASS),
);
assert.throws(
  () => assertDistrictRouteLock(lockedRoute, "tier", "hero"),
  new RegExp(DISTRICT_VALIDATION_CODES.ROUTE_LOCK_BYPASS),
);

console.log("procedural-district mutation contracts: passed");
