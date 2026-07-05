import { createLCG } from './lcg.js';

const TWO_PI = Math.PI * 2;

function normalize2(x, z) {
	const d = Math.hypot(x, z);
	return d > 1e-12 ? [x / d, z / d] : [1, 0];
}

export function createAnalyticWater({ seed = 1 } = {}) {
	const rng = createLCG(seed);
	const phase = rng.nextFloat() * TWO_PI;
	const baseAngle = rng.nextFloat() * TWO_PI;
	const waves = [
		{ amplitude: 0.06, wavelength: 3.1, speed: 0.9, angle: baseAngle + 0.0, phase },
		{ amplitude: 0.04, wavelength: 1.7, speed: 1.3, angle: baseAngle + 2.4, phase: phase + 1.7 },
		{ amplitude: 0.025, wavelength: 0.9, speed: 1.8, angle: baseAngle + 4.8, phase: phase + 3.1 },
	].map((wave) => ({
		...wave,
		direction: normalize2(Math.cos(wave.angle), Math.sin(wave.angle)),
		k: TWO_PI / wave.wavelength,
	}));

	// Derived: max height is 0.125 and max slope is about 0.25, a calm analytic
	// surface small enough for the 0.09 buoyancy-coupling gate to be meaningful.
	return function waterHeight(x, z, t) {
		let h = 0;
		for (const wave of waves) {
			const along = x * wave.direction[0] + z * wave.direction[1];
			h += wave.amplitude * Math.sin(wave.k * (along - wave.speed * t) + wave.phase);
		}
		return h;
	};
}

export function createWaterProviderAdapter(providerFn) {
	if (typeof providerFn !== 'function') {
		throw new Error('water provider must be a function (x, z, t) => number');
	}
	return (x, z, t) => {
		const value = providerFn(x, z, t);
		if (!Number.isFinite(value)) {
			throw new Error('water provider returned a non-finite height');
		}
		return value;
	};
}

export const getWaterHeight = createAnalyticWater({ seed: 1 });
