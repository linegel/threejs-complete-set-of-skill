const result = {
  lab: "webgpu-rain-snow-and-wet-surfaces",
  verdict: "INSUFFICIENT_EVIDENCE",
  reason: "No current-adapter browser capture was executed. Use the root labs:capture runner with native WebGPU access.",
  syntheticEvidenceCreated: false,
};

console.error(JSON.stringify(result));
process.exitCode = 2;
