console.error(JSON.stringify({
  verdict: "INSUFFICIENT_EVIDENCE",
  operation: process.argv[2] ?? "capture",
  lab: "webgpu-tower-ship-sculptor",
  reason: "Run the native browser capture before artifact validation; no synthetic evidence is emitted."
}));
process.exitCode = 2;
