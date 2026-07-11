import { RELATIVISTIC_TIERS } from "./routes.mjs";

function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function createRelativisticQualityGovernor({
  initialTier = "balanced",
  targetFrameMs = 16.67,
  windowSize = 30,
  downgradePersistence = 2,
  upgradePersistence = 5,
  cooldownWindows = 4,
  locked = true,
  onTransition = () => {},
} = {}) {
  if (!RELATIVISTIC_TIERS.includes(initialTier)) throw new RangeError(`unknown governor tier: ${initialTier}`);
  if (![targetFrameMs, windowSize, downgradePersistence, upgradePersistence, cooldownWindows].every(Number.isFinite)) {
    throw new TypeError("quality-governor numeric inputs must be finite");
  }
  let tierIndex = RELATIVISTIC_TIERS.indexOf(initialTier);
  let overrunWindows = 0;
  let headroomWindows = 0;
  let cooldown = 0;
  let samples = [];
  let windowIndex = 0;
  const windows = [];
  const transitions = [];

  function evaluateWindow() {
    const p95 = percentile(samples, 0.95);
    const record = { windowIndex, tier: RELATIVISTIC_TIERS[tierIndex], p95Ms: p95, sampleCount: samples.length };
    windows.push(record);
    samples = [];
    windowIndex += 1;
    if (cooldown > 0) {
      cooldown -= 1;
      overrunWindows = 0;
      headroomWindows = 0;
      return record;
    }
    if (p95 > targetFrameMs) {
      overrunWindows += 1;
      headroomWindows = 0;
    } else if (p95 < targetFrameMs * 0.72) {
      headroomWindows += 1;
      overrunWindows = 0;
    } else {
      overrunWindows = 0;
      headroomWindows = 0;
    }
    if (locked) return record;
    let nextIndex = tierIndex;
    let reason = null;
    if (overrunWindows >= downgradePersistence && tierIndex < RELATIVISTIC_TIERS.length - 1) {
      nextIndex = tierIndex + 1;
      reason = "sustained-p95-overrun";
    } else if (headroomWindows >= upgradePersistence && tierIndex > 0) {
      nextIndex = tierIndex - 1;
      reason = "sustained-p95-headroom";
    }
    if (nextIndex !== tierIndex) {
      const transition = {
        from: RELATIVISTIC_TIERS[tierIndex],
        to: RELATIVISTIC_TIERS[nextIndex],
        reason,
        p95Ms: p95,
        windowIndex: record.windowIndex,
      };
      tierIndex = nextIndex;
      transitions.push(transition);
      cooldown = cooldownWindows;
      overrunWindows = 0;
      headroomWindows = 0;
      onTransition(transition);
    }
    return record;
  }

  return {
    record(frameMs) {
      if (!Number.isFinite(frameMs) || frameMs < 0) throw new RangeError("governor frame sample must be finite and nonnegative");
      samples.push(frameMs);
      return samples.length >= windowSize ? evaluateWindow() : null;
    },
    describe() {
      return {
        owner: "threejs-image-pipeline",
        activeTier: RELATIVISTIC_TIERS[tierIndex],
        targetFrameMs,
        statistic: "measured host-frame p95",
        windowSize,
        downgradePersistence,
        upgradePersistence,
        cooldownWindows,
        cooldownRemaining: cooldown,
        locked,
        windows: windows.map((record) => ({ ...record })),
        transitions: transitions.map((record) => ({ ...record })),
        gpuTimingVerdict: "INSUFFICIENT_EVIDENCE",
      };
    },
  };
}

export function validateRelativisticTierPolicy({ manifestTiers, contractTiers, runtimeTiers }) {
  const errors = [];
  const manifestById = new Map(manifestTiers.map((tier) => [tier.id, tier]));
  const contractById = new Map(contractTiers.map((tier) => [tier.id, tier]));
  for (const id of RELATIVISTIC_TIERS) {
    const manifest = manifestById.get(id);
    const contract = contractById.get(id);
    const runtime = runtimeTiers[id];
    if (!manifest || !contract || !runtime) {
      errors.push(`tier drift ${id}: missing manifest, contract, or runtime tier`);
      continue;
    }
    for (const [key, value] of Object.entries({
      sceneScale: runtime.sceneScale,
      rayScale: runtime.rayScale,
      bloomScale: runtime.bloomScale,
      dprCap: runtime.dprCap,
    })) {
      if (manifest.resolutionPolicy[key] !== value || contract.resolutionPolicy[key] !== value) {
        errors.push(`tier drift ${id}.${key}: manifest=${manifest.resolutionPolicy[key]} contract=${contract.resolutionPolicy[key]} runtime=${value}`);
      }
    }
    const expectedLimits = {
      curvedRayTier: runtime.spaceQuality,
      curvedRayMaxSteps: runtime.maxSteps,
      particleTier: runtime.particleTier,
      sparkPoolCapacity: runtime.sparkPoolCapacity,
      debrisPoolCapacity: runtime.debrisPoolCapacity,
      sparkEventCount: runtime.sparkCount,
      debrisEventCount: runtime.debrisCount,
      exposureTier: runtime.exposureTier,
      temporal: true,
    };
    for (const [key, value] of Object.entries(expectedLimits)) {
      if (manifest.mechanismLimits[key] !== value || contract.mechanismLimits[key] !== value) {
        errors.push(`tier drift ${id}.${key}: manifest=${manifest.mechanismLimits[key]} contract=${contract.mechanismLimits[key]} runtime=${value}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
