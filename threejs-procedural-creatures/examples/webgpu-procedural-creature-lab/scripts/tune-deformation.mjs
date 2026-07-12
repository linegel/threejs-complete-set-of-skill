#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDeformationPoseCorpus, evaluateCorrectedDeformationCandidate, evaluateDeformationCandidate } from '../src/core/deformation-sweep.js';
import { unpackReferenceAsset } from '../src/core/reference-asset-format.js';
import { compileSpec } from '../src/core/rig-compiler.js';
import { generateGeodesicSkinWeights } from '../src/core/skin-weights.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const validSpecies = new Set(['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer']);

function parsePositiveNumber(value, name) {
	const parsed = Number(value);
	if (!(Number.isFinite(parsed) && parsed > 0)) throw new Error(`${name} must be finite and > 0`);
	return parsed;
}

function parsePositiveInteger(value, name) {
	const parsed = parsePositiveNumber(value, name);
	if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
	return parsed;
}

function parseArgs(argv) {
	const values = {
		method: 'lbs',
		samples: 5,
		duration: 4,
		resolution: 24,
		maximumSilhouetteErrorPx: 1,
		stopAfter: 16,
		correctionTrials: 0,
		correctionTrustRadius: null,
	};
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (value === undefined) throw new Error(`missing value for '${flag}'`);
		if (flag === '--species') values.species = value;
		else if (flag === '--sigmas') values.sigmas = value.split(',').map((entry) => parsePositiveNumber(entry, 'sigma'));
		else if (flag === '--method') values.method = value;
		else if (flag === '--samples') values.samples = parsePositiveInteger(value, 'samples');
		else if (flag === '--duration') values.duration = parsePositiveNumber(value, 'duration');
		else if (flag === '--resolution') values.resolution = parsePositiveInteger(value, 'resolution');
		else if (flag === '--maximum-silhouette-error') values.maximumSilhouetteErrorPx = parsePositiveNumber(value, 'maximum silhouette error');
		else if (flag === '--stop-after') values.stopAfter = parsePositiveInteger(value, 'stop-after');
		else if (flag === '--correction-trials') values.correctionTrials = parsePositiveInteger(value, 'correction trials');
		else if (flag === '--correction-trust-radius') values.correctionTrustRadius = parsePositiveNumber(value, 'correction trust radius');
		else throw new Error(`unknown tuning option '${flag}'`);
	}
	if (!validSpecies.has(values.species)) throw new Error(`--species must be one of ${[...validSpecies].join(', ')}`);
	if (!values.sigmas?.length) throw new Error('--sigmas requires a comma-separated list');
	if (values.method !== 'lbs' && values.method !== 'dqs-log-scale') throw new Error("--method must be 'lbs' or 'dqs-log-scale'");
	return values;
}

async function loadInputs(species) {
	const [specText, manifestText, binary] = await Promise.all([
		readFile(resolve(root, 'src/lab/specs', `${species}.json`), 'utf8'),
		readFile(resolve(root, 'assets/reference', `${species}.surface.json`), 'utf8'),
		readFile(resolve(root, 'assets/reference', `${species}.surface.bin`)),
	]);
	const spec = JSON.parse(specText);
	const manifest = JSON.parse(manifestText);
	const arrays = unpackReferenceAsset(manifest, new Uint8Array(binary));
	return {
		spec,
		manifest,
		compiled: compileSpec(spec, { tier: 'hero', maxParts: 64, candidateK: 64 }),
		surface: { positions: arrays.positions, normals: arrays.normals, indices: arrays.indices },
	};
}

function summarize(candidate, sigma, skinning) {
	return {
		sigma,
		weightStatus: skinning.certification.status,
		status: candidate.status,
		failures: candidate.failures,
		totals: candidate.totals,
		worst: candidate.worst,
		worstPoses: candidate.poseRecords
			.filter((record) => record.topology.nonAdjacentSelfIntersections > 0
				|| record.surface.normalContinuity.p95AngleRadians > candidate.thresholds.maximumNormalAngleRadians
				|| record.silhouette.maximumP95ErrorPx > candidate.thresholds.maximumSilhouetteErrorPx)
			.map((record) => ({
				id: record.id,
				tick: record.tick,
				selfIntersections: record.topology.nonAdjacentSelfIntersections,
				selfIntersectionPairs: record.topology.selfIntersectionPairs?.slice(0, 8) ?? [],
				normalP95Radians: record.surface.normalContinuity.p95AngleRadians,
				silhouetteP95Px: record.silhouette.maximumP95ErrorPx,
			})),
	};
}

const options = parseArgs(process.argv.slice(2));
const inputs = await loadInputs(options.species);
const corpus = buildDeformationPoseCorpus(inputs.spec, inputs.compiled, {
	durationSeconds: options.duration,
	sampleCount: options.samples,
});
const results = [];
for (const sigma of options.sigmas) {
	const skinning = generateGeodesicSkinWeights(inputs.surface, inputs.compiled, { sigma });
	const evaluationOptions = {
		worldUnitsPerPixel: inputs.manifest.extraction.cellSize,
		maximumSilhouetteErrorPx: options.maximumSilhouetteErrorPx,
		silhouetteResolution: options.resolution,
		silhouetteRayStep: inputs.manifest.extraction.cellSize,
		checkSelfIntersections: true,
		stopAfterSelfIntersections: options.stopAfter,
		maximumCorrectionTrials: options.correctionTrials,
		...(options.correctionTrustRadius === null ? {} : { correctionTrustRadius: options.correctionTrustRadius }),
	};
	const rawCandidate = evaluateDeformationCandidate(options.method, inputs.surface, skinning, inputs.compiled, corpus, evaluationOptions);
	const candidate = options.correctionTrials > 0 && rawCandidate.status !== 'accepted-candidate'
		? evaluateCorrectedDeformationCandidate(options.method, rawCandidate, inputs.surface, skinning, inputs.compiled, corpus, evaluationOptions)
		: rawCandidate;
	results.push({
		...summarize(candidate, sigma, skinning),
		raw: options.correctionTrials > 0 ? summarize(rawCandidate, sigma, skinning) : null,
		correction: candidate.region ? {
			status: candidate.region.status,
			selectedVertices: candidate.region.selectedVertices,
			fraction: candidate.region.fraction,
			maximumFraction: candidate.region.maximumFraction,
			islands: candidate.region.islands,
		} : null,
	});
}
console.log(JSON.stringify({
	version: 'creature-deformation-tuner-v1',
	species: options.species,
	method: options.method,
	corpus: { sampleCount: corpus.sampleCount, durationSeconds: corpus.durationSeconds, resolution: options.resolution, correctionTrials: options.correctionTrials, correctionTrustRadius: options.correctionTrustRadius },
	results,
}, null, 2));
