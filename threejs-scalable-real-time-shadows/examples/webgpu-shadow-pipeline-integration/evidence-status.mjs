const operation = process.argv[2] ?? "capture";

console.error(JSON.stringify({
  verdict: "INSUFFICIENT_EVIDENCE",
  operation,
  lab: "webgpu-shadow-pipeline-integration",
  reason: "Current-adapter native-WebGPU render-target, timestamp, resource, and lifecycle evidence has not been captured.",
}));
process.exitCode = 2;
