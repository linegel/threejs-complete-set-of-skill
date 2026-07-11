export const FINAL_IMAGE_FLIGHT_TIER_ORDER = Object.freeze([
  "hero",
  "balanced",
  "budgeted",
]);

export const FINAL_IMAGE_FLIGHT_GOVERNOR_POLICY = Object.freeze({
  targetFrameMs: 16.67,
  downgradeP95Ms: 16.67,
  upgradeP95Ms: 12.5,
  windowSize: 30,
  downgradeWindows: 2,
  upgradeWindows: 4,
  cooldownWindows: 3,
  maximumTraceEntries: 256,
});

function finiteNonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function datum(value, unit, label, source) {
  return { value, unit, label, source };
}

function validatePolicy(policy) {
  finiteNonnegative(policy.targetFrameMs, "targetFrameMs");
  finiteNonnegative(policy.downgradeP95Ms, "downgradeP95Ms");
  finiteNonnegative(policy.upgradeP95Ms, "upgradeP95Ms");
  if (policy.upgradeP95Ms >= policy.downgradeP95Ms) {
    throw new RangeError("upgradeP95Ms must be below downgradeP95Ms to create hysteresis");
  }
  positiveInteger(policy.windowSize, "windowSize");
  positiveInteger(policy.downgradeWindows, "downgradeWindows");
  positiveInteger(policy.upgradeWindows, "upgradeWindows");
  positiveInteger(policy.cooldownWindows, "cooldownWindows");
  positiveInteger(policy.maximumTraceEntries, "maximumTraceEntries");
  return policy;
}

export function p95NearestRank(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new RangeError("p95 requires at least one sample");
  const ordered = samples.map((sample) => finiteNonnegative(sample, "p95 sample")).sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(0.95 * ordered.length) - 1)];
}

/**
 * A timestamp-only governor. Missing render or compute timestamps are recorded
 * as insufficient evidence and cannot advance a streak, cooldown, or tier.
 */
