import assert from "node:assert/strict";
import test from "node:test";

import {
  createBandwidthRecord,
  createResourceRecord,
  geometryByteLength,
  reconcileResourceLedger,
  textureByteLength,
} from "../resource-ledger.mjs";

test("resident, transient, and bandwidth totals reconcile exactly", () => {
  const resources = [
    createResourceRecord({ id: "pose", owner: "creatures", bytes: 1024, source: "typed-array byteLength" }),
    createResourceRecord({ id: "readback", owner: "validation", bytes: 512, lifetime: "transient", label: "Measured", source: "mapped copy byteLength" }),
  ];
  const bandwidth = [
    createBandwidthRecord({ id: "pose-write", owner: "creatures", bytesPerFrame: 128, source: "dirty upload range" }),
  ];
  const ledger = reconcileResourceLedger({
    resources,
    bandwidth,
    declaredResidentBytes: 1024,
    declaredTransientBytes: 512,
    declaredBytesPerFrame: 128,
  });
  assert.equal(ledger.residentBytes, 1024);
  assert.equal(ledger.transientBytes, 512);
  assert.equal(ledger.bytesPerFrame, 128);
  assert.equal(ledger.reconciled, true);
});

test("declared totals, duplicate IDs, and unlabelled provenance mutations are blocking", () => {
  const resource = { id: "pose", owner: "creatures", bytes: 1024, source: "typed-array byteLength" };
  assert.throws(
    () => reconcileResourceLedger({ resources: [resource], declaredResidentBytes: 1023 }),
    /do not reconcile/,
  );
  assert.throws(
    () => reconcileResourceLedger({ resources: [resource, resource] }),
    /duplicate resource id/,
  );
  assert.throws(
    () => createResourceRecord({ ...resource, label: "Estimated" }),
    /label must be one of/,
  );
});

test("geometry and texture byte helpers derive exact allocation payloads", () => {
  const geometry = {
    index: { array: new Uint16Array(6) },
    attributes: {
      position: { array: new Float32Array(12) },
      normal: { array: new Float32Array(12) },
    },
  };
  assert.equal(geometryByteLength(geometry), 108);
  assert.equal(textureByteLength(641, 359, 8), 1_840_952);
});
