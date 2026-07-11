import assert from "node:assert/strict";
import test from "node:test";

import {
  HABITAT_QUALITY_GOVERNOR_DEFAULTS,
  HABITAT_QUALITY_TIERS,
  assertHabitatQualityTier,
  computeGpuP95,
  createCreatureHabitatQualityGovernor,
} from "../quality-governor.mjs";

function windowOf(value, count = HABITAT_QUALITY_GOVERNOR_DEFAULTS.windowSize) {
  return Array.from({ length: count }, () => value);
}

test("tier identifiers are exact and constructor policy inputs are strict", () => {
  assert.deepEqual(HABITAT_QUALITY_TIERS, ["hero", "balanced", "budgeted"]);
  assert.equal(assertHabitatQualityTier("balanced"), "balanced");
  assert.throws(() => assertHabitatQualityTier("Balanced"), /exactly one of/);
  assert.throws(
    () => createCreatureHabitatQualityGovernor({ initialTier: "mobile" }),
    /initialTier must be exactly one of/,
  );
  assert.throws(
    () => createCreatureHabitatQualityGovernor({ windowSize: 29.5 }),
    /windowSize must be a positive integer/,
  );
  assert.throws(
    () => createCreatureHabitatQualityGovernor({ comfortableHeadroomRatio: 1 }),
    /comfortableHeadroomRatio/,
  );
});

test("nearest-rank p95 uses measured positive GPU timestamp durations", () => {
  const ascending = Array.from({ length: 30 }, (_, index) => index + 1);
  assert.equal(computeGpuP95(ascending), 29);
  assert.equal(computeGpuP95(new Float64Array(ascending)), 29);
  assert.throws(() => computeGpuP95([1, 0, 2]), /greater than zero/);
  assert.throws(() => computeGpuP95([1, Number.NaN, 2]), /finite/);

  const governor = createCreatureHabitatQualityGovernor({ targetFrameMs: 40 });
  const result = governor.evaluateWindow(ascending, { id: "p95-fixture" });
  assert.equal(result.p95Ms, 29);
  assert.equal(result.sampleCount, 30);
  assert.equal(result.inputMetric, "gpu-frame-timestamp-p95");
  assert.equal(result.timestampScope, "full-frame-gpu-duration");
});

test("missing or invalid timestamps skip windows and cannot cause a transition", () => {
  const governor = createCreatureHabitatQualityGovernor({
    initialTier: "hero",
    targetFrameMs: 10,
    cooldownWindows: 0,
  });

  const firstOverrun = governor.evaluateWindow(windowOf(12));
  assert.equal(firstOverrun.overTargetStreakAfter, 1);

  const unavailable = governor.evaluateWindow(null, { id: "no-query-support" });
  assert.equal(unavailable.kind, "skipped-window");
  assert.equal(unavailable.reason, "gpu-timestamp-unavailable");
  assert.equal(unavailable.persistenceReset, true);

  const invalid = windowOf(12);
  invalid[2] = 0;
  invalid[7] = -1;
  invalid[9] = Number.NaN;
  invalid[13] = Number.POSITIVE_INFINITY;
  const invalidResult = governor.evaluateWindow(invalid);
  assert.equal(invalidResult.reason, "invalid-gpu-timestamp-sample");
  assert.deepEqual(invalidResult.invalidSampleIndices, [2, 7, 9, 13]);

  const secondObservedOverrun = governor.evaluateWindow(windowOf(12));
  assert.equal(secondObservedOverrun.transition, null);
  assert.equal(secondObservedOverrun.overTargetStreakAfter, 1);
  assert.equal(governor.getTier(), "hero");

  const evidence = governor.describe();
  assert.equal(evidence.evaluatedWindowCount, 2);
  assert.equal(evidence.skippedWindowCount, 2);
  assert.equal(evidence.transitionTrace.length, 0);
  assert.deepEqual(
    evidence.skippedWindowTrace.map((record) => record.reason),
    ["gpu-timestamp-unavailable", "invalid-gpu-timestamp-sample"],
  );
});

