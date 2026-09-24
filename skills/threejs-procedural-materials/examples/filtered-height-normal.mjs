import {
  faceDirection,
  float,
  max,
  min,
  mix,
  normalView,
  positionView,
  smoothstep,
} from "three/tsl";

// Literal values are admitted in the same f32 domain as shader constants.
// Dynamic nodes retain producer-owned range/finite validation.
function admitScalar(value, name, lower = -Infinity, upper = Infinity, strictLower = false) {
  if (value?.isNode === true) return;
  const rounded = typeof value === "number" ? Math.fround(value) : NaN;
  if (!Number.isFinite(rounded) || rounded < lower || rounded > upper ||
      (strictLower && rounded === lower)) {
    throw new RangeError(`${name} must be a finite f32 scalar in its admitted range`);
  }
}

// Call only from derivative-uniform fragment material construction. The caller
// supplies q=fSupport*sigmaMax(J), physical cycles/length, bandMean +/- the
// positive bandHalfRange, and heightHalfAmplitude in that length unit.
export function createFilteredHeightNormal({
  band,
  bandMean,
  bandHalfRange,
  heightHalfAmplitude,
  footprintCyclesPerSample,
  physicalSupportFrequency,
  slopeVarianceCalibration,
  qFade,
  roughness,
  varianceScale,
  prefix = "materialDetail",
  minRelativeDet = 1e-5,
}) {
  if (
    !Array.isArray(qFade) ||
    qFade.length !== 2 ||
    ![0, 1].every(i => Object.hasOwn(qFade, i) && Number.isFinite(qFade[i])) ||
    qFade[0] < 0 ||
    Math.fround(qFade[0]) >= Math.fround(qFade[1]) ||
    qFade[1] > 0.5
  ) {
    throw new RangeError("qFade must satisfy 0 <= qFade[0] < qFade[1] <= 0.5");
  }

  if (typeof prefix !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(prefix)) {
    throw new TypeError("prefix must be a letter-led shader identifier prefix");
  }
  if (typeof minRelativeDet !== "number") throw new TypeError("minRelativeDet must be a numeric constant");
  admitScalar(minRelativeDet, "minRelativeDet", 0, 1, true);
  admitScalar(band, "band");
  admitScalar(bandMean, "bandMean");
  admitScalar(bandHalfRange, "bandHalfRange", 0, Infinity, true);
  admitScalar(heightHalfAmplitude, "heightHalfAmplitude", 0);
  admitScalar(footprintCyclesPerSample, "footprintCyclesPerSample", 0);
  admitScalar(physicalSupportFrequency, "physicalSupportFrequency", 0);
  admitScalar(slopeVarianceCalibration, "slopeVarianceCalibration", 0);
  admitScalar(roughness, "roughness", 0, 1);
  admitScalar(varianceScale, "varianceScale", 0);

  const q = float(footprintCyclesPerSample)
    .toVar(`${prefix}Footprint`);
  const keep = smoothstep(qFade[0], qFade[1], q)
    .oneMinus()
    .toVar(`${prefix}Keep`);

  const filteredBand = mix(float(bandMean), band, keep)
    .toVar(`${prefix}FilteredBand`);
  const height = filteredBand
    .sub(float(bandMean))
    .mul(float(heightHalfAmplitude).div(float(bandHalfRange)))
    .toVar(`${prefix}Height`);

  const slopeAmplitude = float(physicalSupportFrequency)
    .mul(float(heightHalfAmplitude))
    .mul(2 * Math.PI);
  const removedSlopeVariance = slopeAmplitude.mul(slopeAmplitude)
    .mul(float(slopeVarianceCalibration).mul(0.5))
    .mul(keep.mul(keep).oneMinus())
    .toVar(`${prefix}RemovedSlopeVariance`);

  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const lengthX = dpdx.length().toVar(`${prefix}LengthX`);
  const lengthY = dpdy.length().toVar(`${prefix}LengthY`);
  const safeX = lengthX.greaterThan(0).select(lengthX, 1);
  const safeY = lengthY.greaterThan(0).select(lengthY, 1);
  const sigmaX = dpdx.div(safeX);
  const sigmaY = dpdy.div(safeY);
  const r1 = sigmaY.cross(normalView);
  const r2 = normalView.cross(sigmaX);
  const det = sigmaX.dot(r1).mul(faceDirection).toVar(`${prefix}RelativeDet`);
  // Rescale BOTH position and height derivatives to preserve physical slope.
  const surfaceGradient = det.sign().mul(
    height.dFdx().div(safeX).mul(r1).add(height.dFdy().div(safeY).mul(r2)),
  );
  const candidate = det.abs().mul(normalView).sub(surfaceGradient).toVar(`${prefix}Candidate`);
  const normalLength = candidate.length().toVar(`${prefix}NormalLength`);
  const normalValid = lengthX.greaterThan(0).and(lengthY.greaterThan(0))
    .and(det.abs().greaterThanEqual(minRelativeDet)).and(normalLength.greaterThan(0))
    .toVar(`${prefix}NormalValid`);
  // Define the denominator even if an eager select evaluates both operands.
  const safeLength = normalLength.greaterThan(0).select(normalLength, 1);
  const normalNode = normalValid.select(candidate.div(safeLength), normalView)
    .toVar(`${prefix}Normal`);

  const baseRoughness = float(roughness);
  const roughnessNode = min(
    float(1),
    max(
      baseRoughness,
      baseRoughness.mul(baseRoughness)
        .add(removedSlopeVariance.mul(float(varianceScale)))
        .sqrt(),
    ),
  ).toVar(`${prefix}Roughness`);

  return Object.freeze({
    normalNode,
    normalValid,
    roughnessNode,
    filteredBand,
    height,
    q,
    keep,
    removedSlopeVariance,
  });
}
