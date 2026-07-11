export {
  AUTHORED_WAVES,
  DEFAULT_WATER_PARAMETERS,
  MICRO_NORMAL_BANDS,
  CANONICAL_WATER_TIER_IDS,
  WATER_DEBUG_MODES,
  WATER_EXAMPLE_CLAIM_BOUNDARY,
  WATER_MECHANISM_PROFILES,
  WATER_MECHANISM_ROUTES,
  WATER_QUALITY_TIERS,
  WATER_CFL_LIMIT,
  boundedCausticQuantizationContract,
  boundedWaterPersistentBytes,
  analyticSurfaceHeightAt,
  beerLambertTransmission,
  exactDielectricFresnel,
  receiverAreaDeterminant,
  seededDropSequence,
  seededUnit,
  validateWaterConfig,
  validateFiniteWaterParameters,
  waterCourantNumber,
  waterGridUvForWorldCoordinate,
  waterGridWorldCoordinateForUv,
  waterStorageBytes,
} from "./constants.js";

export { equalDurationSchedules, replayBoundedWaterFixedSteps } from "./fixed-step-oracle.js";

export {
  createBoundedWaterHeightQuery,
  estimateAnalyticParityError,
  estimateHeightfieldResidualBound,
  getParametricWaterHeight,
  getWaterHeight,
  sampleAnalyticSurfaceAtParameter,
  sampleAnalyticSurfaceAtWorldXZ,
} from "./cpu-water-height.js";

export {
  WebGPUBoundedWaterHeightfield,
  createBoundedWaterMaterial,
  createBoundedWaterMesh,
  createWebGPUBoundedWaterSystem,
} from "./webgpu-bounded-water.js";

export { BOUNDED_WATER_LAB_MANIFEST } from "./lab-manifest.js";
export { createBoundedWaterStage } from "./integration-stage.js";
export { depositReceiverCaustics, validateRefractedRaySample } from "./optical-oracles.js";
