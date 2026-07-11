import {
  NORMAL_QUERY_EVALUATION_COUNTS,
  PLANET_FIELD_ALGORITHM,
  PLANET_PARITY_CHANNELS,
} from "./planet-field-constants.js";

export const CPU_PLANET_FIELD_ALGORITHM = PLANET_FIELD_ALGORITHM;
export const TSL_PLANET_FIELD_ALGORITHM = PLANET_FIELD_ALGORITHM;

export function createPlanetFieldCpuBuilder() {
  return {
    target: "CPU",
    algorithm: CPU_PLANET_FIELD_ALGORITHM,
    channels: PLANET_PARITY_CHANNELS,
    derivativeCandidateCost: NORMAL_QUERY_EVALUATION_COUNTS,
    derivativeCorrectness: "not-run-candidate-only",
  };
}

export function createPlanetFieldTslBuilder() {
  return {
    target: "TSL",
    algorithm: TSL_PLANET_FIELD_ALGORITHM,
    channels: PLANET_PARITY_CHANNELS,
    fn: "Fn(({ surfaceDirection, planetPreset }) => planetFields(surfaceDirection.normalize(), planetPreset))",
    derivativeCandidateCost: NORMAL_QUERY_EVALUATION_COUNTS,
    derivativeCorrectness: "not-run-candidate-only",
  };
}