test("downgrade and recovery require consecutive windows outside the hysteresis band", () => {
  const governor = createCreatureHabitatQualityGovernor({
    initialTier: "hero",
    targetFrameMs: 10,
    comfortableHeadroomRatio: 0.75,
    cooldownWindows: 0,
  });

  assert.equal(governor.evaluateWindow(windowOf(11)).transition, null);
  const neutral = governor.evaluateWindow(windowOf(8));
  assert.equal(neutral.classification, "hysteresis-band");
  assert.equal(neutral.overTargetStreakAfter, 0);

  assert.equal(governor.evaluateWindow(windowOf(11)).transition, null);
  const downgrade = governor.evaluateWindow(windowOf(11));
  assert.equal(downgrade.decision, "downgrade");
  assert.deepEqual(
    [downgrade.transition.fromTier, downgrade.transition.toTier],
    ["hero", "balanced"],
  );

  for (let index = 0; index < 3; index += 1) {
    assert.equal(governor.evaluateWindow(windowOf(7)).transition, null);
  }
  const upgrade = governor.evaluateWindow(windowOf(7));
  assert.equal(upgrade.decision, "upgrade");
  assert.deepEqual(
    [upgrade.transition.fromTier, upgrade.transition.toTier],
    ["balanced", "hero"],
  );
});

test("three-window cooldown counts evaluated windows only", () => {
  const governor = createCreatureHabitatQualityGovernor({
    initialTier: "hero",
    targetFrameMs: 10,
    comfortableHeadroomRatio: 0.75,
  });

  governor.evaluateWindow(windowOf(12));
  const downgrade = governor.evaluateWindow(windowOf(12));
  assert.equal(downgrade.tierAfter, "balanced");
  assert.equal(downgrade.cooldownAfter, 3);

  const skipped = governor.skipWindow("timestamp-query-disjoint");
  assert.equal(skipped.cooldownRemaining, 3);
  assert.equal(governor.describe().cooldownRemaining, 3);

  const cooldownWindows = [];
  for (let index = 0; index < 3; index += 1) {
    cooldownWindows.push(governor.evaluateWindow(windowOf(6)));
  }
  assert.deepEqual(
    cooldownWindows.map((record) => record.decision),
    ["cooldown-hold", "cooldown-hold", "cooldown-hold"],
  );
  assert.deepEqual(
    cooldownWindows.map((record) => record.cooldownAfter),
    [2, 1, 0],
  );

  for (let index = 0; index < 3; index += 1) {
    assert.equal(governor.evaluateWindow(windowOf(6)).transition, null);
  }
  const recovery = governor.evaluateWindow(windowOf(6));
  assert.equal(recovery.transition.toTier, "hero");
  assert.equal(recovery.transition.triggeringStreak, 4);
});

test("transition trace records one-tier-at-a-time downgrade and upgrade causes", () => {
  const governor = createCreatureHabitatQualityGovernor({
    initialTier: "hero",
    targetFrameMs: 10,
    comfortableHeadroomRatio: 0.75,
    cooldownWindows: 0,
  });

  for (let index = 0; index < 4; index += 1) {
    governor.evaluateWindow(windowOf(12), { sequence: index });
  }
  assert.equal(governor.getTier(), "budgeted");

  for (let index = 0; index < 8; index += 1) {
    governor.evaluateWindow(windowOf(6), { sequence: index + 4 });
  }
  assert.equal(governor.getTier(), "hero");

  const trace = governor.describe().transitionTrace;
  assert.deepEqual(
    trace.map(({ fromTier, toTier }) => [fromTier, toTier]),
    [
      ["hero", "balanced"],
      ["balanced", "budgeted"],
      ["budgeted", "balanced"],
      ["balanced", "hero"],
    ],
  );
  assert.deepEqual(
    trace.map(({ cause }) => cause),
    [
      "sustained-p95-over-target",
      "sustained-p95-over-target",
      "sustained-p95-comfortable-headroom",
      "sustained-p95-comfortable-headroom",
    ],
  );
  assert(trace.every((record) => record.sampleCount === 30));
  assert(trace.every((record) => record.timestampScope === "full-frame-gpu-duration"));
});

test("streaming samples preserve fixed window boundaries and skip a contaminated window", () => {
  const governor = createCreatureHabitatQualityGovernor({ targetFrameMs: 10 });
  for (let index = 0; index < 29; index += 1) {
    const pending = governor.recordGpuTimestamp(9, { id: "streamed" });
    assert.equal(pending.kind, "pending-window");
  }
  const evaluated = governor.recordGpuTimestamp(9);
  assert.equal(evaluated.kind, "evaluated-window");
  assert.equal(evaluated.sampleCount, 30);

  for (let index = 0; index < 29; index += 1) governor.recordGpuTimestamp(12);
  const skipped = governor.recordGpuTimestamp(undefined);
  assert.equal(skipped.kind, "skipped-window");
  assert.equal(skipped.reason, "invalid-gpu-timestamp-sample");
  assert.equal(governor.describe().skippedWindowCount, 1);
});
