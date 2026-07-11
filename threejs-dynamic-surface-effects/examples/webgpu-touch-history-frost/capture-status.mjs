const result = {
  lab: "webgpu-touch-history-frost",
  verdict: "INSUFFICIENT_EVIDENCE",
  reason: "No current-adapter browser capture was executed. Use the root labs:capture runner with native WebGPU access.",
  syntheticEvidenceCreated: false,
};

console.error(JSON.stringify(result));
process.exitCode = 2;
