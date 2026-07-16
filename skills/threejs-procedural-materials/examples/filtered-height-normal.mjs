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
}) {
  if (
    !Array.isArray(qFade) ||
    qFade.length !== 2 ||
    !qFade.every(Number.isFinite) ||
    qFade[0] < 0 ||
    qFade[0] >= qFade[1] ||
    qFade[1] > 0.5
  ) {
    throw new RangeError("qFade must satisfy 0 <= qFade[0] < qFade[1] <= 0.5");
  }

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
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1).mul(faceDirection);
  const surfaceGradient = det.sign().mul(
    height.dFdx().mul(r1).add(height.dFdy().mul(r2)),
  );
  const normalNode = det.abs().mul(normalView)
    .sub(surfaceGradient)
    .normalize()
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
    roughnessNode,
    filteredBand,
    height,
    q,
    keep,
    removedSlopeVariance,
  });
}
