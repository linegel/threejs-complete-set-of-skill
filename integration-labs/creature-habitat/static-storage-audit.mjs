function fnv1aByte(hash, byte) {
  return Math.imul(hash ^ byte, 0x01000193) >>> 0;
}

function typedArrayHash(hash, array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let value = hash;
  for (let index = 0; index < bytes.length; index += 1) value = fnv1aByte(value, bytes[index]);
  return value;
}

function storageArrays(system) {
  const arrays = [];
  for (const [patchIndex, patch] of (system?.patches ?? []).entries()) {
    for (const [name, node] of Object.entries(patch.storageSet ?? {})) {
      const array = node?.value?.array ?? node?.array ?? null;
      if (!ArrayBuffer.isView(array)) continue;
      arrays.push({ id: `patch-${patchIndex}/${name}`, array });
    }
  }
  return arrays.sort((a, b) => a.id.localeCompare(b.id));
}

export function captureStaticSpawnStorage(system) {
  const arrays = storageArrays(system);
  if (arrays.length === 0) throw new Error("vegetation system exposes no static spawn storage arrays");
  let hash = 0x811c9dc5;
  let bytes = 0;
  const entries = [];
  for (const { id, array } of arrays) {
    for (let index = 0; index < id.length; index += 1) hash = fnv1aByte(hash, id.charCodeAt(index) & 0xff);
    hash = typedArrayHash(hash, array);
    bytes += array.byteLength;
    entries.push(Object.freeze({ id, bytes: array.byteLength }));
  }
  return Object.freeze({
    algorithm: "fnv1a32-over-static-typed-array-bytes",
    hash: hash.toString(16).padStart(8, "0"),
    bytes,
    entries: Object.freeze(entries),
  });
}

export function assertStaticSpawnStorageImmutable(system, baseline) {
  if (!baseline || typeof baseline.hash !== "string") throw new TypeError("static spawn baseline is required");
  const current = captureStaticSpawnStorage(system);
  if (current.hash !== baseline.hash || current.bytes !== baseline.bytes) {
    throw new Error(`immutable vegetation spawn storage changed: ${baseline.hash}/${baseline.bytes} -> ${current.hash}/${current.bytes}`);
  }
  return current;
}

