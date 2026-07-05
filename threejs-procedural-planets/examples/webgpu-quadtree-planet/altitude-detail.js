import { NORMAL_QUERY_EVALUATION_COUNTS } from "./planet-field-constants.js";
import { planetFields } from "./planet-fields.js";

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export function altitudeDetailWeights({ altitude, radius }) {
  const near = Math.max(radius * 0.022, 6.5);
  const mid = Math.max(radius * 0.11, 24);
  const far = Math.max(radius * 0.5, 140);
  const nearWeight = 1 - smoothstep(near, mid, altitude);
  const farWeight = smoothstep(mid, far, altitude);
  const midWeight = clamp(1 - nearWeight - farWeight);
  return { near, mid, far, nearWeight, midWeight, farWeight };
}

export function heightGradient(direction, options = {}) {
  const fields = planetFields(direction, options);
  // Fused analytic gradient is preferred here because the height field is FBM-led:
  // each octave contributes value and derivative in one traversal, so a normal query
  // spends one full planetFields() call instead of 2 axes * 2 finite-difference calls.
  return {
    analyticGradient: fields.heightGradient,
    heightGradient: fields.heightGradient,
    height: fields.height,
    evaluationCount: NORMAL_QUERY_EVALUATION_COUNTS.fusedFullFieldEvaluations,
    previousEvaluationCount: NORMAL_QUERY_EVALUATION_COUNTS.previousFullFieldEvaluations,
  };
}
