function position3(value) {
  const position = Array.from(value ?? []);
  if (position.length !== 3 || !position.every(Number.isFinite)) {
    throw new TypeError("position must contain three finite numbers");
  }
  return position;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function createTrailRing({
  capacity,
  entityId,
  generation,
  sampling,
}) {
  if (!Number.isInteger(capacity) || capacity < 2) {
    throw new RangeError("capacity must be an integer >= 2");
  }
  if (!Number.isInteger(entityId) || !Number.isInteger(generation)) {
    throw new TypeError("entityId and generation must be integers");
  }
  const unit = sampling?.mode === "time"
    ? sampling.seconds
    : sampling?.mode === "distance"
      ? sampling.meters
      : NaN;
  if (!(Number.isFinite(unit) && unit > 0)) {
    throw new RangeError("sampling must define positive seconds or meters");
  }
  return {
    capacity,
    entityId,
    generation,
    sampling: { mode: sampling.mode, unit },
    samples: Array(capacity),
    head: 0,
    count: 0,
    breakBeforeNext: true,
  };
}

export function resetTrailIdentity(ring, { entityId, generation }) {
  if (!Number.isInteger(entityId) || !Number.isInteger(generation)) {
    throw new TypeError("entityId and generation must be integers");
  }
  ring.entityId = entityId;
  ring.generation = generation;
  ring.head = 0;
  ring.count = 0;
  ring.breakBeforeNext = true;
  ring.samples.fill(undefined);
}

export function markTrailBreak(ring) {
  ring.breakBeforeNext = true;
}

export function trailSamples(ring) {
  return Array.from(
    { length: ring.count },
    (_, offset) => {
      const sample = ring.samples[(ring.head + offset) % ring.capacity];
      return { ...sample, position: [...sample.position] };
    },
  );
}

export function appendTrailSample(ring, {
  entityId,
  generation,
  timeSeconds,
  position,
  breakBefore = false,
}) {
  if (entityId !== ring.entityId || generation !== ring.generation) {
    throw new Error("trail identity changed without resetTrailIdentity()");
  }
  if (!Number.isFinite(timeSeconds)) {
    throw new TypeError("timeSeconds must be finite");
  }
  const point = position3(position);
  const previous = ring.count === 0
    ? undefined
    : ring.samples[(ring.head + ring.count - 1) % ring.capacity];
  const forceBreak = breakBefore || ring.breakBeforeNext || previous === undefined;
  if (previous && timeSeconds < previous.timeSeconds) {
    throw new RangeError("trail samples require nondecreasing authoritative time");
  }
  if (previous &&
      timeSeconds === previous.timeSeconds &&
      distance(point, previous.position) > 0 &&
      !forceBreak) {
    throw new RangeError(
      "equal-time displacement requires an explicit segment break",
    );
  }
  if (previous && !forceBreak) {
    const accepted = ring.sampling.mode === "time"
      ? timeSeconds - previous.timeSeconds >= ring.sampling.unit
      : distance(point, previous.position) >= ring.sampling.unit;
    if (!accepted) return false;
  }

  const sample = {
    entityId,
    generation,
    timeSeconds,
    position: point,
    breakBefore: forceBreak,
  };
  if (ring.count < ring.capacity) {
    ring.samples[(ring.head + ring.count) % ring.capacity] = sample;
    ring.count += 1;
  } else {
    ring.samples[ring.head] = sample;
    ring.head = (ring.head + 1) % ring.capacity;
    ring.samples[ring.head].breakBefore = true;
  }
  ring.breakBeforeNext = false;
  return true;
}

export function trailSegments(ring) {
  const samples = trailSamples(ring);
  const segments = [];
  for (let index = 1; index < samples.length; index += 1) {
    if (!samples[index].breakBefore &&
        distance(samples[index - 1].position, samples[index].position) > 0) {
      segments.push([samples[index - 1], samples[index]]);
    }
  }
  return segments;
}
