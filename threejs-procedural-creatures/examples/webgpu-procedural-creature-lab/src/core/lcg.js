export const LCG_MODULUS = 0x100000000;
export const LCG_MULTIPLIER = 1664525;
export const LCG_INCREMENT = 1013904223;

function toUInt32(value) {
	return Number(value) >>> 0;
}

export function createLCG(seed = 1) {
	let state = toUInt32(seed);

	return {
		get state() {
			return state;
		},
		nextUInt32() {
			state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
			return state;
		},
		nextFloat() {
			return this.nextUInt32() / LCG_MODULUS;
		},
		nextRange(min, max) {
			return min + (max - min) * this.nextFloat();
		},
		clone() {
			return createLCG(state);
		},
	};
}

export function makeSeededRngFromString(seedString = '') {
	let hash = 2166136261 >>> 0;
	const text = String(seedString);
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return createLCG(hash);
}

export function seededRandom(rng, count = 1) {
	const values = [];
	for (let i = 0; i < count; i++) values.push(rng.nextFloat());
	return values;
}
