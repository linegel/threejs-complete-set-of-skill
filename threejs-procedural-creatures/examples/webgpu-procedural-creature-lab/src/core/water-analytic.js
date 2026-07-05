const TWO_PI = Math.PI * 2;

const FALLBACK_WAVES = [
  { wavelength: 5.4, amplitude: 0.04, direction: [ 0.92, 0.28 ], phase: 0.0 },
  { wavelength: 3.2, amplitude: 0.025, direction: [ -0.48, 0.88 ], phase: 0.5 },
  { wavelength: 9.0, amplitude: 0.018, direction: [ 0.2, -1.0 ], phase: 0.25 }
];

function normalizeDirection(v) {
  const x = Number(v?.[0] ?? 1);
  const y = Number(v?.[1] ?? 0);
  const len = Math.hypot(x, y) || 1;
  return [ x / len, y / len ];
}

function analyticFallback(x, z, timeSeconds) {
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  let height = 0;
  for (const wave of FALLBACK_WAVES) {
    const direction = normalizeDirection(wave.direction);
    const k = TWO_PI / Math.max(0.2, Number(wave.wavelength));
    const omega = Math.sqrt(9.81 * k);
    const phase = k * (direction[0] * Number(x) + direction[1] * Number(z)) - omega * t + Number(wave.phase || 0);
    height += Number(wave.amplitude) * Math.sin(phase);
  }
  return height;
}

let _providerCache = null;

export async function getWaterHeightProvider() {
  if (_providerCache) return _providerCache;
  _providerCache = {
    getWaterHeight: analyticFallback,
    estimateHeightError: 0,
    source: 'analytic-fallback'
  };
  return _providerCache;
}

export function getWaterHeight(x, z, timeSeconds, options = {}) {
  return analyticFallback(x, z, timeSeconds, options);
}

export async function getWaterHeightAsync(x, z, timeSeconds, options = {}) {
  const provider = await getWaterHeightProvider();
  const fn = provider.getWaterHeight;
  return fn(Number(x), Number(z), Number.isFinite(timeSeconds) ? timeSeconds : 0, options);
}

export { analyticFallback as getWaterHeightFallback };
