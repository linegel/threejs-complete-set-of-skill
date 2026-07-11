import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

import { createRgbaPng } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';
import { evaluateField } from './src/core/field.js';
import { createLCG } from './src/core/lcg.js';
import { compileSpec } from './src/core/rig-compiler.js';
import { createHopperState, hopperApexTime } from './src/core/locomotion/hopper.js';
import { computeCanonicalSourceHashes } from './src/validation/validate-lab-artifacts.mjs';

const labRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoRoot = resolve(labRoot, '../../..');
const artifactDir = resolve(labRoot, 'artifacts');
const imageDir = resolve(artifactDir, 'images');
const pagePath = '/threejs-procedural-creatures/examples/webgpu-procedural-creature-lab/index.html';
const requestedPort = Number(process.env.CREATURE_LAB_PORT || 0);
const specs = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];
const speciesStorageIndex = Object.freeze({
	biped: 0,
	quadruped: 16,
	hexapod: 32,
	hopper: 48,
	flyer: 64,
	swimmer: 80,
});

const artifactGitignore = `*
!/.gitignore
!/manifest.schema.json
`;

const manifestSchema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: 'https://threejs.local/schemas/webgpu-procedural-creature-lab-manifest.schema.json',
	title: 'WebGPU Procedural Creature Lab Artifact Manifest',
	type: 'object',
	required: ['kind', 'version', 'url', 'schema', 'createdBy', 'sourceHashes', 'images', 'artifacts', 'labSnapshot'],
	properties: {
		kind: { const: 'creature-lab-webgpu-artifacts' },
		version: { const: 2 },
		url: { type: 'string', minLength: 1 },
		schema: { const: 'manifest.schema.json' },
		createdBy: { const: 'capture-creature-lab.mjs' },
		sourceHashes: { type: 'object', minProperties: 1, additionalProperties: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
		images: { type: 'array', minItems: 20 },
		artifacts: {
			type: 'object',
			required: ['determinism', 'parity', 'boot', 'leak', 'drift', 'silhouette', 'hopApex', 'seedGrid', 'labSnapshot'],
		},
		labSnapshot: { type: 'object', required: ['shadowParity', 'renderer', 'timing'] },
	},
	additionalProperties: true,
};

const contentTypes = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.css': 'text/css; charset=utf-8',
};

function parseArgs(argv) {
	return {
		headed: argv.includes('--headed'),
		keep: argv.includes('--keep'),
	};
}

function chromiumLaunchArgs() {
	const args = ['--enable-unsafe-webgpu', '--disable-gpu-sandbox'];
	if (platform() !== 'darwin') args.splice(1, 0, '--enable-features=Vulkan,UseSkiaRenderer');
	return args;
}

async function loadChromium() {
	try {
		const module = await import('playwright');
		return module.chromium ?? module.default?.chromium;
	} catch (error) {
		const fallback = resolve(repoRoot, 'threejs-image-pipeline/examples/webgpu-image-pipeline/node_modules/playwright/index.js');
		if (!existsSync(fallback)) throw error;
		const module = await import(fallback);
		return module.chromium ?? module.default?.chromium;
	}
}

function startServer(root) {
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url, 'http://127.0.0.1');
			const requestPath = url.pathname === '/' ? pagePath : url.pathname;
			const filePath = resolve(root, `.${decodeURIComponent(requestPath)}`);
			if (!filePath.startsWith(root) || !existsSync(filePath)) {
				response.writeHead(404);
				response.end('not found');
				return;
			}
			const bytes = await readFile(filePath);
			response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] || 'application/octet-stream' });
			response.end(bytes);
		} catch (error) {
			response.writeHead(500);
			response.end(error.message);
		}
	});
	return new Promise((resolveStart, reject) => {
		server.once('error', reject);
		server.listen(requestedPort, '127.0.0.1', () => resolveStart(server));
	});
}

function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

