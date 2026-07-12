import {
  CORPUS_CORRECTNESS_MAX_RETAINED_BYTES_PER_SUBJECT,
  compactCorpusCorrectnessRows,
} from "./correctness-evidence-client.js";
import {
  CORPUS_CAPTURE_BUILD_REVISION,
  CORPUS_CAPTURE_SOURCE_HASH,
  CORPUS_EXECUTABLE_SOURCE_CLOSURE_THREE_REVISION,
} from "./trusted-runtime-source-manifest.generated.js";

export const CORPUS_CORRECTNESS_DOCUMENT_PATH = "correctness-evidence.json";
export const CORPUS_CORRECTNESS_MAX_TAR_BYTES = 192 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function tarText(target, offset, length, value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > length) throw new RangeError(`TAR field exceeds ${length} bytes: ${value}`);
  target.set(bytes, offset);
}

function tarOctal(target, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("TAR numeric fields must be nonnegative safe integers");
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1) throw new RangeError("TAR numeric field overflowed");
  tarText(target, offset, length, `${encoded}\0`);
}

function safeTarPath(path) {
  if (typeof path !== "string" || !/^[a-z0-9][a-z0-9._/-]*$/.test(path) || path.includes("..") || new TextEncoder().encode(path).byteLength > 255) {
    throw new TypeError(`Unsafe TAR artifact path "${path}"`);
  }
  return path;
}

