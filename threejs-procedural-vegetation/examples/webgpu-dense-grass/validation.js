import {
  DenseGrassSystem,
  denseGrassQualityTiers,
  validateDenseGrassCapabilities,
  validateDenseGrassConfig,
  validateDenseGrassSystem,
} from "./dense-grass-system.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeFakeReducedRenderer() {
  return {
    initialized: true,
    backend: { isWebGPUBackend: false },
  };
}

function makeFakeNativeRenderer(counter) {
  return {
    initialized: true,
    backend: { isWebGPUBackend: true },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    computeAsync: async () => {
      counter.count += 1;
    },
  };
}

export async function validateDenseGrassContracts() {
  const highConfig = validateDenseGrassConfig({ tier: "high" });
  assert(highConfig.patchCount === 49, `high tier patchCount expected 49, got ${highConfig.patchCount}`);
  assert(highConfig.bladesPerPatch === 12000, `high tier bladesPerPatch expected 12000, got ${highConfig.bladesPerPatch}`);
  assert(highConfig.storageBytesPerBlade === 64, "storage byte estimate must stay at 64 bytes/blade");
  assert(highConfig.perFrameComputeDispatches === 0, "vertex-wind mode must use zero per-frame compute dispatches");

  const missingWebGPUCapabilities = validateDenseGrassCapabilities(makeFakeReducedRenderer(), { tier: "high" });
  assert(missingWebGPUCapabilities.nativeStorage === false, "fake missing-WebGPU renderer must not pass native storage");
  assert(missingWebGPUCapabilities.fallbackTeachingTier.cpuFilledStaticStorage === true, "explicit fallback teaching needs CPU-filled static storage contract");

  const nativeCounter = { count: 0 };
  const nativeCapabilities = validateDenseGrassCapabilities(makeFakeNativeRenderer(nativeCounter), { tier: "high" });
  assert(nativeCapabilities.nativeStorage === true, "fake native renderer should pass native storage");

  let rejectedImplicitFallback = false;
  try {
    await new DenseGrassSystem(makeFakeReducedRenderer(), { tier: "high" }).initialize();
  } catch (error) {
    rejectedImplicitFallback = error instanceof Error &&
      error.message.includes("explicitly asks how to apply fallback when WebGPU is unavailable");
  }
  assert(rejectedImplicitFallback, "fallback teaching for missing WebGPU must require explicit opt-in");

  const fallbackTeachingSystem = await new DenseGrassSystem(makeFakeReducedRenderer(), {
    tier: "high",
    explicitFallbackWhenWebGPUUnavailable: true,
  }).initialize();
  const before = validateDenseGrassSystem(fallbackTeachingSystem);
  fallbackTeachingSystem.setDebugMode("lod");
  const after = validateDenseGrassSystem(fallbackTeachingSystem);
  assert(after.diagnostics.debugMode === "lod", "diagnostics must reflect debug mode changes");
  assert(
    before.diagnostics.visibleDrawObjects <= before.diagnostics.visibleDrawObjectCeiling,
    "visible draw-object ceiling failed before debug toggle",
  );
  assert(
    after.diagnostics.visibleDrawObjects <= after.diagnostics.visibleDrawObjectCeiling,
    "visible draw-object ceiling failed after debug toggle",
  );
  fallbackTeachingSystem.dispose();

  const nativeSystem = await new DenseGrassSystem(makeFakeNativeRenderer(nativeCounter), { tier: "low" }).initialize();
  const expectedLowPatchCount = (denseGrassQualityTiers.low.patchGridRadius * 2 + 1) ** 2;
  assert(nativeCounter.count === expectedLowPatchCount, `native compute calls expected ${expectedLowPatchCount}, got ${nativeCounter.count}`);
  const native = validateDenseGrassSystem(nativeSystem);
  assert(native.diagnostics.initDispatches === native.diagnostics.patchCount, "native init dispatches must equal patch count");
  nativeSystem.dispose();

  return {
    pass: true,
    highConfig,
    capabilities: {
      missingWebGPU: missingWebGPUCapabilities,
      native: nativeCapabilities,
    },
    rejectedImplicitFallback,
    fallbackTeachingSystem: {
      patchCount: before.diagnostics.patchCount,
      visibleDrawObjects: before.diagnostics.visibleDrawObjects,
      activeBladeCount: before.diagnostics.activeBladeCount,
      fallbackTeachingActiveBladeCount: before.diagnostics.fallbackTeachingActiveBladeCount,
      debugAfterToggle: after.diagnostics.debugMode,
    },
    nativeSystem: {
      patchCount: native.diagnostics.patchCount,
      initDispatches: native.diagnostics.initDispatches,
      computeAsyncCalls: nativeCounter.count,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await validateDenseGrassContracts(), null, 2));
}
