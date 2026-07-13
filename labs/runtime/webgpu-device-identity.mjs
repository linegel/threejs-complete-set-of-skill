/**
 * Exact retained GPUDevice identity for capture-lab-browser backendProven().
 * Call bindWebGPUDeviceIdentity(renderer) once after renderer.init() succeeds.
 */

export function bindWebGPUDeviceIdentity(renderer) {
  if (!renderer?.backend || renderer.backend.isWebGPUBackend !== true) {
    throw new Error('bindWebGPUDeviceIdentity requires an initialized native WebGPU backend');
  }
  const device = renderer.backend.device ?? null;
  if (!device) {
    throw new Error('Native WebGPU backend did not expose its initialized GPUDevice');
  }
  const identity = {
    device,
    rendererDeviceGeneration: 1,
    deviceLossGeneration: 0,
    rendererDeviceStatus: 'active',
    deviceLostObserved: false,
    lossPromiseObservedOnActualDevice: Boolean(device.lost?.then),
    deviceErrors: [],
  };
  if (identity.lossPromiseObservedOnActualDevice) {
    device.lost.then(() => {
      if (identity.rendererDeviceStatus === 'disposing' || identity.rendererDeviceStatus === 'disposed') return;
      identity.deviceLostObserved = true;
      identity.deviceLossGeneration += 1;
      identity.rendererDeviceStatus = 'lost';
    });
  }
  return identity;
}

export function markWebGPUDeviceDisposing(identity) {
  if (!identity) return;
  identity.rendererDeviceStatus = 'disposing';
}

export function markWebGPUDeviceDisposed(identity) {
  if (!identity) return;
  identity.rendererDeviceStatus = 'disposed';
}

/**
 * Capture profile fields required by assertCaptureRuntimeProfile().
 * Prefer window.__LAB_CAPTURE_PROFILE__.id when the browser host is under capture.
 */
export function resolveCaptureRuntimeProfile(explicit = null) {
  if (explicit === 'correctness' || explicit === 'performance') return explicit;
  const fromWindow = globalThis?.__LAB_CAPTURE_PROFILE__?.id;
  if (fromWindow === 'correctness' || fromWindow === 'performance') return fromWindow;
  return 'correctness';
}

export function captureRuntimeProfileFields(profile = null) {
  const runtimeProfile = resolveCaptureRuntimeProfile(profile);
  const performance = runtimeProfile === 'performance';
  return {
    runtimeProfile,
    performanceTimestampMode: performance ? 'auto' : 'disabled',
    timestampQueriesRequired: performance,
    timestampQueriesRequested: performance,
    // Correctness captures must keep timestamp queries inactive.
    timestampQueriesActive: false,
  };
}

/**
 * Metric fields required by scripts/capture-lab-browser.mjs backendProven().
 */
export function webgpuDeviceIdentityMetrics(identity, renderer, { runtimeProfile = null } = {}) {
  if (!identity) {
    throw new Error('webgpuDeviceIdentityMetrics requires a bound device identity');
  }
  const isWebGPU = renderer?.backend?.isWebGPUBackend === true;
  const deviceIdentityVerified = identity.device !== null
    && identity.device === renderer?.backend?.device;
  return {
    nativeWebGPU: isWebGPU,
    initialized: true,
    backend: isWebGPU ? 'WebGPU' : 'unsupported',
    backendKind: isWebGPU ? 'WebGPU' : 'unsupported',
    rendererBackend: isWebGPU ? 'WebGPUBackend' : 'unsupported',
    rendererDeviceStatus: identity.rendererDeviceStatus,
    rendererDeviceGeneration: identity.rendererDeviceGeneration,
    deviceLossGeneration: identity.deviceLossGeneration,
    deviceLostObserved: identity.deviceLostObserved,
    ...captureRuntimeProfileFields(runtimeProfile),
    rendererBackendEvidence: {
      backendKind: isWebGPU ? 'WebGPU' : 'unsupported',
      backendType: isWebGPU ? 'WebGPUBackend' : 'unsupported',
      isWebGPUBackend: isWebGPU,
      deviceIdentityVerified,
      deviceIdentitySource: 'exact retained renderer.backend.device reference after renderer.init()',
      deviceType: identity.device?.constructor?.name || 'GPUDevice',
      lossPromiseObservedOnActualDevice: identity.lossPromiseObservedOnActualDevice,
      rendererDeviceGeneration: identity.rendererDeviceGeneration,
    },
    rendererInfo: {
      rendererType: 'WebGPURenderer',
      backendType: isWebGPU ? 'WebGPUBackend' : 'unsupported',
      ...(renderer?.info ? { info: renderer.info } : {}),
    },
  };
}
