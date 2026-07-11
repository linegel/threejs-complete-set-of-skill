import assert from "node:assert/strict";
import test from "node:test";

import { resolveReadbackStride } from "../habitat-controller.js";

test("odd 641x359 WebGPU readback resolves the integer 256-byte aligned stride", () => {
  const width = 641;
  const height = 359;
  const rowBytes = width * 4;
  const alignedBytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const padded = new Uint8Array(alignedBytesPerRow * (height - 1) + rowBytes);
  assert.equal(resolveReadbackStride(padded, width, height), 2816);
});

test("fractional inferred row stride is rejected", () => {
  const width = 641;
  const height = 359;
  const rowBytes = width * 4;
  const malformed = new Uint8Array(rowBytes * height + 1);
  assert.throws(() => resolveReadbackStride(malformed, width, height), /invalid WebGPU readback stride/);
});

