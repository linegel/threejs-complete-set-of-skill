function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

export function boundedHeightfieldDispersion({ c, dt, dx, dz, kx, kz }) {
  positiveFinite(c, "c");
  positiveFinite(dt, "dt");
  positiveFinite(dx, "dx");
  positiveFinite(dz, "dz");
  if (!Number.isFinite(kx) || !Number.isFinite(kz)) {
    throw new RangeError("kx and kz must be finite");
  }

  const courantX = c * dt / dx;
  const courantZ = c * dt / dz;
  const cflSum = courantX ** 2 + courantZ ** 2;
  const dispersionRhs =
    courantX ** 2 * Math.sin(kx * dx / 2) ** 2
    + courantZ ** 2 * Math.sin(kz * dz / 2) ** 2;
  const waveNumber = Math.hypot(kx, kz);
  const omegaContinuum = c * waveNumber;
  const omegaDiscrete = dispersionRhs <= 1
    ? 2 * Math.asin(Math.sqrt(dispersionRhs)) / dt
    : Number.NaN;
  const phaseSpeedContinuum = waveNumber > 0
    ? omegaContinuum / waveNumber
    : Number.NaN;
  const phaseSpeedDiscrete = waveNumber > 0
    ? omegaDiscrete / waveNumber
    : Number.NaN;
  const represented =
    Math.abs(kx * dx) <= Math.PI && Math.abs(kz * dz) <= Math.PI;

  return {
    model: "undamped-symplectic-heightfield",
    gamma: 0,
    courantX,
    courantZ,
    cflSum,
    cflMargin: 1 - cflSum,
    dispersionRhs,
    dispersionMargin: 1 - dispersionRhs,
    stable: cflSum <= 1 && dispersionRhs <= 1,
    represented,
    waveNumber,
    omegaContinuum,
    omegaDiscrete,
    phaseSpeedContinuum,
    phaseSpeedDiscrete,
    relativePhaseError: omegaContinuum > 0
      ? (omegaDiscrete - omegaContinuum) / omegaContinuum
      : Number.NaN,
  };
}
