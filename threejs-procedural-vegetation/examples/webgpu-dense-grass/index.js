export {
  DEFAULT_BLADE_SEGMENTS,
  DEFAULT_BLADES_PER_PATCH,
  DEFAULT_PATCH_SIZE,
  DENSE_GRASS_HASH_CONTRACT,
  DenseGrassSystem,
  buildDenseGrassBladeSeedCPU,
  buildDenseGrassClumpSeedCPU,
  createDebugGroundPlane,
  createWebGPUDenseGrassSystem,
  denseGrassQualityTiers,
  denseGrassSpatialGridSlot,
  denseGrassSpatialPermutationStep,
  hashDenseGrassLaneCPU,
  hashDenseGrassUintCPU,
  loadMeadowDensityMask,
  meadowDensityMaskPaths,
  validateDenseGrassCapabilities,
  validateDenseGrassConfig,
  validateDenseGrassSystem,
  webgpuDenseGrassDebugModes,
} from "./dense-grass-system.js";

export { createDenseVegetationSceneAdapter } from "./integration-adapter.js";
