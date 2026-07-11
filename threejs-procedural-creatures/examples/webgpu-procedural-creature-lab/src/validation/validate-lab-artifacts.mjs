import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(here, '../..');
export const defaultArtifactDir = resolve(labRoot, 'artifacts');

async function sourceFiles(path) {
	const entries = await readdir(path, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const child = resolve(path, entry.name);
		if (entry.isDirectory()) files.push(...await sourceFiles(child));
		else if (entry.isFile() && /\.(js|mjs|json|html)$/.test(entry.name)) files.push(child);
	}
	return files;
}

export async function computeCanonicalSourceHashes() {
	const files = [
		resolve(labRoot, 'index.html'),
		resolve(labRoot, 'package.json'),
		resolve(labRoot, 'lab.manifest.json'),
		resolve(labRoot, 'capture-creature-lab.mjs'),
		...await sourceFiles(resolve(labRoot, 'src')),
		...await sourceFiles(resolve(labRoot, 'mechanism')),
		...await sourceFiles(resolve(labRoot, 'tier')),
	].sort();
	const hashes = {};
	for (const file of files) {
		const bytes = await readFile(file);
		hashes[relative(labRoot, file)] = createHash('sha256').update(bytes).digest('hex');
	}
	return hashes;
}

const requiredImages = [
	...['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'].map((name) => `images/final-${name}.png`),
	...['off', 'unsnapped', 'distance', 'normals', 'weights', 'ownership'].map((mode) => `images/debug-${mode}-biped.png`),
	...['hero', 'crowd', 'background'].map((tier) => `images/tier-${tier}-quadruped.png`),
	'images/silhouette-light-quadruped.png',
	'images/shadowmap-footprint-quadruped.png',
	'images/silhouette-diff.png',
	'images/hop-apex.png',
	'images/seed-grid.png',
	'images/determinism.initial.png',
	'images/determinism.reload.png',
];

const requiredJson = [
	'boot.json',
	'determinism.json',
	'drift.json',
	'hop-apex.json',
	'leak.json',
	'parity.json',
	'seed-grid.json',
	'silhouette.json',
	'lab-snapshot.json',
	'manifest.json',
];

export async function readJson(base, relativePath, fallback = null) {
	try {
		return JSON.parse(await readFile(resolve(base, relativePath), 'utf8'));
	} catch {
		return fallback;
	}
}

function pass(name, details = {}) {
	return { name, status: 'pass', details };
}

function fail(name, details = {}) {
	return { name, status: 'fail', details };
}

function hasFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

function validateManifestShape(manifest) {
	if (!manifest || typeof manifest !== 'object') return fail('manifest.shape', { message: 'manifest is not an object' });
	if (manifest.kind !== 'creature-lab-webgpu-artifacts') return fail('manifest.kind', { kind: manifest.kind });
	if (manifest.version !== 2) return fail('manifest.version', { version: manifest.version });
	if (!Array.isArray(manifest.images)) return fail('manifest.images', { message: 'images must be an array' });
	if (!manifest.sourceHashes || typeof manifest.sourceHashes !== 'object') {
		return fail('manifest.sourceHashes', { message: 'capture predates canonical source-hash tracking and is stale' });
	}
	const imagePaths = new Set(manifest.images.map((image) => image.path));
	const missingImages = requiredImages.filter((path) => !imagePaths.has(path));
	if (missingImages.length > 0) return fail('manifest.requiredImages', { missingImages });
	for (const image of manifest.images) {
		if (typeof image.path !== 'string' || !hasFiniteNumber(image.bytes) || image.bytes <= 128 || typeof image.sha256 !== 'string') {
			return fail('manifest.imageRecord', { image });
		}
	}
	const artifactValues = new Set(Object.values(manifest.artifacts ?? {}));
	const missingJson = requiredJson.filter((path) => path !== 'manifest.json' && !artifactValues.has(path));
	if (missingJson.length > 0) return fail('manifest.requiredJson', { missingJson });
	const shadowParity = manifest.labSnapshot?.shadowParity;
	if (!Array.isArray(shadowParity) || shadowParity.some((entry) => entry.allEqual !== true)) {
		return fail('manifest.shadowParity', { shadowParity });
	}
	return pass('manifest.shape', { images: manifest.images.length, json: requiredJson.length });
}

