import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	certifyCandidateCapacity,
	createFrozenCandidateCorpus,
} from '../../core/candidate-certification.js';
import { compileSpec } from '../../core/rig-compiler.js';
import { createCandidateStorage } from '../../tsl/pose-storage.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const specNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

async function loadSpec(name) {
	return JSON.parse(await readFile(resolve(root, 'src/lab/specs', `${name}.json`), 'utf8'));
}

async function runCandidateSetSweep() {
	const perSpec = [];
	for (const name of specNames) {
		const spec = await loadSpec(name);
		const result = certifyCandidateCapacity(spec, { tier: 'hero', maxParts: 64 });
		if (result.status !== 'accepted') {
			return { status: 'fail', details: { message: result.error, spec: name, attempts: result.attempts } };
		}
		const candidateSetsRespectTotalK = result.compiled.candidateSets.every((set, owner) => (
			set.length <= result.kRequired && set.includes(owner)
		));
		if (!candidateSetsRespectTotalK) {
			return {
				status: 'fail',
				details: { message: `compiled candidate sets exceed total K or omit owner for ${name}`, kRequired: result.kRequired },
			};
		}
		perSpec.push({
			spec: name,
			kInitial: result.kInitial,
			kRequired: result.kRequired,
			maxDelta: result.attempts.at(-1)?.maxDelta ?? null,
			maxNormalizedDelta: result.attempts.at(-1)?.maxNormalizedDelta ?? null,
			samples: result.attempts.at(-1)?.samples ?? 0,
			corpusVersion: result.corpusVersion,
			corpusDigest: result.corpusDigest,
			storageEntriesPerSlot: result.kRequired + 1,
		});
	}
	return { status: 'pass', details: { perSpec } };
}

// A star of twelve fat, heavily blended capsules radiating from one hub. The
// owner-only program is intentionally insufficient and must exercise raise-K.
function underConnectedFixture() {
	const parts = [{ id: 'hub', shape: 'sphere', offset: [0, 0.5, 0], r: 0.3, k: 0.25, color: '#888888' }];
	for (let i = 0; i < 12; i++) {
		const angle = (i / 12) * Math.PI * 2;
		const dir = [Math.cos(angle), 0.15 * ((i % 3) - 1), Math.sin(angle)];
		parts.push({
			id: `arm-${String(i).padStart(2, '0')}`,
			shape: 'capsule',
			a: [dir[0] * 0.1, 0.5 + dir[1] * 0.1, dir[2] * 0.1],
			b: [dir[0] * 0.55, 0.5 + dir[1] * 0.55, dir[2] * 0.55],
			r: 0.16,
			k: 0.22,
			color: '#888888',
		});
	}
	return {
		name: 'under-connected-star-fixture',
		seed: 99,
		locomotion: { type: 'hopper', hopHeight: 0.6, hopLength: 0.5 },
		parts,
	};
}

async function runRaiseKFixture() {
	const fixture = underConnectedFixture();
	const base = compileSpec(fixture, { tier: 'hero', maxParts: 64, candidateK: 1 });
	const corpus = createFrozenCandidateCorpus(fixture, base.slots.length);
	const raised = certifyCandidateCapacity(fixture, {
		tier: 'hero',
		maxParts: 64,
		initialK: 1,
		kCap: base.slots.length,
		corpus,
	});
	if (raised.status !== 'accepted' || !(raised.kRequired > raised.kInitial)) {
		return { status: 'fail', details: { message: 'fixture did not exercise raise-K', raised } };
	}
	if (!raised.attempts.every((attempt) => attempt.corpusDigest === corpus.digest)) {
		return { status: 'fail', details: { message: 'candidate corpus changed between K attempts', attempts: raised.attempts } };
	}

	const storage = createCandidateStorage({
		candidateSets: raised.compiled.candidateSets,
		maxParts: 64,
		K: raised.kRequired,
		label: 'RaiseKRuntimeBindingFixture',
	});
	if (storage.K !== raised.kRequired || storage.entriesPerSlot !== raised.kRequired + 1) {
		return {
			status: 'fail',
			details: {
				message: 'raise-K did not allocate the certified runtime storage capacity',
				certifiedK: raised.kRequired,
				storageK: storage.K,
				entriesPerSlot: storage.entriesPerSlot,
			},
		};
	}
	for (let owner = 0; owner < raised.compiled.slots.length; owner++) {
		const count = storage.array[owner * storage.entriesPerSlot];
		if (count !== raised.compiled.candidateSets[owner].length || count > raised.kRequired) {
			return { status: 'fail', details: { message: 'runtime storage truncated a certified contributor set', owner, count, certifiedK: raised.kRequired } };
		}
	}

	const rejected = certifyCandidateCapacity(fixture, {
		tier: 'hero',
		maxParts: 64,
		initialK: 1,
		kCap: 2,
		corpus,
	});
	if (rejected.status !== 'rejected' || !rejected.error.includes(fixture.name)) {
		return { status: 'fail', details: { message: 'raise-K cap did not reject with a named error', rejected } };
	}

	return {
		status: 'pass',
		details: {
			kSemantics: 'total contributor capacity including owner',
			kInitial: raised.kInitial,
			kRequired: raised.kRequired,
			corpusDigest: corpus.digest,
			runtimeStorageK: storage.K,
			entriesPerSlot: storage.entriesPerSlot,
			raiseAttempts: raised.attempts,
			rejectError: rejected.error,
		},
	};
}

export const gates = [
	{ id: 'candidate-set-sweep', run: runCandidateSetSweep },
	{ id: 'raise-k-policy-fixture', run: runRaiseKFixture },
];