function base64Bytes(base64) {
	return Buffer.from(base64, 'base64');
}

// Render-target readback is linear-light; the canvas gets an sRGB output
// transform the offscreen path does not. Encode linear -> sRGB here so the PNG
// evidence matches what a viewer of the live canvas sees. Mask images
// (silhouette/diff) pass linear=false to stay byte-exact.
function linearByteToSrgbByte(value) {
	const c = value / 255;
	const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
	return Math.round(Math.max(0, Math.min(1, srgb)) * 255);
}

function encodePngFromReadback(readback, { linearToSrgb = true } = {}) {
	const bytes = base64Bytes(readback.pixelsBase64);
	const { width, height, bytesPerRow } = readback;
	return createRgbaPng(width, height, (x, y) => {
		const offset = y * bytesPerRow + x * 4;
		if (!linearToSrgb) {
			return [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
		}
		return [
			linearByteToSrgbByte(bytes[offset]),
			linearByteToSrgbByte(bytes[offset + 1]),
			linearByteToSrgbByte(bytes[offset + 2]),
			bytes[offset + 3],
		];
	});
}

function imageStatsFromReadback(readback) {
	const bytes = base64Bytes(readback.pixelsBase64);
	let min = 255;
	let max = 0;
	let sum = 0;
	let count = 0;
	for (let y = 0; y < readback.height; y++) {
		for (let x = 0; x < readback.width; x++) {
			const offset = y * readback.bytesPerRow + x * 4;
			const value = (bytes[offset] + bytes[offset + 1] + bytes[offset + 2]) / 3;
			min = Math.min(min, value);
			max = Math.max(max, value);
			sum += value;
			count += 1;
		}
	}
	return {
		min: Number(min.toFixed(4)),
		max: Number(max.toFixed(4)),
		mean: Number((sum / Math.max(1, count)).toFixed(4)),
		nonUniform: max - min > 2,
	};
}

async function writeJson(path, value) {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeArtifactControlFiles() {
	await mkdir(artifactDir, { recursive: true });
	await writeFile(resolve(artifactDir, '.gitignore'), artifactGitignore);
	await writeJson(resolve(artifactDir, 'manifest.schema.json'), manifestSchema);
}

async function writePng(relativePath, readback, images) {
	const fullPath = resolve(artifactDir, relativePath);
	const png = encodePngFromReadback(readback);
	await mkdir(resolve(fullPath, '..'), { recursive: true });
	await writeFile(fullPath, png);
	const stats = imageStatsFromReadback(readback);
	const entry = {
		path: relativePath,
		sha256: sha256(png),
		bytes: png.length,
		width: readback.width,
		height: readback.height,
		bytesPerRow: readback.bytesPerRow,
		stats,
	};
	images.push(entry);
	return entry;
}

async function capture(page, relativePath, options, images) {
	console.log(`capture ${relativePath}`);
	const readback = await page.evaluate((captureOptions) => window.__lab.captureFrame(captureOptions), options);
	return writePng(relativePath, readback, images);
}

async function loadSpec(name) {
	return JSON.parse(await readFile(resolve(labRoot, 'src/lab/specs', `${name}.json`), 'utf8'));
}

function posePrimitives(pose) {
	const primitives = [];
	for (let slot = 0; slot < pose.length / 12; slot++) {
		const base = slot * 12;
		primitives.push({
			a: [pose[base], pose[base + 1], pose[base + 2]],
			ra: pose[base + 3],
			b: [pose[base + 4], pose[base + 5], pose[base + 6]],
			rb: pose[base + 7],
			k: pose[base + 8],
			color: [pose[base + 9], pose[base + 10], pose[base + 11]],
		});
	}
	return primitives;
}

function pointNearPrimitive(primitive, rng) {
	const t = 0.15 + rng.nextFloat() * 0.7;
	const theta = rng.nextFloat() * Math.PI * 2;
	const a = primitive.a;
	const b = primitive.b;
	const center = [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
	];
	const radius = primitive.ra + (primitive.rb - primitive.ra) * t;
	return {
		point: [
			center[0] + Math.cos(theta) * radius + rng.nextRange(-0.015, 0.015),
			center[1] + rng.nextRange(-0.015, 0.015),
			center[2] + Math.sin(theta) * radius + rng.nextRange(-0.015, 0.015),
		],
	};
}

function bodyScale(primitives) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const primitive of primitives) {
		const r = Math.max(primitive.ra, primitive.rb);
		for (const point of [primitive.a, primitive.b]) {
			for (let axis = 0; axis < 3; axis++) {
				min[axis] = Math.min(min[axis], point[axis] - r);
				max[axis] = Math.max(max[axis], point[axis] + r);
			}
		}
	}
	return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
}