export function createSustainedP95Governor({
  initialTier = "balanced",
  tierLocked = false,
  policy: policyOverrides = {},
  onTransition = async () => {},
} = {}) {
  if (!FINAL_IMAGE_FLIGHT_TIER_ORDER.includes(initialTier)) throw new RangeError(`unknown governor tier: ${initialTier}`);
  if (typeof onTransition !== "function") throw new TypeError("governor onTransition must be a function");
  const policy = validatePolicy({ ...FINAL_IMAGE_FLIGHT_GOVERNOR_POLICY, ...policyOverrides });
  const samples = [];
  const trace = [];
  let tier = initialTier;
  let windowIndex = 0;
  let measuredSampleCount = 0;
  let unavailableSampleCount = 0;
  let overrunWindows = 0;
  let headroomWindows = 0;
  let cooldownRemaining = 0;
  let transitionInFlight = false;

  function appendTrace(entry) {
    trace.push(Object.freeze(entry));
    if (trace.length > policy.maximumTraceEntries) trace.splice(0, trace.length - policy.maximumTraceEntries);
  }

  function recordUnavailable({ frameId, reason }) {
    if (!Number.isInteger(frameId) || frameId < 0) throw new RangeError("unavailable timestamp frameId must be a nonnegative integer");
    if (typeof reason !== "string" || reason.length === 0) throw new TypeError("unavailable timestamp reason is required");
    unavailableSampleCount += 1;
    appendTrace({
      type: "timestamp-unavailable",
      frameId: datum(frameId, "frame-id", "Measured", "host frame sequence"),
      verdict: "INSUFFICIENT_EVIDENCE",
      reason,
      tier,
      transition: null,
    });
    return { verdict: "INSUFFICIENT_EVIDENCE", transition: null };
  }

  function synchronizeTier(nextTier, { reason = "external-tier-selection" } = {}) {
    if (!FINAL_IMAGE_FLIGHT_TIER_ORDER.includes(nextTier)) throw new RangeError(`unknown governor tier: ${nextTier}`);
    if (typeof reason !== "string" || reason.length === 0) throw new TypeError("tier synchronization reason is required");
    if (transitionInFlight) throw new Error("cannot externally synchronize a governor transition in flight");
    if (nextTier === tier) return false;
    const from = tier;
    tier = nextTier;
    samples.length = 0;
    overrunWindows = 0;
    headroomWindows = 0;
    cooldownRemaining = 0;
    appendTrace({
      type: "external-tier-synchronization",
      fromTier: from,
      tier,
      reason,
      transition: { from, to: tier, cause: reason },
    });
    return true;
  }

  async function recordTimestampSample({ frameId, renderMs, computeMs, source = "renderer-timestamp-query" }) {
    if (transitionInFlight) throw new Error("quality-governor transition is already in flight");
    if (!Number.isInteger(frameId) || frameId < 0) throw new RangeError("timestamp frameId must be a nonnegative integer");
    if (!Number.isFinite(renderMs) || !Number.isFinite(computeMs)) {
      return recordUnavailable({ frameId, reason: "both render and compute timestamps are required for composed-frame timing" });
    }
    finiteNonnegative(renderMs, "renderMs");
    finiteNonnegative(computeMs, "computeMs");
    if (source !== "renderer-timestamp-query") throw new Error("quality governor accepts renderer timestamp-query measurements only");
    const composedFrameMs = renderMs + computeMs;
    measuredSampleCount += 1;
    samples.push(composedFrameMs);
    if (samples.length < policy.windowSize) {
      return { verdict: "MEASURED_WINDOW_INCOMPLETE", transition: null, sampleCount: samples.length };
    }

    const windowSamples = samples.splice(0, policy.windowSize);
    const p95Ms = p95NearestRank(windowSamples);
    windowIndex += 1;
    const fromTier = tier;
    let classification = "hysteresis-band";
    if (p95Ms > policy.downgradeP95Ms) {
      classification = "over-budget";
      overrunWindows += 1;
      headroomWindows = 0;
    } else if (p95Ms < policy.upgradeP95Ms) {
      classification = "headroom";
      headroomWindows += 1;
      overrunWindows = 0;
    } else {
      overrunWindows = 0;
      headroomWindows = 0;
    }

    let transition = null;
    let decision = "hold";
    if (tierLocked) {
      decision = "route-locked";
    } else if (cooldownRemaining > 0) {
      decision = "cooldown";
      cooldownRemaining -= 1;
    } else {
      const tierIndex = FINAL_IMAGE_FLIGHT_TIER_ORDER.indexOf(tier);
      if (overrunWindows >= policy.downgradeWindows && tierIndex < FINAL_IMAGE_FLIGHT_TIER_ORDER.length - 1) {
        transition = { from: tier, to: FINAL_IMAGE_FLIGHT_TIER_ORDER[tierIndex + 1], cause: "sustained-p95-overrun" };
      } else if (headroomWindows >= policy.upgradeWindows && tierIndex > 0) {
        transition = { from: tier, to: FINAL_IMAGE_FLIGHT_TIER_ORDER[tierIndex - 1], cause: "sustained-p95-headroom" };
      } else if (overrunWindows >= policy.downgradeWindows || headroomWindows >= policy.upgradeWindows) {
        decision = "quality-boundary";
      }
    }

    if (transition) {
      transitionInFlight = true;
      try {
        await onTransition(transition.to, {
          ...transition,
          windowIndex,
          p95Ms,
          source,
        });
        tier = transition.to;
        cooldownRemaining = policy.cooldownWindows;
        overrunWindows = 0;
        headroomWindows = 0;
        decision = "transition-applied";
      } finally {
        transitionInFlight = false;
      }
    }

    const traceEntry = {
      type: "measured-p95-window",
      windowIndex: datum(windowIndex, "window-index", "Derived", "completed timestamp windows"),
      endingFrameId: datum(frameId, "frame-id", "Measured", "host frame sequence"),
      sampleCount: datum(windowSamples.length, "frames", "Measured", "renderer timestamp-query samples"),
      p95Ms: datum(p95Ms, "ms", "Measured", "nearest-rank p95 of composed render plus compute timestamps"),
      targetFrameMs: datum(policy.targetFrameMs, "ms", "Gated", "integration 60 Hz target"),
      classification,
      decision,
      fromTier,
      tier,
      transition,
      cooldownRemaining,
    };
    appendTrace(traceEntry);
    return { verdict: "MEASURED", transition, trace: structuredClone(traceEntry) };
  }

  function describe() {
    return {
      owner: "final-image-flight:image-pipeline-host",
      activeTier: tier,
      tierLocked,
      sampleSource: "renderer-timestamp-query",
      frameAggregationPolicy: "exactly-one-rendered-frame-per-resolve",
      composedFrameFormula: "renderMs + computeMs for exactly one host-rendered frame per timestamp resolve",
      policy: {
        targetFrameMs: datum(policy.targetFrameMs, "ms", "Gated", "integration 60 Hz target"),
        downgradeP95Ms: datum(policy.downgradeP95Ms, "ms", "Authored", "quality-governor overrun gate"),
        upgradeP95Ms: datum(policy.upgradeP95Ms, "ms", "Authored", "quality-governor headroom gate"),
        windowSize: datum(policy.windowSize, "frames", "Authored", "sustained p95 window"),
        downgradeWindows: datum(policy.downgradeWindows, "windows", "Authored", "overrun persistence"),
        upgradeWindows: datum(policy.upgradeWindows, "windows", "Authored", "headroom persistence"),
        cooldownWindows: datum(policy.cooldownWindows, "windows", "Authored", "post-transition cooldown"),
      },
      measuredSampleCount: datum(measuredSampleCount, "frames", "Measured", "finite render and compute timestamp pairs"),
      unavailableSampleCount: datum(unavailableSampleCount, "frames", "Measured", "missing timestamp pairs"),
      pendingWindowSamples: datum(samples.length, "frames", "Measured", "current p95 window"),
      completedWindows: datum(windowIndex, "windows", "Derived", "completed p95 windows"),
      cooldownRemaining: datum(cooldownRemaining, "windows", "Derived", "governor state"),
      transitionTrace: structuredClone(trace),
      verdict: windowIndex > 0 ? "MEASURED_NOT_ACCEPTED" : "INSUFFICIENT_EVIDENCE",
    };
  }

  return Object.freeze({
    recordTimestampSample,
    recordUnavailable,
    synchronizeTier,
    describe,
    get tier() { return tier; },
  });
}
