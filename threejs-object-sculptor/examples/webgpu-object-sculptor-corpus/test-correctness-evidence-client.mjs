import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  CORPUS_CORRECTNESS_EVIDENCE_KEY,
  CORPUS_CORRECTNESS_ERROR_KEY,
  CORPUS_CORRECTNESS_MAX_RETAINED_BYTES_PER_SUBJECT,
  CORPUS_CORRECTNESS_QUERY,
  CORPUS_CORRECTNESS_RESULT_KEY,
  compactCorpusCorrectnessRows,
  corpusCorrectnessEvidenceRequest,
  corpusCorrectnessEvidenceUrl,
  createCorpusCorrectnessEvidenceProducer,
} from "./correctness-evidence-client.js";
import { CORPUS_NATIVE_READBACK_PLAN } from "./capture-plan.js";
import {
  CORPUS_CORRECTNESS_DOCUMENT_PATH,
  buildBoundedTarBlob,
  parseCorpusCorrectnessTar,
} from "./correctness-evidence-bundle.js";
import { parseCorpusCorrectnessImportArguments } from "./import-correctness-evidence.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

assert.equal(CORPUS_CORRECTNESS_QUERY, "?capture=1&profile=correctness&automationSurface=codex-in-app-browser");
assert.deepEqual(corpusCorrectnessEvidenceRequest(CORPUS_CORRECTNESS_QUERY), { enabled: true, subjectId: null, autostart: false });
assert.deepEqual(corpusCorrectnessEvidenceRequest("?capture=1&profile=correctness&automationSurface=codex-in-app-browser&subjectSegment=ceramic-teapot&autostart=1"), { enabled: true, subjectId: "ceramic-teapot", autostart: true });
assert.equal(corpusCorrectnessEvidenceRequest("?capture=1&profile=correctness&automationSurface=playwright-headless-chromium").enabled, false);
assert.equal(corpusCorrectnessEvidenceRequest("?capture=1&profile=correctness&automationSurface=codex-in-app-browser&subjectSegment=unknown&autostart=1").enabled, false);
assert.match(corpusCorrectnessEvidenceUrl("potted-bonsai"), /subjectSegment=potted-bonsai&autostart=1$/);
assert.throws(() => corpusCorrectnessEvidenceUrl("unknown"), /unknown correctness subject/);
assert.equal(CORPUS_NATIVE_READBACK_PLAN.length, 63);
for (const subjectId of ["articulated-desk-lamp", "potted-bonsai", "ceramic-teapot"]) {
  const plan = CORPUS_NATIVE_READBACK_PLAN.filter(({ state }) => state.subjectId === subjectId);
  assert.equal(plan.length, 21);
  assert.equal(plan.filter(({ kind }) => kind === "presentation").length, 16);
  assert.equal(plan.filter(({ kind }) => kind === "target-mask").length, 5);
}
assert(CORPUS_CORRECTNESS_MAX_RETAINED_BYTES_PER_SUBJECT >= 160 * 1024 * 1024);
assert(CORPUS_CORRECTNESS_MAX_RETAINED_BYTES_PER_SUBJECT < 256 * 1024 * 1024);
assert.deepEqual(
  compactCorpusCorrectnessRows(Uint8Array.from([
    1, 2, 3, 4, 5, 6, 7, 8, ...new Array(248).fill(99),
    9, 10, 11, 12, 13, 14, 15, 16, ...new Array(248).fill(88),
  ]), 2, 2, 256),
  Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
);

const tinyDocument = new TextEncoder().encode('{"schemaVersion":1,"labId":"fixture"}\n');
const tinyArtifact = Uint8Array.of(1, 2, 3, 4);
const longArtifactPath = "correctness-readbacks/articulated-desk-lamp/transport/articulated-desk-lamp.final.full.design.rgba8unorm.bin";
const tinyTar = buildBoundedTarBlob([
  [CORPUS_CORRECTNESS_DOCUMENT_PATH, tinyDocument],
  [longArtifactPath, tinyArtifact],
], 4096);
assert.equal(tinyTar.byteLength, 3072);
const parsedTinyTar = parseCorpusCorrectnessTar(new Uint8Array(await tinyTar.blob.arrayBuffer()));
assert.deepEqual(parsedTinyTar.documentRecord, { schemaVersion: 1, labId: "fixture" });
assert.deepEqual(parsedTinyTar.artifacts.get(longArtifactPath), tinyArtifact);
assert.throws(() => buildBoundedTarBlob([
  [CORPUS_CORRECTNESS_DOCUMENT_PATH, tinyDocument],
  [CORPUS_CORRECTNESS_DOCUMENT_PATH, tinyDocument],
]), /duplicate TAR path/);
const corruptedTinyTar = new Uint8Array(await tinyTar.blob.arrayBuffer());
corruptedTinyTar[0] ^= 1;
assert.throws(() => parseCorpusCorrectnessTar(corruptedTinyTar), /checksum drifted/);
assert.deepEqual(parseCorpusCorrectnessImportArguments(["--prepare"]), {
  prepare: true,
  checkOnly: false,
  segments: [],
  outputDir: new URL("../../../artifacts/visual-validation/webgpu-object-sculptor-corpus/correctness-in-app-import", import.meta.url).pathname,
});
const importArgs = parseCorpusCorrectnessImportArguments([
  "--segment", "lamp.tar",
  "--segment", "bonsai.tar",
  "--segment", "teapot.tar",
  "--output", "evidence-output",
  "--check",
]);
assert.equal(importArgs.prepare, false);
assert.equal(importArgs.checkOnly, true);
assert.equal(importArgs.segments.length, 3);
assert.throws(() => parseCorpusCorrectnessImportArguments(["--segment", "one.tar"]), /exactly three/);
assert.throws(() => parseCorpusCorrectnessImportArguments(["--prepare", "--check"]), /cannot be combined/);
assert.throws(
  () => compactCorpusCorrectnessRows(new Uint8Array(8), 2, 1, 8),
  /preserve WebGPU alignment/,
);
assert.throws(
  () => createCorpusCorrectnessEvidenceProducer(),
  /requires the public corpus controller/,
);
assert.throws(
  () => createCorpusCorrectnessEvidenceProducer({ controller: { capturePixels() {} } }),
  /explicit corpus disposal ownership/,
);
assert.deepEqual(
  [CORPUS_CORRECTNESS_EVIDENCE_KEY, CORPUS_CORRECTNESS_RESULT_KEY, CORPUS_CORRECTNESS_ERROR_KEY],
  ["__CORPUS_CORRECTNESS_EVIDENCE__", "__CORPUS_CORRECTNESS_EVIDENCE_RESULT__", "__CORPUS_CORRECTNESS_EVIDENCE_ERROR__"],
);

console.log(JSON.stringify({
  ok: true,
  nativeReadbacks: CORPUS_NATIVE_READBACK_PLAN.length,
  perSubjectReadbacks: 21,
  retainedRepresentationsPerReadback: 2,
  subjectRetentionLimitBytes: CORPUS_CORRECTNESS_MAX_RETAINED_BYTES_PER_SUBJECT,
}, null, 2));