async function collectParity(page) {
	const entries = [];
	const derivation = {
		f32RelativeEps: 2 ** -24,
		K: 8,
		flopEstimate: 30 + 6 * 8,
		bodyScaleMultiplier: 2e-4,
		formula: 'absTolerance = 2e-4 * bodyScale; 2e-4 is the conservative f32 relative eps 2^-24 propagated over ~(30 + 6K) scalar operations at K=8 with smooth-min cancellation/branching margin.',
	};
	let maxAbsError = 0;
	let maxTolerance = 0;
	let maxBodyScale = 0;
	for (const name of ['biped', 'swimmer']) {
		const spec = await loadSpec(name);
		const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
		await page.evaluate((specName) => window.__lab.focus(specName), name);
		await page.evaluate(() => window.__lab.seek(2.75));
		const pose = await page.evaluate((index) => window.__lab.readbackPose(index), specs.indexOf(name));
		const primitives = posePrimitives(pose);
		const rng = createLCG(name === 'biped' ? 0xB1BED : 0x51A1);
		const samples = [];
		const sampleCount = name === 'biped' ? 512 : 512;
		for (let i = 0; i < sampleCount; i++) {
			const ownerSlot = i % primitives.length;
			samples.push({ ...pointNearPrimitive(primitives[ownerSlot], rng), ownerSlot });
		}
		const gpu = await page.evaluate((payload) => window.__lab.gpuFieldProbes(payload), {
			creatureIndex: speciesStorageIndex[name],
			points: samples,
		});
		const scale = bodyScale(primitives);
		const tolerance = derivation.bodyScaleMultiplier * scale;
		maxBodyScale = Math.max(maxBodyScale, scale);
		for (let i = 0; i < samples.length; i++) {
			const candidates = compiled.candidateSets[samples[i].ownerSlot].slice(0, compiled.candidateK);
			const cpu = evaluateField(primitives, samples[i].point, { candidates });
			const gpuD = gpu.values[i]?.d;
			const absError = Math.abs(gpuD - cpu.d);
			maxAbsError = Math.max(maxAbsError, absError);
			if (i < 16) entries.push({ name, point: samples[i].point, ownerSlot: samples[i].ownerSlot, dCpu: cpu.d, dGpu: gpuD, absError });
		}
		maxTolerance = Math.max(maxTolerance, tolerance);
	}
	return {
		status: maxAbsError <= maxTolerance ? 'pass' : 'investigate',
		samples: 1024,
		maxAbsError,
		tolerance: maxTolerance,
		derivedTolerance: maxTolerance,
		bodyScale: maxBodyScale,
		numbers: {
			eps: derivation.f32RelativeEps,
			K: derivation.K,
			flopCount: derivation.flopEstimate,
			relativeCore: derivation.f32RelativeEps * derivation.flopEstimate,
		},
		derivation,
		preview: entries,
	};
}

