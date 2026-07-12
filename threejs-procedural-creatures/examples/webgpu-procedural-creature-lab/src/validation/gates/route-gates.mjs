import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	CREATURE_MECHANISM_ROUTES,
	CREATURE_TIER_ROUTES,
	resolveCreatureStartup,
	startupFromRouteInput,
	validateCreatureFocus,
	validateCreatureMode,
	validateCreatureTier,
} from '../../lab/route-config.js';

const here = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(here, '../../..');

async function runRoutesResolve() {
	const checked = [];
	for (const [id, expected] of Object.entries(CREATURE_MECHANISM_ROUTES)) {
		const resolved = resolveCreatureStartup({ scenario: id });
		if (resolved.scenario !== id || resolved.tier !== expected.tier || resolved.mode !== expected.mode || resolved.locked !== true) {
			return { status: 'fail', details: { message: `mechanism route '${id}' resolved to the wrong locked startup`, resolved, expected } };
		}
		const path = resolve(labRoot, 'mechanism', id, 'index.html');
		const html = await readFile(path, 'utf8');
		if (!html.includes(`data-lab-scenario="${id}"`) || !html.includes('src="../../src/lab/browser-app.js"')) {
			return { status: 'fail', details: { message: `mechanism route '${id}' does not load the canonical browser controller`, path } };
		}
		checked.push(`mechanism/${id}/`);
	}
	const crabPath = resolve(labRoot, 'mechanism', 'coastal-crab', 'index.html');
	const crabHtml = await readFile(crabPath, 'utf8');
	if (!crabHtml.includes('src="../../src/crab/crab-webgpu-app.js"') || !crabHtml.includes('INITIALIZING WEBGPU')) {
		return { status: 'fail', details: { message: 'coastal-crab route does not load its specialized native WebGPU controller', path: crabPath } };
	}
	checked.push('mechanism/coastal-crab/');
	for (const [id, expected] of Object.entries(CREATURE_TIER_ROUTES)) {
		const resolved = resolveCreatureStartup({ tier: id });
		if (resolved.tier !== expected.tier || resolved.locked !== true) {
			return { status: 'fail', details: { message: `tier route '${id}' resolved to the wrong locked tier`, resolved, expected } };
		}
		const path = resolve(labRoot, 'tier', id, 'index.html');
		const html = await readFile(path, 'utf8');
		if (!html.includes(`data-lab-tier="${id}"`) || !html.includes('src="../../src/lab/browser-app.js"')) {
			return { status: 'fail', details: { message: `tier route '${id}' does not load the canonical browser controller`, path } };
		}
		checked.push(`tier/${id}/`);
	}
	const queryMechanism = startupFromRouteInput({ search: '?mechanism=crowd-and-culling' });
	if (queryMechanism.scenario !== 'crowd-and-culling' || queryMechanism.population !== 64) {
		return { status: 'fail', details: { message: 'generated mechanism query did not select its complete startup preset', queryMechanism } };
	}
	const queryTier = startupFromRouteInput({ search: '?tier=background' });
	if (queryTier.tier !== 'background' || queryTier.focus !== 'flyer' || queryTier.population !== 96) {
		return { status: 'fail', details: { message: 'generated tier query did not select its complete startup preset', queryTier } };
	}
	return { status: 'pass', details: { routes: checked.length, checked } };
}

function mustThrow(label, callback) {
	try {
		callback();
	} catch (error) {
		if (!String(error?.message ?? error).includes('unknown') && !String(error?.message ?? error).includes('locks')) {
			throw new Error(`${label} threw an unstable reason: ${error?.message ?? error}`);
		}
		return error.message;
	}
	throw new Error(`${label} silently fell back instead of throwing`);
}

async function runRoutesRejectUnknown() {
	const reasons = {
		scenario: mustThrow('unknown scenario', () => resolveCreatureStartup({ scenario: 'not-a-creature-mechanism' })),
		tierRoute: mustThrow('unknown tier route', () => resolveCreatureStartup({ tier: 'potato' })),
		lockedTier: mustThrow('scenario tier mismatch', () => resolveCreatureStartup({ scenario: 'snap-and-ownership', tier: 'background' })),
		queryConflict: mustThrow('query and dataset conflict', () => startupFromRouteInput({
			dataset: { labTier: 'hero' },
			search: '?tier=background',
		})),
		mode: mustThrow('unknown mode', () => validateCreatureMode('beauty-ish')),
		tier: mustThrow('unknown tier', () => validateCreatureTier('auto')),
		focus: mustThrow('unknown focus', () => validateCreatureFocus('generic-creature')),
	};
	return { status: 'pass', details: { reasons } };
}

export const gates = [
	{ id: 'routes-resolve', run: runRoutesResolve },
	{ id: 'routes-reject-unknown', run: runRoutesRejectUnknown },
];
