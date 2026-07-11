import assert from "node:assert/strict";

import { normalizePixelCapture } from "../../../scripts/capture-lab-browser.mjs";
import { describeTowerShipReadback } from "./lab-controller.js";

const layout = describeTowerShipReadback(3, 2, "srgb");
const expected = Uint8Array.from({ length: 24 }, (_, index) => index + 1);
const pixels = new Uint8Array(layout.fullyPaddedByteLength);
pixels.set(expected.subarray(0, layout.rowBytes), 0);
pixels.set(expected.subarray(layout.rowBytes), layout.bytesPerRow);

const capture = {
  target: "presentation",
  ...layout,
  sourceBytesPerRow: layout.bytesPerRow,
  sourceByteLength: pixels.byteLength,
  origin: "bottom-left",
  pixels,
};
const normalized = normalizePixelCapture(capture);
assert.equal(normalized.sourceLayout, "padded");
assert.equal(normalized.bytesPerRow, layout.rowBytes, "normalized transport rows must be compact");
assert.equal(normalized.sourceBytesPerRow, layout.bytesPerRow, "GPU-copy stride must remain explicit");
assert.equal(normalized.sourceByteLength, layout.fullyPaddedByteLength);
assert.deepEqual([...normalized.data], [...expected]);

const aliasOnly = { ...capture, rowStride: layout.bytesPerRow };
delete aliasOnly.bytesPerRow;
delete aliasOnly.sourceBytesPerRow;
assert.throws(
  () => normalizePixelCapture(aliasOnly),
  /must report bytesPerRow or sourceBytesPerRow/,
  "a noncanonical rowStride alias must not satisfy the capture ABI",
);

const wrongStrideBytes = new Uint8Array((layout.bytesPerRow + 1) * layout.height);
const wrongStride = {
  ...capture,
  bytesPerRow: layout.bytesPerRow + 1,
  sourceBytesPerRow: layout.bytesPerRow + 1,
  sourceByteLength: wrongStrideBytes.byteLength,
  pixels: wrongStrideBytes,
};
assert.throws(() => normalizePixelCapture(wrongStride), /does not satisfy WebGPU copy alignment/);

console.log(JSON.stringify({ ok: true, rowBytes: layout.rowBytes, bytesPerRow: layout.bytesPerRow, sourceByteLength: layout.fullyPaddedByteLength }, null, 2));
