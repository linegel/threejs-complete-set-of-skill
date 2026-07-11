export const CREATURE_MECHANISM_ROUTES = Object.freeze({
	'field-and-surface-certification': Object.freeze({ mode: 'distance', focus: 'biped', tier: 'hero', population: 1, seed: 1 }),
	'snap-and-ownership': Object.freeze({ mode: 'ownership', focus: 'quadruped', tier: 'hero', population: 1, seed: 1 }),
	'locomotion-and-foot-planting': Object.freeze({ mode: 'off', focus: 'biped', tier: 'hero', population: 1, seed: 1 }),
	'tails-ears-and-secondary-motion': Object.freeze({ mode: 'off', focus: 'quadruped', tier: 'hero', population: 1, seed: 1 }),
	'crowd-and-culling': Object.freeze({ mode: 'off', focus: 'biped', tier: 'crowd', population: 64, seed: 1 }),
	'outline-and-shadow': Object.freeze({ mode: 'normals', focus: 'quadruped', tier: 'hero', population: 1, seed: 1 }),
	'genome-variation': Object.freeze({ mode: 'off', focus: 'biped', tier: 'hero', population: 12, seed: 0x9e3779b9 }),
});

export const CREATURE_TIER_ROUTES = Object.freeze({
	hero: Object.freeze({ tier: 'hero', mode: 'off', focus: 'biped', population: 4, seed: 1 }),
	crowd: Object.freeze({ tier: 'crowd', mode: 'off', focus: 'quadruped', population: 64, seed: 1 }),
	background: Object.freeze({ tier: 'background', mode: 'off', focus: 'flyer', population: 96, seed: 1 }),
});

export const CREATURE_MODES = Object.freeze(['off', 'unsnapped', 'distance', 'normals', 'weights', 'ownership']);
export const CREATURE_TIERS = Object.freeze(['hero', 'crowd', 'background']);
export const CREATURE_FOCI = Object.freeze(['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer']);

export function distributeCreaturePopulation(totalInput, speciesCountInput, focusIndexInput = 0) {
	const speciesCount = Math.max(1, Math.floor(speciesCountInput));
	const total = Math.max(1, Math.floor(totalInput));
	if (total > speciesCount * 16) throw new Error(`creature population ${total} exceeds ${speciesCount} species pages of 16`);
	const focusIndex = ((Math.floor(focusIndexInput) % speciesCount) + speciesCount) % speciesCount;
	const counts = new Int32Array(speciesCount);
	for (let ordinal = 0; ordinal < total; ordinal++) counts[(focusIndex + ordinal) % speciesCount] += 1;
	return counts;
}

function requiredChoice(value, choices, label) {
	if (!choices.includes(value)) throw new Error(`unknown creature ${label} '${value}'`);
	return value;
}

export function resolveCreatureStartup({ scenario = null, tier = null } = {}) {
	if (scenario !== null && scenario !== undefined && scenario !== '') {
		const resolved = CREATURE_MECHANISM_ROUTES[scenario];
		if (!resolved) throw new Error(`unknown creature scenario '${scenario}'`);
		if (tier !== null && tier !== undefined && tier !== '' && tier !== resolved.tier) {
			throw new Error(`scenario '${scenario}' locks tier '${resolved.tier}', not '${tier}'`);
		}
		return Object.freeze({ scenario, ...resolved, locked: true });
	}
	if (tier !== null && tier !== undefined && tier !== '') {
		const resolved = CREATURE_TIER_ROUTES[tier];
		if (!resolved) throw new Error(`unknown creature tier route '${tier}'`);
		return Object.freeze({ scenario: null, ...resolved, locked: true });
	}
	return Object.freeze({ scenario: null, ...CREATURE_TIER_ROUTES.hero, locked: false });
}

export function validateCreatureMode(value) {
	return requiredChoice(value, CREATURE_MODES, 'mode');
}

export function validateCreatureTier(value) {
	return requiredChoice(value, CREATURE_TIERS, 'tier');
}

export function validateCreatureFocus(value) {
	return requiredChoice(value, CREATURE_FOCI, 'focus');
}

export function startupFromDataset(dataset = {}) {
	return resolveCreatureStartup({ scenario: dataset.labScenario ?? null, tier: dataset.labTier ?? null });
}