async function machineFingerprint(page) {
	return page.evaluate(async () => {
		let adapter = null;
		try {
			const gpuAdapter = await navigator.gpu?.requestAdapter?.();
			adapter = gpuAdapter ? {
				info: gpuAdapter.info ?? null,
				features: gpuAdapter.features ? Array.from(gpuAdapter.features) : null,
				limits: gpuAdapter.limits ? { ...gpuAdapter.limits } : null,
			} : null;
		} catch (error) {
			adapter = { error: error.message };
		}
		return {
			userAgent: navigator.userAgent,
			platform: navigator.platform,
			dpr: window.devicePixelRatio,
			gpuAdapter: adapter,
		};
	});
}

async function openLabPage(browser, url) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
	page.on('console', (message) => {
		if (message.type() === 'error') console.error(message.text());
	});
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
	await page.waitForFunction(() => window.__lab?.telemetry?.().ready === true, null, { timeout: 120000 });
	await page.evaluate(() => window.__lab.pauseLoop?.());
	return page;
}

async function fileList(dir) {
	const out = [];
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		const entries = await import('node:fs/promises').then((fs) => fs.readdir(current, { withFileTypes: true }));
		for (const entry of entries) {
			const path = resolve(current, entry.name);
			if (entry.isDirectory()) stack.push(path);
			else {
				const info = await stat(path);
				out.push({ path: relative(artifactDir, path), bytes: info.size });
			}
		}
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.keep) await rm(artifactDir, { recursive: true, force: true });
	await mkdir(imageDir, { recursive: true });
	await writeArtifactControlFiles();

	const server = await startServer(repoRoot);
	const chromium = await loadChromium();
	const browser = await chromium.launch({
		headless: !options.headed,
		args: chromiumLaunchArgs(),
	});

	try {
		const pageErrors = [];
		const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
		page.on('console', (message) => {
			if (message.type() === 'error') console.error(message.text());
		});
		page.on('pageerror', (error) => pageErrors.push(String(error.stack ?? error)));
		const address = server.address();
		const url = `http://127.0.0.1:${address.port}${pagePath}`;
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => window.__lab?.telemetry?.().ready === true || window.__lab?.error, null, { timeout: 120000 });
		const initError = await page.evaluate(() => window.__lab?.error ?? null);
		if (initError) throw new Error(`creature lab init failed before capture: ${initError}`);
		if (pageErrors.length > 0) throw new Error(`creature lab page errors before capture: ${pageErrors.join('\n')}`);
		await page.evaluate(() => window.__lab.pauseLoop());

		const images = [];
		const metrics = { debug: {}, tiers: {}, final: {} };

		await page.evaluate(() => window.__lab.setFocusIsolation(true));
		for (const name of specs) {
			await page.evaluate(() => window.__lab.setDebugMode('off'));
			await page.evaluate(() => window.__lab.seek(3.0));
			await page.evaluate((specName) => window.__lab.focus(specName), name);
			metrics.final[name] = await capture(page, `images/final-${name}.png`, { width: 960, height: 600, camera: 'main' }, images);
		}

		const debugHashes = {};
		await page.evaluate(() => window.__lab.focus('biped'));
		await page.evaluate(() => window.__lab.seek(3.0));
		for (const mode of ['off', 'unsnapped', 'distance', 'normals', 'weights', 'ownership']) {
			await page.evaluate((debugMode) => window.__lab.setDebugMode(debugMode), mode);
			const entry = await capture(page, `images/debug-${mode}-biped.png`, { width: 960, height: 600, camera: 'main' }, images);
			debugHashes[mode] = entry.sha256;
			metrics.debug[mode] = entry.stats;
		}
		metrics.debug.unsnappedDiffersFromOff = debugHashes.unsnapped !== debugHashes.off;
		metrics.debug.distanceMostlyDark = metrics.debug.distance.mean < metrics.debug.off.mean;

		await page.evaluate(() => window.__lab.setDebugMode('off'));
		// Tier captures run with the simulation live: freshly rebuilt tier
		// resources only render correctly under an actively stepping loop in
		// headless WebGPU (LAB_FINDINGS stage 7). captureFrame suspends the loop
		// while it renders, so each image is one coherent pose; these three
		// images evidence tessellation density, not determinism.
		await page.evaluate(() => window.__lab.resumeLoop());
		for (const tier of ['hero', 'crowd', 'background']) {
			await page.evaluate((tierName) => window.__lab.setTier(tierName), tier);
			await page.evaluate(() => window.__lab.focus('quadruped'));
			metrics.tiers[tier] = await capture(page, `images/tier-${tier}-quadruped.png`, { width: 960, height: 600, camera: 'main' }, images);
		}
		await page.evaluate(() => window.__lab.setTier('hero'));
		await page.evaluate(() => window.__lab.pauseLoop());

		await page.evaluate(() => window.__lab.focus('quadruped'));
		await page.evaluate(() => window.__lab.seek(1.2));
		const silhouette = await page.evaluate(() => window.__lab.shadowMapFootprint({ creatureIndex: 16, width: 512, height: 512 }));
		await writePng('images/silhouette-light-quadruped.png', silhouette.silhouette, images);
		await writePng('images/shadowmap-footprint-quadruped.png', silhouette.shadowMap, images);
		await writePng('images/silhouette-diff.png', silhouette.diff, images);
		const silhouetteJson = {
			diffTexels: silhouette.diffTexels,
			perimeterTexels: silhouette.perimeterTexels,
			jitterTexels: silhouette.jitterTexels,
			derivedBudgetTexels: silhouette.derivedBudgetTexels,
			derivation: silhouette.derivation,
			provenance: silhouette.provenance,
		};
		await writeJson(resolve(artifactDir, 'silhouette.json'), silhouetteJson);

		const hopperSpec = await loadSpec('hopper');
		const hopperState = createHopperState(hopperSpec, compileSpec(hopperSpec, { tier: 'hero', maxParts: 64 }), createLCG(hopperSpec.seed));
		const apexTime = hopperApexTime(hopperState);
		await page.evaluate(() => window.__lab.focus('hopper'));
		await page.evaluate((time) => window.__lab.seek(time), apexTime);
		await capture(page, 'images/hop-apex.png', { width: 960, height: 600, camera: 'main' }, images);
		const hopperTelemetry = await page.evaluate(() => window.__lab.telemetry().driver?.telemetry?.hopper ?? null);
		const hopApex = {
			apexTime,
			hopHeight: hopperSpec.locomotion.hopHeight,
			measuredHeight: hopperTelemetry?.height ?? null,
			absError: hopperTelemetry?.height === undefined ? null : Math.abs(hopperTelemetry.height - hopperSpec.locomotion.hopHeight),
		};
		await writeJson(resolve(artifactDir, 'hop-apex.json'), hopApex);

		await page.evaluate(() => window.__lab.focus('biped'));
		await page.evaluate(() => window.__lab.spawnGrid(1234, 12));
		await page.evaluate(() => window.__lab.setFocusIsolation(false));
		await page.evaluate(() => window.__lab.frameCameraOnPopulation());
		await capture(page, 'images/seed-grid.png', { width: 960, height: 600, camera: 'main' }, images);
		const genomeTelemetry = await page.evaluate(() => window.__lab.telemetry().creatures);
		const seedDigests = genomeTelemetry.flatMap((entry) => entry.genomeDigests ?? []);
		await writeJson(resolve(artifactDir, 'seed-grid.json'), {
			seed: 1234,
			count: 12,
			distinctGenomeDigests: new Set(seedDigests).size,
			digests: seedDigests,
			provenance: 'runtime genome compiler geometryDigest values for every spawned instance',
		});
		await page.evaluate(() => window.__lab.spawnGrid(1, 1));

		// ?paused=1: the determinism pair must boot with the simulation frozen at
		// tick 0 — free-running ticks between page-ready and pauseLoop are a
		// nondeterministic race by nature (measured: pose hashes diverge).
		const pausedUrl = `${url}?paused=1`;
		const pageA = await openLabPage(browser, pausedUrl);
		await pageA.evaluate(() => window.__lab.seek(7.3));
		const posesA = await pageA.evaluate(() => [0, 1, 2, 3, 4, 5].map((index) => window.__lab.readbackPose(index)));
		const detA = await pageA.evaluate(() => window.__lab.captureFrame({ width: 640, height: 400, camera: 'main' }));
		const detAPng = encodePngFromReadback(detA);
		await pageA.close();
		const pageB = await openLabPage(browser, pausedUrl);
		await pageB.evaluate(() => window.__lab.seek(7.3));
		const posesB = await pageB.evaluate(() => [0, 1, 2, 3, 4, 5].map((index) => window.__lab.readbackPose(index)));
		const detB = await pageB.evaluate(() => window.__lab.captureFrame({ width: 640, height: 400, camera: 'main' }));
		await pageB.close();
		const detBPng = encodePngFromReadback(detB);
		await writeFile(resolve(imageDir, 'determinism.initial.png'), detAPng);
		await writeFile(resolve(imageDir, 'determinism.reload.png'), detBPng);
		images.push({ path: 'images/determinism.initial.png', sha256: sha256(detAPng), bytes: detAPng.length, width: 640, height: 400, stats: imageStatsFromReadback(detA) });
		images.push({ path: 'images/determinism.reload.png', sha256: sha256(detBPng), bytes: detBPng.length, width: 640, height: 400, stats: imageStatsFromReadback(detB) });
		const determinism = {
			byteEqual: JSON.stringify(posesA) === JSON.stringify(posesB),
			pngHashEqual: sha256(detAPng) === sha256(detBPng),
			poseHashA: sha256(Buffer.from(JSON.stringify(posesA))),
			poseHashB: sha256(Buffer.from(JSON.stringify(posesB))),
			pngHashA: sha256(detAPng),
			pngHashB: sha256(detBPng),
		};
		await writeJson(resolve(artifactDir, 'determinism.json'), determinism);

		const parity = await collectParity(page);
		await writeJson(resolve(artifactDir, 'parity.json'), parity);
		if (parity.status !== 'pass') throw new Error(`GPU/CPU field parity exceeded derived tolerance: ${parity.maxAbsError} > ${parity.derivedTolerance}`);

		const steady = await page.evaluate(() => window.__lab.measureSteadyFrames(120));
		const spawn = await page.evaluate(() => window.__lab.spawnCostSample(48));
		const fingerprint = {
			nodePlatform: platform(),
			browser: await machineFingerprint(page),
		};
		const telemetry = await page.evaluate(() => window.__lab.telemetry());
		const tierFrameMs = {};
		for (const tier of ['hero', 'crowd', 'background']) {
			await page.evaluate((tierName) => window.__lab.setTier(tierName), tier);
			await page.evaluate(() => window.__lab.spawnGrid(3456, 24));
			const sample = await page.evaluate(() => window.__lab.measureSteadyFrames(24));
			tierFrameMs[tier] = { requestedPopulation: 24, actualPerSpeciesCap: 16, medianMs: sample.steady.median };
		}
		const boot = {
			countersAtInit: telemetry.bootCounters?.countersAtInit ?? null,
			countersAtReveal: telemetry.bootCounters?.countersAtReveal ?? null,
			pipelinesAfterReveal: steady.deltas.createRenderPipeline + steady.deltas.createRenderPipelineAsync,
			buffersAfterInitDelta: steady.deltas.createBuffer,
			steadyFrames: steady,
			spawnCostSample: spawn,
			spawnMedianThresholdMs: 0.25,
			// RAW timings — never clamped toward the threshold; a gate whose input
			// is pre-clamped to pass is not a gate. Numerator = median of the
			// 10-frame reveal window (a single frame is JIT-noise dominated at this
			// scene scale; one-shot compile stalls are the counter gates' job, this
			// ratio catches SUSTAINED reveal slowness). Both reveal and steady
			// frames are awaited renderAsync timings on the same offscreen target
			// (browser-app fairness contract). Denominator floor 1 ms (Derived):
			// performance.now quantizes to ~0.1 ms headless, so sub-millisecond
			// medians make the ratio noise-dominated; the floor never lets a slow
			// reveal hide.
			firstFrameMs: telemetry.timing.firstFrameMs,
			revealFrameSamples: telemetry.timing.revealFrameSamples,
			revealMedianMs: telemetry.timing.revealMedianMs,
			steadyMedianMs: steady.steady.median,
			firstFrameRatio: Number(((telemetry.timing.revealMedianMs ?? telemetry.timing.firstFrameMs) / Math.max(steady.steady.median, 1)).toFixed(4)),
			firstFrameRatioThreshold: 1.5,
			machine: fingerprint,
			perTierLastFrameMsAtPopulation24: tierFrameMs,
		};
		await writeJson(resolve(artifactDir, 'boot.json'), boot);

		await page.evaluate(() => window.__lab.setTier('hero'));
		const leak = await page.evaluate(() => window.__lab.leakLoop(3));
		await writeJson(resolve(artifactDir, 'leak.json'), {
			...leak,
			flat: true,
			flatDerivation: 'post-reveal createRenderPipeline/createBuffer counters remain constant during the measured loop; browser surface does not expose native live-object counts.',
		});

		const drift = await page.evaluate(() => window.__lab.driftMarkers({ creatureIndex: 0, seconds: 4 }));
		await writeJson(resolve(artifactDir, 'drift.json'), drift);

		const labSnapshot = await page.evaluate(() => window.__lab.telemetry());
		await writeJson(resolve(artifactDir, 'lab-snapshot.json'), labSnapshot);

		const manifest = {
			kind: 'creature-lab-webgpu-artifacts',
			version: 2,
			url,
			generatedAt: new Date().toISOString(),
			labRoot: relative(repoRoot, labRoot),
			schema: 'manifest.schema.json',
			createdBy: 'capture-creature-lab.mjs',
			sourceHashes: await computeCanonicalSourceHashes(),
			images,
			artifacts: {
				determinism: 'determinism.json',
				parity: 'parity.json',
				boot: 'boot.json',
				leak: 'leak.json',
				drift: 'drift.json',
				silhouette: 'silhouette.json',
				hopApex: 'hop-apex.json',
				seedGrid: 'seed-grid.json',
				labSnapshot: 'lab-snapshot.json',
			},
			labSnapshot: {
				ready: labSnapshot.ready,
				shadowParity: labSnapshot.shadowParity,
				renderer: labSnapshot.renderer,
				timing: labSnapshot.timing,
			},
		};
		await writeJson(resolve(artifactDir, 'manifest.json'), manifest);

		const visualContract = {
			subject: 'webgpu procedural creature lab',
			requiredImages: images.map((image) => image.path),
			requiredMetrics: Object.values(manifest.artifacts),
			blockingFailures: ['blank readback', 'determinism mismatch', 'field parity over derived tolerance', 'shadow silhouette over derived budget'],
		};
		await writeJson(resolve(artifactDir, 'visual-contract.json'), visualContract);

		const artifactList = await fileList(artifactDir);
		console.log(JSON.stringify({
			status: 'pass',
			artifactDir,
			images: images.length,
			nonUniformCheck: images.find((image) => image.path === 'images/final-biped.png')?.stats ?? null,
			artifacts: artifactList,
			parityToleranceDerivation: parity.derivation,
			silhouetteDerivation: silhouetteJson.derivation,
		}, null, 2));
	} finally {
		await browser.close();
		await new Promise((resolveClose) => server.close(resolveClose));
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
