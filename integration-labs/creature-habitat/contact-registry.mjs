const DEFAULT_CAPACITY = 8;
const DEFAULT_LIFETIME_SECONDS = 0.72;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function freezeEvent(event) {
  return Object.freeze(event);
}

/**
 * A deterministic bounded event ring. Consumers receive the same frozen array
 * and event objects; neither water nor vegetation owns or rewrites the ring.
 */
export class BoundedContactRegistry {
  constructor({ capacity = DEFAULT_CAPACITY, lifetimeSeconds = DEFAULT_LIFETIME_SECONDS } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("contact capacity must be a positive integer");
    if (!Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) {
      throw new RangeError("contact lifetimeSeconds must be finite and positive");
    }
    this.capacity = capacity;
    this.lifetimeSeconds = lifetimeSeconds;
    this.sequence = 0;
    this.records = [];
    this.snapshot = Object.freeze([]);
  }

  push({ x, z, radius = 0.42, weight = 1, strength = 0.12, timeSeconds = 0, sourceInstance = 0, partId = "foot" } = {}) {
    for (const [label, value] of Object.entries({ x, z, radius, weight, strength, timeSeconds })) finite(value, label);
    if (radius <= 0) throw new RangeError("contact radius must be positive");
    if (weight < 0 || strength < 0) throw new RangeError("contact weight and strength must be nonnegative");
    if (!Number.isInteger(sourceInstance) || sourceInstance < 0) throw new RangeError("sourceInstance must be a nonnegative integer");
    const record = freezeEvent({
      sequence: ++this.sequence,
      x,
      z,
      position: Object.freeze({ x, z }),
      radius,
      weight,
      strength,
      timeSeconds,
      sourceInstance,
      partId: String(partId),
    });
    if (this.records.length === this.capacity) this.records.shift();
    this.records.push(record);
    return record;
  }

  active(timeSeconds) {
    finite(timeSeconds, "timeSeconds");
    const oldest = timeSeconds - this.lifetimeSeconds;
    while (this.records.length > 0 && this.records[0].timeSeconds < oldest) this.records.shift();
    this.snapshot = Object.freeze(this.records.map((record) => freezeEvent({
      ...record,
      weight: record.weight * Math.max(0, 1 - (timeSeconds - record.timeSeconds) / this.lifetimeSeconds),
    })));
    return this.snapshot;
  }

  clear() {
    this.records.length = 0;
    this.snapshot = Object.freeze([]);
  }

  describe() {
    return Object.freeze({
      capacity: this.capacity,
      activeCount: this.snapshot.length,
      sequence: this.sequence,
      lifetimeSeconds: this.lifetimeSeconds,
    });
  }
}

/** Calls both consumers with the exact same immutable snapshot identity. */
export function fanoutContactSnapshot(snapshot, vegetationConsumer, waterConsumer) {
  if (!Object.isFrozen(snapshot) || !Array.isArray(snapshot)) {
    throw new TypeError("contact fanout requires a frozen array snapshot");
  }
  if (typeof vegetationConsumer !== "function" || typeof waterConsumer !== "function") {
    throw new TypeError("contact fanout requires vegetation and water consumers");
  }
  vegetationConsumer(snapshot);
  waterConsumer(snapshot);
  return snapshot;
}

