#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSpec } from '../src/core/rig-compiler.js';
import { extractReferenceSurface } from '../src/core/reference-surface.js';
import { finalizeReferenceAssetManifest, packReferenceAsset } from '../src/core/reference-asset-format.js';
import { generateGeodesicSkinWeights } from '../src/core/skin-weights.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const specsDir = resolve(root, 'src/lab/specs');
const outputDir = resolve(root, 'assets/reference');
const names = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

function parseArgs(argv) {
	for (const argument of argv) if (argument !== '--verify') throw new Error(`unknown reference-asset option '${argument}'`);
	return { verify: argv.includes('--verify') };
}

function radialFrames(surface, compiled, skinning) {
	const frames = new Float32Array((surface.positions.length / 3) * 6);
	for (let vertex = 0; vertex < surface.positions.length / 3; vertex++) {
		const slot = compiled.slots[skinning.ownerSlots[vertex]];
		frames.set(slot.radialX, vertex * 6);
		frames.set(slot.radialZ, vertex * 6 + 3);
	}
	return frames;
}

function compileArrays(surface, compiled, skinning) {
	return {
		skinIndices: skinning.skinIndices,
		skinWeights: skinning.skinWeights,
		semanticIndices: skinning.ownerParts,
		colorIndices: skinning.skinIndices.slice(),
		colorWeights: skinning.skinWeights.slice(),
		correctionMask: new Uint8Array(surface.positions.length / 3),
		restRadialFrames: radialFrames(surface, compiled, skinning),
	};
}

async function compileOne(name) {
	const spec = JSON.parse(await readFile(resolve(specsDir, `${name}.json`), 'utf8'));
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64, candidateK: 64 });
	const minimumRadius = Math.min(...compiled.slots.map((slot) => Math.min(slot.ra, slot.rb)));
	const cellSize = Math.min(0.03, minimumRadius);
	const surface = extractReferenceSurface(compiled, {
		cellSize,
		maxSamples: 10_000_000,
		checkSelfIntersections: true,
		checkBidirectionalDistance: true,
		fieldRayResolution: 18,
		maximumSurfaceDistance: cellSize * 0.5,
	});
	if (surface.certification.status === 'rejected') throw new Error(`${name} surface certification rejected: ${JSON.stringify(surface.certification)}`);
	const skinning = generateGeodesicSkinWeights(surface, compiled);
	if (skinning.certification.status !== 'accepted-weight-baseline') throw new Error(`${name} skin weights rejected: ${JSON.stringify(skinning.certification)}`);
	const packed = packReferenceAsset(surface, compileArrays(surface, compiled, skinning));
	const sha256 = createHash('sha256').update(packed.binary).digest('hex');
	const manifest = finalizeReferenceAssetManifest({
		...packed.manifest,
		name,
		specName: spec.name,
		skinning: skinning.certification,
		acceptanceStatus: 'provisional-reference-candidate',
		limitations: [
			'Deformation selection, correction-region selection, and direct near/design/far silhouette evidence remain open.',
			'Runtime promotion is forbidden while acceptanceStatus is provisional-reference-candidate.',
		],
	}, sha256);
	return { manifest, binary: packed.binary };
}

async function verifyFile(path, expected) {
	const actual = new Uint8Array(await readFile(path));
	if (actual.byteLength !== expected.byteLength || actual.some((byte, index) => byte !== expected[index])) throw new Error(`reference asset drift: ${path}`);
}

const options = parseArgs(process.argv.slice(2));
if (!options.verify) await mkdir(outputDir, { recursive: true });
const summary = [];
for (const name of names) {
	const { manifest, binary } = await compileOne(name);
	const json = `${JSON.stringify(manifest, null, 2)}\n`;
	const jsonPath = resolve(outputDir, `${name}.surface.json`);
	const binaryPath = resolve(outputDir, `${name}.surface.bin`);
	if (options.verify) {
		const actualManifest = await readFile(jsonPath, 'utf8');
		if (actualManifest !== json) throw new Error(`reference asset manifest drift: ${jsonPath}`);
		await verifyFile(binaryPath, binary);
	} else {
		await writeFile(jsonPath, json);
		await writeFile(binaryPath, binary);
	}
	summary.push({ name, vertices: manifest.certification.topology.vertexCount, triangles: manifest.certification.topology.triangleCount, bytes: binary.byteLength, sha256: manifest.binary.sha256 });
}
console.log(JSON.stringify({ mode: options.verify ? 'verify' : 'write', assets: summary }, null, 2));
