export const NUMERIC_PROVENANCE_LABELS = Object.freeze([
  "Authored",
  "Derived",
  "Measured",
  "Gated",
]);

function requireNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

export function createResourceRecord({
  id,
  owner,
  bytes,
  lifetime = "resident",
  label = "Derived",
  source,
  kind = "buffer",
} = {}) {
  requireString(id, "resource id");
  requireString(owner, `resource ${id} owner`);
  requireString(source, `resource ${id} source`);
  requireString(kind, `resource ${id} kind`);
  requireNonnegativeInteger(bytes, `resource ${id} bytes`);
  if (lifetime !== "resident" && lifetime !== "transient") {
    throw new RangeError(`resource ${id} lifetime must be resident or transient`);
  }
  if (!NUMERIC_PROVENANCE_LABELS.includes(label)) {
    throw new RangeError(`resource ${id} label must be one of ${NUMERIC_PROVENANCE_LABELS.join(", ")}`);
  }
  return Object.freeze({ id, owner, kind, lifetime, bytes, label, source });
}

export function createBandwidthRecord({
  id,
  owner,
  bytesPerFrame,
  label = "Derived",
  source,
} = {}) {
  requireString(id, "bandwidth id");
  requireString(owner, `bandwidth ${id} owner`);
  requireString(source, `bandwidth ${id} source`);
  requireNonnegativeInteger(bytesPerFrame, `bandwidth ${id} bytesPerFrame`);
  if (!NUMERIC_PROVENANCE_LABELS.includes(label)) {
    throw new RangeError(`bandwidth ${id} label must be one of ${NUMERIC_PROVENANCE_LABELS.join(", ")}`);
  }
  return Object.freeze({ id, owner, bytesPerFrame, label, source });
}

function assertUniqueIds(records, label) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`duplicate ${label} id: ${record.id}`);
    seen.add(record.id);
  }
}

export function reconcileResourceLedger({
  resources = [],
  bandwidth = [],
  declaredResidentBytes = null,
  declaredTransientBytes = null,
  declaredBytesPerFrame = null,
} = {}) {
  if (!Array.isArray(resources) || !Array.isArray(bandwidth)) {
    throw new TypeError("resource and bandwidth ledgers must be arrays");
  }
  assertUniqueIds(resources, "resource");
  assertUniqueIds(bandwidth, "bandwidth");
  const normalizedResources = resources.map((record) => createResourceRecord(record));
  const normalizedBandwidth = bandwidth.map((record) => createBandwidthRecord(record));
  const residentBytes = normalizedResources
    .filter((record) => record.lifetime === "resident")
    .reduce((sum, record) => sum + record.bytes, 0);
  const transientBytes = normalizedResources
    .filter((record) => record.lifetime === "transient")
    .reduce((sum, record) => sum + record.bytes, 0);
  const bytesPerFrame = normalizedBandwidth.reduce((sum, record) => sum + record.bytesPerFrame, 0);

  for (const [name, declared, actual] of [
    ["resident", declaredResidentBytes, residentBytes],
    ["transient", declaredTransientBytes, transientBytes],
    ["bandwidth", declaredBytesPerFrame, bytesPerFrame],
  ]) {
    if (declared !== null) {
      requireNonnegativeInteger(declared, `declared ${name} bytes`);
      if (declared !== actual) {
        throw new Error(`declared ${name} bytes ${declared} do not reconcile with record sum ${actual}`);
      }
    }
  }

  return Object.freeze({
    scope: "tracked canonical resources; excludes opaque driver/compiler allocations",
    resources: Object.freeze(normalizedResources),
    bandwidth: Object.freeze(normalizedBandwidth),
    residentBytes,
    transientBytes,
    totalTrackedBytes: residentBytes + transientBytes,
    bytesPerFrame,
    reconciled: true,
  });
}

export function geometryByteLength(geometry) {
  if (!geometry) return 0;
  let bytes = geometry.index?.array?.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes ?? {})) {
    bytes += attribute.array?.byteLength ?? 0;
  }
  return requireNonnegativeInteger(bytes, "geometry byte length");
}

export function textureByteLength(width, height, bytesPerTexel, layers = 1) {
  for (const [value, label] of [
    [width, "texture width"],
    [height, "texture height"],
    [bytesPerTexel, "texture bytesPerTexel"],
    [layers, "texture layers"],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer`);
  }
  return requireNonnegativeInteger(width * height * bytesPerTexel * layers, "texture byte length");
}