function splitUstarPath(path) {
  safeTarPath(path);
  const encoder = new TextEncoder();
  if (encoder.encode(path).byteLength <= 100) return Object.freeze({ prefix: "", name: path });
  const slashIndexes = [...path.matchAll(/\//g)].map(({ index }) => index).reverse();
  for (const index of slashIndexes) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (encoder.encode(prefix).byteLength <= 155 && encoder.encode(name).byteLength <= 100) return Object.freeze({ prefix, name });
  }
  throw new RangeError(`TAR path cannot be represented by ustar prefix/name fields: ${path}`);
}

function tarHeader(path, byteLength) {
  const { prefix, name } = splitUstarPath(path);
  const header = new Uint8Array(512);
  tarText(header, 0, 100, name);
  tarOctal(header, 100, 8, 0o644);
  tarOctal(header, 108, 8, 0);
  tarOctal(header, 116, 8, 0);
  tarOctal(header, 124, 12, byteLength);
  tarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  tarText(header, 257, 6, "ustar\0");
  tarText(header, 263, 2, "00");
  if (prefix) tarText(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  tarText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeCorpusCorrectnessDocumentDigest(documentRecord) {
  if (!documentRecord || typeof documentRecord !== "object" || Array.isArray(documentRecord)) {
    throw new TypeError("correctness segment document must be an object");
  }
  const { digest: _digest, digestAlgorithm: _digestAlgorithm, ...withoutDigest } = documentRecord;
  return sha256Hex(new TextEncoder().encode(`object-sculptor-correctness-subject-v1\n${canonicalJson(withoutDigest)}`));
}

function bytesView(value, label) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${label} must be Uint8Array`);
  return value;
}

export async function validateCorpusCorrectnessSegment(documentRecord, artifacts) {
  assert(documentRecord?.schemaVersion === 1 && documentRecord.labId === "webgpu-object-sculptor-corpus", "correctness segment document schema drifted");
  assert(documentRecord.profile === "correctness" && documentRecord.automationSurface === "codex-in-app-browser", "correctness segment browser surface drifted");
  assert(documentRecord.digestAlgorithm === "sha256" && /^[a-f0-9]{64}$/.test(documentRecord.digest), "correctness segment document digest declaration drifted");
  assert(await computeCorpusCorrectnessDocumentDigest(documentRecord) === documentRecord.digest, "correctness segment document digest does not bind its exact semantic record");
  assert(documentRecord.sourceHash === CORPUS_CAPTURE_SOURCE_HASH, "correctness segment source hash does not match the current generated source closure");
  assert(documentRecord.buildRevision === CORPUS_CAPTURE_BUILD_REVISION, "correctness segment build revision does not match the current generated source closure");
  assert(documentRecord.backend?.kind === "webgpu" && documentRecord.backend?.nativeWebGPU === true, "correctness segment is not native WebGPU");
  assert(documentRecord.backend?.threeRevision === CORPUS_EXECUTABLE_SOURCE_CLOSURE_THREE_REVISION, "correctness segment Three.js revision does not match the current generated source closure");
  assert(Array.isArray(documentRecord.captures) && documentRecord.captures.length === 21, "correctness segment must contain exactly 21 captures");
  assert(documentRecord.captures.filter(({ kind }) => kind === "presentation").length === 16, "correctness segment must contain 16 presentations");
  assert(documentRecord.captures.filter(({ kind }) => kind === "target-mask").length === 5, "correctness segment must contain 5 target masks");
  const artifactMap = artifacts instanceof Map
    ? artifacts
    : new Map((artifacts ?? []).map(({ path, bytes }) => [path, bytes]));
  assert(artifactMap.size === 42, "correctness segment must retain exactly 42 artifact files");
  const expected = new Map();
  for (const capture of documentRecord.captures) {
    assert(capture.state?.subjectId === documentRecord.subjectId, `${capture.filename} subject drifted from its segment`);
    assert(capture.width === 1200 && capture.height === 800 && capture.format === "rgba8unorm", `${capture.filename} dimensions/format drifted`);
    for (const representation of ["transport", "normalized"]) {
      const reference = capture[representation];
      safeTarPath(reference?.path);
      assert(Number.isSafeInteger(reference.byteLength) && reference.byteLength > 0 && /^[a-f0-9]{64}$/.test(reference.sha256), `${capture.filename} ${representation} reference drifted`);
      assert(!expected.has(reference.path), `duplicate correctness artifact reference ${reference.path}`);
      expected.set(reference.path, reference);
    }
  }
  assert(expected.size === 42 && artifactMap.size === expected.size, "correctness segment artifact/reference closure drifted");
  for (const capture of documentRecord.captures) {
    const transport = bytesView(artifactMap.get(capture.transport.path), capture.transport.path);
    const normalized = bytesView(artifactMap.get(capture.normalized.path), capture.normalized.path);
    assert(transport.byteLength === capture.transport.byteLength && await sha256Hex(transport) === capture.transport.sha256, `${capture.filename} transport bytes drifted`);
    assert(normalized.byteLength === capture.normalized.byteLength && await sha256Hex(normalized) === capture.normalized.sha256, `${capture.filename} normalized bytes drifted`);
    const compact = compactCorpusCorrectnessRows(normalized, capture.width, capture.height, capture.normalized.bytesPerRow);
    assert(compact.byteLength === capture.compact.byteLength && await sha256Hex(compact) === capture.compact.sha256, `${capture.filename} compact row derivation drifted`);
    for (let row = 0; row < capture.height; row += 1) {
      const transportOffset = row * capture.transport.bytesPerRow;
      const compactOffset = row * capture.compact.bytesPerRow;
      for (let byte = 0; byte < capture.compact.bytesPerRow; byte += 1) {
        if (transport[transportOffset + byte] !== compact[compactOffset + byte]) throw new Error(`${capture.filename} transport/compact row ${row} diverged`);
      }
    }
  }
  const retainedBytes = [...artifactMap.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
  assert(retainedBytes <= CORPUS_CORRECTNESS_MAX_RETAINED_BYTES_PER_SUBJECT, "correctness segment retained bytes exceed the subject bound");
  return Object.freeze({ ok: true, subjectId: documentRecord.subjectId, captures: 21, artifacts: 42, retainedBytes });
}

export async function buildCorpusCorrectnessTarBlob({ documentRecord, artifacts } = {}) {
  const artifactMap = new Map((artifacts ?? []).map(({ path, bytes }) => [path, bytes]));
  const validation = await validateCorpusCorrectnessSegment(documentRecord, artifactMap);
  const documentBytes = new TextEncoder().encode(`${JSON.stringify(documentRecord, null, 2)}\n`);
  const entries = [[CORPUS_CORRECTNESS_DOCUMENT_PATH, documentBytes], ...[...artifactMap.entries()].sort(([left], [right]) => left.localeCompare(right))];
  const built = buildBoundedTarBlob(entries, CORPUS_CORRECTNESS_MAX_TAR_BYTES);
  const filename = `object-sculptor-correctness-${documentRecord.subjectId}.tar`;
  return Object.freeze({
    ...built,
    filename,
    validation,
  });
}

export function buildBoundedTarBlob(entries, maxBytes = CORPUS_CORRECTNESS_MAX_TAR_BYTES) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("bounded TAR requires at least one entry");
  const parts = [];
  const seen = new Set();
  let byteLength = 1024;
  for (const [path, bytes] of entries) {
    safeTarPath(path);
    bytesView(bytes, path);
    if (seen.has(path)) throw new Error(`duplicate TAR path ${path}`);
    seen.add(path);
    parts.push(tarHeader(path, bytes.byteLength), bytes);
    const padding = (512 - (bytes.byteLength % 512)) % 512;
    if (padding > 0) parts.push(new Uint8Array(padding));
    byteLength += 512 + bytes.byteLength + padding;
  }
  if (byteLength > maxBytes) throw new RangeError("bounded TAR exceeds its byte limit");
  parts.push(new Uint8Array(1024));
  return Object.freeze({
    blob: new Blob(parts, { type: "application/x-tar" }),
    byteLength,
  });
}

function parseOctal(bytes, offset, length, label) {
  const text = new TextDecoder().decode(bytes.subarray(offset, offset + length)).replaceAll("\0", "").trim();
  if (!/^[0-7]+$/.test(text)) throw new Error(`${label} is not canonical octal`);
  return Number.parseInt(text, 8);
}

export function parseCorpusCorrectnessTar(value) {
  const bytes = bytesView(value, "correctness TAR");
  if (bytes.byteLength < 1024 || bytes.byteLength > CORPUS_CORRECTNESS_MAX_TAR_BYTES || bytes.byteLength % 512 !== 0) throw new RangeError("correctness TAR size/alignment is invalid");
  const entries = new Map();
  let offset = 0;
  while (true) {
    assert(offset + 1024 <= bytes.byteLength, "correctness TAR omits its canonical two-block terminator");
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      const secondTerminator = bytes.subarray(offset + 512, offset + 1024);
      assert(secondTerminator.every((byte) => byte === 0), "correctness TAR second terminator block is dirty");
      assert(offset + 1024 === bytes.byteLength, "correctness TAR has trailing bytes after its canonical terminator");
      break;
    }
    const name = new TextDecoder().decode(header.subarray(0, 100)).replaceAll("\0", "");
    const prefix = new TextDecoder().decode(header.subarray(345, 500)).replaceAll("\0", "");
    const path = prefix ? `${prefix}/${name}` : name;
    safeTarPath(path);
    const byteLength = parseOctal(header, 124, 12, `${path} length`);
    assert(Number.isSafeInteger(byteLength) && byteLength >= 0, `${path} TAR length is outside the safe integer domain`);
    const expectedChecksum = parseOctal(header, 148, 8, `${path} checksum`);
    const checksumHeader = new Uint8Array(header);
    checksumHeader.fill(0x20, 148, 156);
    assert(checksumHeader.reduce((sum, byte) => sum + byte, 0) === expectedChecksum, `${path} TAR checksum drifted`);
    const canonicalHeader = tarHeader(path, byteLength);
    assert(canonicalHeader.every((byte, index) => byte === header[index]), `${path} TAR header is not canonical ustar output`);
    const start = offset + 512;
    const end = start + byteLength;
    assert(end <= bytes.byteLength, `${path} TAR body is truncated`);
    assert(!entries.has(path), `duplicate TAR path ${path}`);
    entries.set(path, new Uint8Array(bytes.slice(start, end)));
    const paddedEnd = start + Math.ceil(byteLength / 512) * 512;
    assert(paddedEnd <= bytes.byteLength, `${path} TAR padding is truncated`);
    assert(bytes.subarray(end, paddedEnd).every((byte) => byte === 0), `${path} TAR body padding is nonzero`);
    offset = paddedEnd;
  }
  assert(entries.has(CORPUS_CORRECTNESS_DOCUMENT_PATH), "correctness TAR omits its evidence document");
  const documentBytes = entries.get(CORPUS_CORRECTNESS_DOCUMENT_PATH);
  const documentRecord = JSON.parse(new TextDecoder().decode(documentBytes));
  entries.delete(CORPUS_CORRECTNESS_DOCUMENT_PATH);
  return Object.freeze({ documentRecord, documentBytes, artifacts: entries });
}
