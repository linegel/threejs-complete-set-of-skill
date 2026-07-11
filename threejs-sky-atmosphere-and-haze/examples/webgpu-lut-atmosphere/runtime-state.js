const PRODUCT_DISPATCH_ORDER = Object.freeze([
  "transmittance",
  "multiscatter",
  "irradiance",
  "skyView",
  "aerialProducts",
]);

export const ATMOSPHERE_RUNTIME_DEPENDENCIES = Object.freeze({
  transmittance: Object.freeze(["modelRevision", "tier"]),
  multiscatter: Object.freeze(["modelRevision", "tier"]),
  irradiance: Object.freeze(["modelRevision", "tier"]),
  skyView: Object.freeze([
    "modelRevision",
    "tier",
    "cameraRadiusKm",
    "localSunMu",
  ]),
  aerialProducts: Object.freeze([
    "modelRevision",
    "tier",
    "cameraPositionBodyKm",
    "inverseViewProjectionBodyKm",
    "sunDirectionBody",
    "aerialFarKm",
    "viewport",
  ]),
});

export { PRODUCT_DISPATCH_ORDER };

function finiteNumber(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function finiteArray(name, value, length) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    throw new TypeError(`${name} must contain ${length} finite values`);
  }
  return value.map(Number);
}

function normalize3(name, value) {
  const vector = finiteArray(name, value, 3);
  const magnitude = Math.hypot(...vector);
  if (!(magnitude > 0)) throw new RangeError(`${name} must be non-zero`);
  return vector.map((component) => component / magnitude);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function atmosphereDependencyFingerprint(value) {
  const source = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function validateAtmosphereRuntimeState(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("atmosphere runtime state is required");
  }
  const validated = {
    modelRevision: String(state.modelRevision ?? "atmosphere-model-v2"),
    tier: String(state.tier),
    cameraRadiusKm: finiteNumber("cameraRadiusKm", state.cameraRadiusKm),
    localSunMu: finiteNumber("localSunMu", state.localSunMu),
    cameraPositionWorld: finiteArray(
      "cameraPositionWorld",
      state.cameraPositionWorld,
      3,
    ),
    cameraPositionBodyKm: finiteArray(
      "cameraPositionBodyKm",
      state.cameraPositionBodyKm,
      3,
    ),
    inverseViewProjectionWorld: finiteArray(
      "inverseViewProjectionWorld",
      state.inverseViewProjectionWorld,
      16,
    ),
    inverseViewProjectionBodyKm: finiteArray(
      "inverseViewProjectionBodyKm",
      state.inverseViewProjectionBodyKm,
      16,
    ),
    worldToBody: finiteArray("worldToBody", state.worldToBody, 16),
    worldToView: finiteArray("worldToView", state.worldToView, 16),
    sunDirectionBody: normalize3("sunDirectionBody", state.sunDirectionBody),
    solarNormalIrradiance: finiteArray(
      "solarNormalIrradiance",
      state.solarNormalIrradiance,
      3,
    ),
    aerialFarKm: finiteNumber("aerialFarKm", state.aerialFarKm),
    viewport: finiteArray("viewport", state.viewport, 2),
  };
  if (!(validated.cameraRadiusKm > 0)) {
    throw new RangeError("cameraRadiusKm must be positive");
  }
  if (!(validated.localSunMu >= -1 && validated.localSunMu <= 1)) {
    throw new RangeError("localSunMu must be in [-1, 1]");
  }
  if (!(validated.aerialFarKm > 0)) {
    throw new RangeError("aerialFarKm must be positive");
  }
  if (!validated.viewport.every((extent) => extent > 0)) {
    throw new RangeError("viewport extents must be positive");
  }
  if (validated.solarNormalIrradiance.some((value) => value < 0)) {
    throw new RangeError("solarNormalIrradiance must be componentwise non-negative");
  }
  return validated;
}

export function createDefaultAtmosphereRuntimeState(config) {
  const bottomRadiusKm = config.radiiMeters.bottom / 1000;
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return validateAtmosphereRuntimeState({
    modelRevision: config.modelRevision ?? "atmosphere-model-v2",
    tier: config.tier,
    cameraRadiusKm: bottomRadiusKm + 2,
    localSunMu: 0.72,
    cameraPositionWorld: [0, bottomRadiusKm + 2, 0],
    cameraPositionBodyKm: [0, bottomRadiusKm + 2, 0],
    inverseViewProjectionWorld: identity,
    inverseViewProjectionBodyKm: identity,
    worldToBody: identity,
    worldToView: identity,
    sunDirectionBody: [0.35, 0.72, 0.6],
    solarNormalIrradiance: config.solarIrradiance,
    aerialFarKm: 160,
    viewport: [1200, 800],
  });
}

function dependencyRecord(state, product) {
  return Object.fromEntries(
    ATMOSPHERE_RUNTIME_DEPENDENCIES[product].map((key) => [key, state[key]]),
  );
}

export function resolveAtmosphereDirtyProducts(previousState, nextState) {
  const next = validateAtmosphereRuntimeState(nextState);
  if (!previousState) {
    return {
      state: next,
      dirty: [...PRODUCT_DISPATCH_ORDER],
      reasons: Object.fromEntries(
        PRODUCT_DISPATCH_ORDER.map((product) => [product, ["initialization"]]),
      ),
    };
  }
  const previous = validateAtmosphereRuntimeState(previousState);
  const dirty = [];
  const reasons = {};
  for (const product of PRODUCT_DISPATCH_ORDER) {
    const changed = ATMOSPHERE_RUNTIME_DEPENDENCIES[product].filter(
      (key) =>
        atmosphereDependencyFingerprint(previous[key]) !==
        atmosphereDependencyFingerprint(next[key]),
    );
    if (changed.length > 0) {
      dirty.push(product);
      reasons[product] = changed;
    }
  }
  return { state: next, dirty, reasons };
}

export class AtmosphereInvalidationTracker {
  constructor() {
    this.state = null;
    this.pending = new Set();
    this.pendingReasons = new Map();
    this.updateCounts = Object.fromEntries(
      PRODUCT_DISPATCH_ORDER.map((product) => [product, 0]),
    );
    this.lastUpdateReasons = Object.fromEntries(
      PRODUCT_DISPATCH_ORDER.map((product) => [product, null]),
    );
  }

  configure(nextState, cause = "runtime-control") {
    const resolved = resolveAtmosphereDirtyProducts(this.state, nextState);
    this.state = resolved.state;
    for (const product of resolved.dirty) {
      this.pending.add(product);
      const changed = resolved.reasons[product] ?? [];
      this.pendingReasons.set(product, [cause, ...changed]);
    }
    return resolved;
  }

  markAllDirty(cause) {
    if (typeof cause !== "string" || cause.length === 0) {
      throw new TypeError("dirty-all cause is required");
    }
    for (const product of PRODUCT_DISPATCH_ORDER) {
      this.pending.add(product);
      this.pendingReasons.set(product, [cause]);
    }
  }

  consume() {
    const dirty = PRODUCT_DISPATCH_ORDER.filter((product) => this.pending.has(product));
    const reasons = Object.fromEntries(
      dirty.map((product) => [product, this.pendingReasons.get(product) ?? []]),
    );
    for (const product of dirty) {
      this.pending.delete(product);
      this.pendingReasons.delete(product);
      this.updateCounts[product] += 1;
      this.lastUpdateReasons[product] = reasons[product];
    }
    return { dirty, reasons };
  }

  describe() {
    const state = this.state;
    return {
      updateCounts: { ...this.updateCounts },
      lastUpdateReasons: structuredClone(this.lastUpdateReasons),
      pending: PRODUCT_DISPATCH_ORDER.filter((product) => this.pending.has(product)),
      dependencyHashes: state
        ? Object.fromEntries(
            PRODUCT_DISPATCH_ORDER.map((product) => [
              product,
              atmosphereDependencyFingerprint(dependencyRecord(state, product)),
            ]),
          )
        : {},
      solarMagnitudeFactoredOut: true,
    };
  }
}
