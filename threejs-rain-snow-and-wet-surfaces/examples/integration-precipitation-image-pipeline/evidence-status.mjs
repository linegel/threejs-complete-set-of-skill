const operation = process.argv[2] ?? "capture";
console.error(JSON.stringify({
  verdict: "INSUFFICIENT_EVIDENCE",
  operation,
  lab: "integration-precipitation-image-pipeline",
  reason: "The host-owned precipitation integration has no native-WebGPU v2 evidence bundle yet.",
}));
process.exitCode = 2;
