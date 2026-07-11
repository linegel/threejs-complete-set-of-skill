const operation = process.argv[2] ?? "capture";
console.error(JSON.stringify({
  verdict: "INSUFFICIENT_EVIDENCE",
  operation,
  lab: "integration-image-pipeline-ao",
  reason: "Native-WebGPU integration evidence has not been captured; no synthetic bundle was emitted.",
}));
process.exitCode = 2;
