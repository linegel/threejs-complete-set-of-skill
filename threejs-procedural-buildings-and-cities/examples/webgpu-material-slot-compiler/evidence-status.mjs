const operation = process.argv[2] ?? "capture";
console.error(JSON.stringify({
  verdict: "INSUFFICIENT_EVIDENCE",
  operation,
  lab: "webgpu-material-slot-compiler",
  reason: "Native browser execution is unavailable in the current security profile; no synthetic artifact was emitted."
}));
process.exitCode = 2;
