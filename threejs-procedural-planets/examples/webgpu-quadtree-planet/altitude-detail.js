import { NORMAL_QUERY_EVALUATION_COUNTS } from "./planet-field-constants.js";
import { planetFields } from "./planet-fields.js";

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const smoothstep = (edge0, edge1, value) => {
  if (!(edge1 > edge0)) throw new Error("smoothstep requires edge1 > edge0");
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// A band is rejected when its wavelength spans fewer than rejectSamples of the
// larger of the geometry and pixel footprints. It reaches full weight only at
// fullSamples. The constants are Authored reconstruction trials, not physical
// laws; target products must tune them from temporal aliasing and image-error
// sweeps. Unlike altitude thresholds, the decision scales with tessellation,
// projection, DPR, and resolution.
export function representedDetailWeight({
  wavelength,
  vertexSpacing,
  pixelFootprint,
  rejectSamples = 2,
  fullSamples = 4,
}) {
  for (const [name, value] of Object.entries({ wavelength, vertexSpacing, pixelFootprint })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be finite and positive`);
    }
  }
  if (!(fullSamples > rejectSamples && rejectSamples >= 2)) {
    throw new Error("require fullSamples > rejectSamples >= 2");
  }
  const limitingFootprint = Math.max(vertexSpacing, pixelFootprint);
  return smoothstep(
    rejectSamples * limitingFootprint,
    fullSamples * limitingFootprint,
    wavelength,
  );
}

export function detailRepresentationWeights({
  wavelengths,
  vertexSpacing,
  pixelFootprint,
  rejectSamples = 2,
  fullSamples = 4,
}) {
  const weight = (wavelength) => representedDetailWeight({
    wavelength,
    vertexSpacing,
    pixelFootprint,
    rejectSamples,
    fullSamples,
  });
  return {
    macroWeight: weight(wavelengths.macro),
    mesoWeight: weight(wavelengths.meso),
    microWeight: weight(wavelengths.micro),
    limitingFootprint: Math.max(vertexSpacing, pixelFootprint),
    evidenceClass: "Authored reconstruction trial",
  };
}

export function heightDerivativeCandidate(direction, options = {}) {
  const fields = planetFields(direction, options);
  // This is an operation-count fixture, not derivative-correctness evidence.
  // The candidate currently fails an independent finite-difference sweep and
  // is deliberately excluded from GPU parity channels and production normals.
  return {
    candidate: fields.heightDerivativeCandidate,
    height: fields.height,
    evaluationCount: NORMAL_QUERY_EVALUATION_COUNTS.fusedCandidateFullFieldEvaluations,
    previousEvaluationCount: NORMAL_QUERY_EVALUATION_COUNTS.previousFullFieldEvaluations,
    derivativeCorrectness: "not-run-candidate-only",
    evidenceStatus:
      "Derived full-field call count only; no derivative, normal-angle, GPU-time, or visual proof",
  };
}
