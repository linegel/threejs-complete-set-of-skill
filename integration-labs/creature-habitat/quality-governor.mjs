export const HABITAT_QUALITY_TIERS = Object.freeze([
  "hero",
  "balanced",
  "budgeted",
]);

export const HABITAT_QUALITY_GOVERNOR_DEFAULTS = Object.freeze({
  targetFrameMs: 16.67,
  windowSize: 30,
  downgradePersistence: 2,
  upgradePersistence: 4,
  cooldownWindows: 3,
  comfortableHeadroomRatio: 0.75,
});

function assertPositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and greater than zero`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return value;
}

export function assertHabitatQualityTier(tier, label = "tier") {
  if (typeof tier !== "string" || !HABITAT_QUALITY_TIERS.includes(tier)) {
    throw new RangeError(
      `${label} must be exactly one of: ${HABITAT_QUALITY_TIERS.join(", ")}`,
    );
  }
  return tier;
}

function isNumericSequence(value) {
  return Array.isArray(value)
    || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

function copyContext(context) {
  if (context === undefined) return null;
  if (context === null || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("quality-governor window context must be an object");
  }
  return Object.freeze({ ...context });
}

function cloneRecord(record) {
  return {
    ...record,
    context: record.context === null ? null : { ...record.context },
    transition: record.transition === null
      ? null
      : {
        ...record.transition,
        context: record.transition.context === null
          ? null
          : { ...record.transition.context },
      },
    invalidSampleIndices: record.invalidSampleIndices
      ? [...record.invalidSampleIndices]
      : undefined,
  };
}

/**
 * Nearest-rank percentile. GPU duration samples must be finite and positive;
 * an unavailable timestamp is not a zero-duration observation.
 */
export function nearestRankPercentile(samples, quantile) {
  if (!isNumericSequence(samples) || samples.length === 0) {
    throw new TypeError("percentile samples must be a non-empty numeric sequence");
  }
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new RangeError("percentile quantile must be in (0, 1]");
  }
  const values = Array.from(samples);
  for (let index = 0; index < values.length; index += 1) {
    assertPositiveFinite(values[index], `percentile sample ${index}`);
  }
  values.sort((a, b) => a - b);
  const rank = Math.ceil(quantile * values.length);
  return values[rank - 1];
}

export function computeGpuP95(samples) {
  return nearestRankPercentile(samples, 0.95);
}

/**
 * Deterministic, browser-independent quality state machine.
 *
 * A candidate window is evaluated only when it contains exactly windowSize
 * finite, positive GPU timestamp durations. Missing, zero, negative, NaN, and
 * infinite values skip the entire window. Skipped windows never consume the
 * evaluated-window cooldown and break persistence streaks, preventing unknown
 * GPU time from being treated as evidence of sustained headroom or overrun.
 */
export function createCreatureHabitatQualityGovernor({
  initialTier = "hero",
  targetFrameMs = HABITAT_QUALITY_GOVERNOR_DEFAULTS.targetFrameMs,
  windowSize = HABITAT_QUALITY_GOVERNOR_DEFAULTS.windowSize,
  downgradePersistence = HABITAT_QUALITY_GOVERNOR_DEFAULTS.downgradePersistence,
  upgradePersistence = HABITAT_QUALITY_GOVERNOR_DEFAULTS.upgradePersistence,
  cooldownWindows = HABITAT_QUALITY_GOVERNOR_DEFAULTS.cooldownWindows,
  comfortableHeadroomRatio = HABITAT_QUALITY_GOVERNOR_DEFAULTS.comfortableHeadroomRatio,
} = {}) {
  assertHabitatQualityTier(initialTier, "initialTier");
  assertPositiveFinite(targetFrameMs, "targetFrameMs");
  assertPositiveInteger(windowSize, "windowSize");
  assertPositiveInteger(downgradePersistence, "downgradePersistence");
  assertPositiveInteger(upgradePersistence, "upgradePersistence");
  assertNonNegativeInteger(cooldownWindows, "cooldownWindows");
  if (
    !Number.isFinite(comfortableHeadroomRatio)
    || comfortableHeadroomRatio <= 0
    || comfortableHeadroomRatio >= 1
  ) {
    throw new RangeError("comfortableHeadroomRatio must be finite and in (0, 1)");
  }

  const recoveryGateMs = targetFrameMs * comfortableHeadroomRatio;
  let tierIndex = HABITAT_QUALITY_TIERS.indexOf(initialTier);
  let attemptedWindowCount = 0;
  let evaluatedWindowCount = 0;
  let overTargetStreak = 0;
  let underTargetStreak = 0;
  let cooldownRemaining = 0;
  let pendingSamples = [];
  let pendingContext = null;

  const evaluatedWindowTrace = [];
  const skippedWindowTrace = [];
  const transitionTrace = [];

  function activeTier() {
    return HABITAT_QUALITY_TIERS[tierIndex];
  }

  function recordSkippedWindow({
    reason,
    receivedSampleCount,
    validSampleCount,
    invalidSampleIndices = [],
    context,
  }) {
    const record = Object.freeze({
      kind: "skipped-window",
      attemptedWindowIndex: attemptedWindowCount,
      tier: activeTier(),
      reason,
      expectedSampleCount: windowSize,
      receivedSampleCount,
      validSampleCount,
      invalidSampleIndices: Object.freeze([...invalidSampleIndices]),
      cooldownRemaining,
      overTargetStreakBefore: overTargetStreak,
      underTargetStreakBefore: underTargetStreak,
      persistenceReset: overTargetStreak > 0 || underTargetStreak > 0,
      transition: null,
      context,
    });
    attemptedWindowCount += 1;
    overTargetStreak = 0;
    underTargetStreak = 0;
    skippedWindowTrace.push(record);
    return cloneRecord(record);
  }

  function makeTransition({
    fromTier,
    toTier,
    cause,
    p95Ms,
    triggeringStreak,
    attemptedWindowIndex,
    evaluatedWindowIndex,
    context,
  }) {
    const transition = Object.freeze({
      transitionIndex: transitionTrace.length,
      attemptedWindowIndex,
      evaluatedWindowIndex,
      fromTier,
      toTier,
      cause,
      inputMetric: "gpu-frame-timestamp-p95",
      timestampScope: "full-frame-gpu-duration",
      p95Ms,
      targetFrameMs,
      recoveryGateMs,
      sampleCount: windowSize,
      triggeringStreak,
      cooldownWindows,
      context,
    });
    transitionTrace.push(transition);
    return transition;
  }

  function evaluateValidWindow(samples, context) {
    const attemptedWindowIndex = attemptedWindowCount;
    const evaluatedWindowIndex = evaluatedWindowCount;
    const tierBefore = activeTier();
    const p95Ms = computeGpuP95(samples);
    const cooldownBefore = cooldownRemaining;
    const overTargetStreakBefore = overTargetStreak;
    const underTargetStreakBefore = underTargetStreak;
    const classification = p95Ms > targetFrameMs
      ? "over-target"
      : p95Ms < recoveryGateMs
        ? "comfortably-under-target"
        : "hysteresis-band";

    let decision = "hold";
    let transition = null;

    if (cooldownRemaining > 0) {
      cooldownRemaining -= 1;
      overTargetStreak = 0;
      underTargetStreak = 0;
      decision = "cooldown-hold";
    } else {
      if (classification === "over-target") {
        overTargetStreak += 1;
        underTargetStreak = 0;
      } else if (classification === "comfortably-under-target") {
        underTargetStreak += 1;
        overTargetStreak = 0;
      } else {
        overTargetStreak = 0;
        underTargetStreak = 0;
        decision = "hysteresis-hold";
      }

      if (overTargetStreak >= downgradePersistence) {
        if (tierIndex < HABITAT_QUALITY_TIERS.length - 1) {
          const fromTier = activeTier();
          tierIndex += 1;
          transition = makeTransition({
            fromTier,
            toTier: activeTier(),
            cause: "sustained-p95-over-target",
            p95Ms,
            triggeringStreak: overTargetStreak,
            attemptedWindowIndex,
            evaluatedWindowIndex,
            context,
          });
          cooldownRemaining = cooldownWindows;
          decision = "downgrade";
        } else {
          decision = "lowest-tier-overrun";
        }
        overTargetStreak = 0;
        underTargetStreak = 0;
      } else if (underTargetStreak >= upgradePersistence) {
        if (tierIndex > 0) {
          const fromTier = activeTier();
          tierIndex -= 1;
          transition = makeTransition({
            fromTier,
            toTier: activeTier(),
            cause: "sustained-p95-comfortable-headroom",
            p95Ms,
            triggeringStreak: underTargetStreak,
            attemptedWindowIndex,
            evaluatedWindowIndex,
            context,
          });
          cooldownRemaining = cooldownWindows;
          decision = "upgrade";
        } else {
          decision = "highest-tier-headroom";
        }
        overTargetStreak = 0;
        underTargetStreak = 0;
      }
    }

    const record = Object.freeze({
      kind: "evaluated-window",
      attemptedWindowIndex,
      evaluatedWindowIndex,
      tierBefore,
      tierAfter: activeTier(),
      inputMetric: "gpu-frame-timestamp-p95",
      timestampScope: "full-frame-gpu-duration",
      sampleCount: samples.length,
      p95Ms,
      targetFrameMs,
      recoveryGateMs,
      classification,
      decision,
      cooldownBefore,
      cooldownAfter: cooldownRemaining,
      overTargetStreakBefore,
      overTargetStreakAfter: overTargetStreak,
      underTargetStreakBefore,
      underTargetStreakAfter: underTargetStreak,
      transition,
      context,
    });

    attemptedWindowCount += 1;
    evaluatedWindowCount += 1;
    evaluatedWindowTrace.push(record);
    return cloneRecord(record);
  }

  function evaluateWindow(samples, context = undefined) {
    if (pendingSamples.length > 0) {
      throw new Error(
        "cannot evaluate an explicit window while streaming GPU samples are pending; flush the pending window first",
      );
    }
    const copiedContext = copyContext(context);
    if (samples === null || samples === undefined) {
      return recordSkippedWindow({
        reason: "gpu-timestamp-unavailable",
        receivedSampleCount: 0,
        validSampleCount: 0,
        context: copiedContext,
      });
    }
    if (!isNumericSequence(samples)) {
      throw new TypeError("GPU timestamp window must be an Array or typed array");
    }

    const values = Array.from(samples);
    const invalidSampleIndices = [];
    for (let index = 0; index < values.length; index += 1) {
      if (!Number.isFinite(values[index]) || values[index] <= 0) {
        invalidSampleIndices.push(index);
      }
    }
    const validSampleCount = values.length - invalidSampleIndices.length;

    if (values.length !== windowSize) {
      return recordSkippedWindow({
        reason: values.length === 0
          ? "gpu-timestamp-unavailable"
          : "gpu-timestamp-window-size-mismatch",
        receivedSampleCount: values.length,
        validSampleCount,
        invalidSampleIndices,
        context: copiedContext,
      });
    }
    if (invalidSampleIndices.length > 0) {
      return recordSkippedWindow({
        reason: "invalid-gpu-timestamp-sample",
        receivedSampleCount: values.length,
        validSampleCount,
        invalidSampleIndices,
        context: copiedContext,
      });
    }
    return evaluateValidWindow(values, copiedContext);
  }

  function recordGpuTimestamp(sampleMs, context = undefined) {
    if (pendingSamples.length === 0) pendingContext = copyContext(context);
    pendingSamples.push(sampleMs);
    if (pendingSamples.length < windowSize) {
      return {
        kind: "pending-window",
        pendingSampleCount: pendingSamples.length,
        expectedSampleCount: windowSize,
        sampleAccepted: Number.isFinite(sampleMs) && sampleMs > 0,
        tier: activeTier(),
      };
    }
    const samples = pendingSamples;
    const windowContext = pendingContext;
    pendingSamples = [];
    pendingContext = null;

    const invalidSampleIndices = [];
    for (let index = 0; index < samples.length; index += 1) {
      if (!Number.isFinite(samples[index]) || samples[index] <= 0) {
        invalidSampleIndices.push(index);
      }
    }
    if (invalidSampleIndices.length > 0) {
      return recordSkippedWindow({
        reason: "invalid-gpu-timestamp-sample",
        receivedSampleCount: samples.length,
        validSampleCount: samples.length - invalidSampleIndices.length,
        invalidSampleIndices,
        context: windowContext,
      });
    }
    return evaluateValidWindow(samples, windowContext);
  }

  function flushPendingWindow(context = undefined) {
    if (pendingSamples.length === 0) return null;
    const samples = pendingSamples;
    const windowContext = context === undefined ? pendingContext : copyContext(context);
    pendingSamples = [];
    pendingContext = null;
    const invalidSampleIndices = [];
    for (let index = 0; index < samples.length; index += 1) {
      if (!Number.isFinite(samples[index]) || samples[index] <= 0) {
        invalidSampleIndices.push(index);
      }
    }
    return recordSkippedWindow({
      reason: "gpu-timestamp-window-size-mismatch",
      receivedSampleCount: samples.length,
      validSampleCount: samples.length - invalidSampleIndices.length,
      invalidSampleIndices,
      context: windowContext,
    });
  }

  function skipWindow(reason = "gpu-timestamp-unavailable", context = undefined) {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new TypeError("skipped-window reason must be a non-empty string");
    }
    if (pendingSamples.length > 0) {
      throw new Error(
        "cannot skip an explicit window while streaming GPU samples are pending; flush the pending window first",
      );
    }
    return recordSkippedWindow({
      reason,
      receivedSampleCount: 0,
      validSampleCount: 0,
      context: copyContext(context),
    });
  }

  function describe() {
    return {
      owner: "threejs-image-pipeline",
      activeTier: activeTier(),
      tierOrder: [...HABITAT_QUALITY_TIERS],
      inputMetric: "gpu-frame-timestamp-p95",
      timestampScope: "full-frame-gpu-duration",
      quantileEstimator: "nearest-rank",
      targetFrameMs,
      recoveryGateMs,
      comfortableHeadroomRatio,
      windowSize,
      downgradePersistence,
      upgradePersistence,
      cooldownWindows,
      cooldownRemaining,
      overTargetStreak,
      underTargetStreak,
      pendingSampleCount: pendingSamples.length,
      attemptedWindowCount,
      evaluatedWindowCount,
      skippedWindowCount: skippedWindowTrace.length,
      evaluatedWindowTrace: evaluatedWindowTrace.map(cloneRecord),
      skippedWindowTrace: skippedWindowTrace.map(cloneRecord),
      transitionTrace: transitionTrace.map((transition) => ({
        ...transition,
        context: transition.context === null ? null : { ...transition.context },
      })),
    };
  }

  return Object.freeze({
    evaluateWindow,
    recordGpuTimestamp,
    flushPendingWindow,
    skipWindow,
    describe,
    getTier: activeTier,
  });
}

