import { numericDatum } from './numeric-evidence.mjs';

export async function initializeCanonicalWebGPU(renderer, revision) {
  if (!renderer || typeof renderer.init !== 'function') {
    throw new TypeError('a WebGPURenderer-like object with init() is required');
  }

  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error(
      'Canonical lab requires the native WebGPU backend. Unsupported WebGPU is a blocker; no fallback was activated.',
    );
  }

  if (String(revision) !== '185') {
    throw new Error(`canonical labs require Three revision 185, received ${revision}`);
  }

  const limits = renderer.backend.device?.limits ?? null;
  return Object.freeze({
    revision: String(revision),
    renderer: renderer.constructor?.name ?? 'WebGPURenderer',
    initialized: true,
    isWebGPUBackend: true,
    compatibilityMode: renderer.backend.compatibilityMode === true,
    samples: numericDatum(
      Number.isFinite(renderer.samples) ? renderer.samples : 1,
      'samples-per-pixel',
      'Measured',
      'initialized renderer.samples',
    ),
    limits,
  });
}
