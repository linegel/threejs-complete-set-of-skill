function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

export function boundedHeightfieldDispersion({ c, dt, dx, dz, kx, kz } = {}) {
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
  const phaseX = kx * dx, phaseZ = kz * dz;
  const waveNumber = Math.hypot(kx, kz);
  const omegaContinuum = c * waveNumber;
  for (const [name, value] of Object.entries({ courantX, courantZ, cflSum, phaseX, phaseZ, waveNumber, omegaContinuum })) {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must remain finite`);
  }
  if (courantX <= 0 || courantZ <= 0 || cflSum <= 0 || (waveNumber > 0 && omegaContinuum <= 0)) {
    throw new RangeError("nonzero dispersion inputs must remain representable");
  }
  const dispersionRhs = courantX ** 2 * Math.sin(phaseX / 2) ** 2
    + courantZ ** 2 * Math.sin(phaseZ / 2) ** 2;
  if (!Number.isFinite(dispersionRhs)) throw new RangeError("dispersion RHS must remain finite");
  const omegaDiscrete = dispersionRhs <= 1
    ? 2 * Math.asin(Math.sqrt(dispersionRhs)) / dt
    : null;
  if (omegaDiscrete !== null && (!Number.isFinite(omegaDiscrete) || (waveNumber > 0 && dispersionRhs > 0 && omegaDiscrete === 0))) {
    throw new RangeError("discrete frequency must remain finite and representable");
  }
  const phaseSpeedContinuum = waveNumber > 0 ? c : null;
  const phaseSpeedDiscrete = waveNumber > 0 && omegaDiscrete !== null ? omegaDiscrete / waveNumber : null;
  const relativePhaseError = waveNumber > 0 && omegaDiscrete !== null ? (omegaDiscrete - omegaContinuum) / omegaContinuum : null;
  for (const value of [phaseSpeedDiscrete, relativePhaseError]) {
    if (value !== null && !Number.isFinite(value)) throw new RangeError("phase comparison must remain finite");
  }
  const represented = Math.abs(phaseX) <= Math.PI && Math.abs(phaseZ) <= Math.PI;
  // Equality has a repeated endpoint eigenvalue, not a positive stability margin.
  if (represented && waveNumber > 0 && dispersionRhs === 0) throw new RangeError("nonzero mode must remain representable");
  const stable = cflSum < 1 && dispersionRhs < 1;

  return {
    model: "undamped-symplectic-heightfield",
    gamma: 0,
    courantX,
    courantZ,
    cflSum,
    cflMargin: 1 - cflSum,
    dispersionRhs,
    dispersionMargin: 1 - dispersionRhs,
    stable,
    admissible: stable && represented && omegaDiscrete !== null,
    represented,
    waveNumber,
    omegaContinuum,
    omegaDiscrete,
    phaseSpeedContinuum,
    phaseSpeedDiscrete,
    relativePhaseError,
  };
}