export async function validateManifestArtifacts(artifactDirArg = defaultArtifactDir, options = {}) {
	const checkFiles = options.checkFiles !== false;
	const base = resolve(artifactDirArg);
	const reports = [];
	const manifest = await readJson(base, 'manifest.json');
	reports.push(manifest ? pass('manifest.exists', { path: resolve(base, 'manifest.json') }) : fail('manifest.exists', { path: resolve(base, 'manifest.json') }));
	if (!manifest) return summarize(reports, base, null);

	reports.push(validateManifestShape(manifest));
	const currentSourceHashes = await computeCanonicalSourceHashes();
	const staleSources = Object.entries(currentSourceHashes)
		.filter(([path, hash]) => manifest.sourceHashes?.[path] !== hash)
		.map(([path, hash]) => ({ path, expected: hash, captured: manifest.sourceHashes?.[path] ?? null }));
	reports.push(staleSources.length === 0
		? pass('manifest.source-hashes', { files: Object.keys(currentSourceHashes).length })
		: fail('manifest.source-hashes', { message: 'artifact bundle does not match current canonical sources', staleSources }));

	const schema = await readJson(base, 'manifest.schema.json');
	reports.push(schema ? pass('manifest.schema-json-valid', { path: resolve(base, 'manifest.schema.json') }) : fail('manifest.schema-json-valid', { path: resolve(base, 'manifest.schema.json') }));
	if (schema && schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
		reports.push(fail('manifest.schema-draft', { value: schema.$schema }));
	} else if (schema) {
		reports.push(pass('manifest.schema-draft', { value: schema.$schema }));
	}

	if (checkFiles) {
		for (const image of requiredImages) {
			const path = resolve(base, image);
			reports.push(existsSync(path) ? pass(`image:${image}`, { path: image }) : fail(`image:${image}`, { path: image }));
		}
		for (const json of requiredJson) {
			const path = resolve(base, json);
			reports.push(existsSync(path) ? pass(`json:${json}`, { path: json }) : fail(`json:${json}`, { path: json }));
		}
	}

	return summarize(reports, base, manifest);
}

export async function loadArtifacts(artifactDirArg = defaultArtifactDir) {
	const base = resolve(artifactDirArg);
	return {
		base,
		manifest: await readJson(base, 'manifest.json'),
		boot: await readJson(base, 'boot.json'),
		determinism: await readJson(base, 'determinism.json'),
		drift: await readJson(base, 'drift.json'),
		leak: await readJson(base, 'leak.json'),
		parity: await readJson(base, 'parity.json'),
		silhouette: await readJson(base, 'silhouette.json'),
		snapshot: await readJson(base, 'lab-snapshot.json'),
	};
}

export function parityDerivationIsValid(parity) {
	const eps = 2 ** -24;
	const candidateK = parity?.derivation?.K;
	const expectedFlops = 30 + 6 * candidateK;
	return Number.isInteger(candidateK)
		&& candidateK > 0
		&& parity.derivation.flopEstimate === expectedFlops
		&& Math.abs(parity.derivation.f32RelativeEps - eps) < 1e-18
		&& parity.derivation.bodyScaleMultiplier === 2e-4
		&& typeof parity.derivation.formula === 'string'
		&& parity.derivation.formula.includes('2e-4 * bodyScale')
		&& typeof parity.derivedTolerance === 'number';
}

function summarize(reports, base, manifest = null) {
	const failed = reports.filter((entry) => entry.status === 'fail');
	return {
		status: failed.length === 0 ? 'pass' : 'fail',
		summary: {
			total: reports.length,
			passed: reports.length - failed.length,
			failed: failed.length,
			path: base,
		},
		gates: reports,
		manifest,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const artifactArg = process.argv.includes('--artifact-dir')
		? process.argv[process.argv.indexOf('--artifact-dir') + 1]
		: defaultArtifactDir;
	const result = await validateManifestArtifacts(artifactArg);
	console.log(JSON.stringify(result, null, 2));
	if (result.status !== 'pass') process.exitCode = 1;
}
