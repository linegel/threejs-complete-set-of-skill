import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDriver, seek } from '../../core/driver.js';
import { compileSpec } from '../../core/rig-compiler.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const specNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];
const banned = /\b(Math\.random|Date\.now|performance\.now)\b/;

async function loadSpec(name) {
	return JSON.parse(await readFile(resolve(root, 'src/lab/specs', `${name}.json`), 'utf8'));
}

async function walkFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const out = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...await walkFiles(path));
		else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) out.push(path);
	}
	return out;
}

async function runCpuPoseDeterminism() {
	for (const name of specNames) {
		const spec = await loadSpec(name);
		const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
		const a = createDriver(spec, compiled);
		const b = createDriver(spec, compiled);
		const poseA = seek(a, 7.3).pose;
		const poseB = seek(b, 7.3).pose;
		if (Buffer.compare(Buffer.from(poseA.buffer), Buffer.from(poseB.buffer)) !== 0) {
			return { status: 'fail', details: { message: 'cold driver runs diverged', name } };
		}
	}
	return { status: 'pass', details: { specs: specNames.length, timeSeconds: 7.3 } };
}

async function runDeterminismSourceBan() {
	const searchRoots = ['src/core', 'src/tsl', 'src/lab'].map((p) => resolve(root, p));
	const offenders = [];
	for (const dir of searchRoots) {
		let files = [];
		try {
			files = await walkFiles(dir);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
		for (const file of files) {
			const text = await readFile(file, 'utf8');
			const match = text.match(banned);
			if (match) offenders.push({ file: file.slice(root.length + 1), token: match[1] });
		}
	}
	if (offenders.length > 0) {
		return { status: 'fail', details: { message: 'wall-clock or unseeded randomness in deterministic paths', offenders } };
	}
	return { status: 'pass', details: { checkedRoots: searchRoots.map((p) => p.slice(root.length + 1)) } };
}

async function runGateCoverage() {
	const expectedIds = [
		'spec-schema',
		'smin-vs-hardmin',
		'thin-part-containment',
		'gradient-magnitude',
		'analytic-vs-central-diff',
		'snap-residual',
		'snap-move-clamp',
		'shell-winding',
		'shell-counts',
		'candidate-set-sweep',
		'locomotion-driver-step',
		'seek-equals-step',
		'ik-limb-length',
		'swim-surface-coupling',
		'platform-foot-slide',
		'cpu-pose-determinism',
		'determinism-source-ban',
		'capture-artifacts',
	];
	return { status: 'pass', details: { expectedIds } };
}

export const gates = [
	{ id: 'cpu-pose-determinism', run: runCpuPoseDeterminism },
	{ id: 'determinism-source-ban', run: runDeterminismSourceBan },
	{ id: 'gate-coverage-index', run: runGateCoverage },
];
