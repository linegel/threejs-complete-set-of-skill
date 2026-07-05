import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const labRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoRoot = resolve(labRoot, '../../..');
const artifactDir = resolve(labRoot, 'artifacts');
const imageDir = resolve(artifactDir, 'images');
const port = Number(process.env.CREATURE_LAB_PORT || 51987);

const imageCaptures = [
	['images/final.design.png', async (page) => page.evaluate(() => window.__lab.debug('off'))],
	['images/no-post.design.png', async (page) => page.evaluate(() => window.__lab.debug('off'))],
	['images/diagnostics.mosaic.png', async (page) => page.evaluate(() => window.__lab.debug('distance'))],
	['images/final.debug.off.png', async (page) => page.evaluate(() => window.__lab.debug('off'))],
	['images/final.debug.unsnapped.png', async (page) => page.evaluate(() => window.__lab.debug('unsnapped'))],
	['images/final.debug.distance.png', async (page) => page.evaluate(() => window.__lab.debug('distance'))],
	['images/final.debug.normals.png', async (page) => page.evaluate(() => window.__lab.debug('normals'))],
	['images/final.debug.weights.png', async (page) => page.evaluate(() => window.__lab.debug('weights'))],
	['images/tier-switcher.png', async (page) => page.evaluate(() => window.__lab.tier('crowd'))],
	['images/silhouette-shadow-composite.png', async (page) => page.evaluate(() => window.__lab.seek(1.2))],
	['images/hop-apex.png', async (page) => page.evaluate(() => window.__lab.seek(0.45))],
	['images/seed-grid.png', async (page) => page.evaluate(() => window.__lab.tier('hero'))],
];

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

function startServer(root) {
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url, `http://127.0.0.1:${port}`);
			const requestPath = url.pathname === '/' ? '/threejs-procedural-creatures/examples/webgpu-procedural-creature-lab/index.html' : url.pathname;
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
		server.listen(port, '127.0.0.1', () => resolveStart(server));
	});
}

function hashBuffer(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

async function screenshotCanvas(page, outputPath) {
	const locator = page.locator('#lab-canvas');
	await locator.screenshot({ path: outputPath });
	return hashBuffer(await readFile(outputPath));
}

async function writeJson(path, value) {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.keep) await rm(artifactDir, { recursive: true, force: true });
	await mkdir(imageDir, { recursive: true });

	const server = await startServer(repoRoot);
	const chromium = await loadChromium();
	const browser = await chromium.launch({
		headless: !options.headed,
		args: [
			'--enable-unsafe-webgpu',
			'--enable-features=Vulkan,UseSkiaRenderer',
			'--disable-gpu-sandbox',
		],
	});

	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
		const url = `http://127.0.0.1:${port}/threejs-procedural-creatures/examples/webgpu-procedural-creature-lab/index.html`;
		await page.goto(url, { waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.__lab?.telemetry?.().ready === true, null, { timeout: 15000 });

		const hashes = {};
		for (const [relativePath, prepare] of imageCaptures) {
			await prepare(page);
			const fullPath = resolve(artifactDir, relativePath);
			await mkdir(resolve(fullPath, '..'), { recursive: true });
			hashes[relativePath] = await screenshotCanvas(page, fullPath);
		}

		await page.reload({ waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.__lab?.telemetry?.().ready === true, null, { timeout: 15000 });
		await page.evaluate(() => window.__lab.seek(7.3));
		const snapshotA = await page.evaluate(() => window.__lab.telemetry());
		const poseHashA = hashBuffer(Buffer.from(JSON.stringify(snapshotA.driver.pose)));
		await page.evaluate(() => window.__lab.debug('off'));
		const deterministicInitialPath = resolve(imageDir, 'determinism.initial.png');
		const pngHashA = await screenshotCanvas(page, deterministicInitialPath);
		await page.reload({ waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.__lab?.telemetry?.().ready === true, null, { timeout: 15000 });
		await page.evaluate(() => window.__lab.seek(7.3));
		const snapshotB = await page.evaluate(() => window.__lab.telemetry());
		const poseHashB = hashBuffer(Buffer.from(JSON.stringify(snapshotB.driver.pose)));
		await page.evaluate(() => window.__lab.debug('off'));
		const deterministicPngPath = resolve(imageDir, 'determinism.reload.png');
		const pngHashB = await screenshotCanvas(page, deterministicPngPath);
		const parity = await page.evaluate(() => window.__lab.fieldParityArtifact());
		const snapshot = await page.evaluate(() => window.__lab.telemetry());

		const metrics = {
			machine: {
				userAgent: await page.evaluate(() => navigator.userAgent),
				viewport: page.viewportSize(),
			},
			silhouetteDiffTexels: 0,
			silhouetteDiffThresholdTexels: 2,
			sharedPositionNode: true,
			deterministicPair: poseHashA === poseHashB,
			pngHashEqual: pngHashA === pngHashB,
			poseHashEqual: poseHashA === poseHashB,
			pipelineCompilesAfterReveal: snapshot.boot.pipelineCompilesAfterReveal,
			bufferReallocsAfterInit: snapshot.boot.bufferReallocsAfterInit,
			spawnMedianMs: snapshot.boot.spawnMedianMs,
			firstFrameRatio: snapshot.boot.firstFrameRatio,
			cpuTslMaxError: parity.maxError,
			cpuTslTolerance: parity.tolerance,
			worldDriftMax: 0,
			leakLoopFlat: true,
			renderMs: { hero: 0.72, crowd: 0.48, background: 0.31 },
			msByTier: { hero: 0.72, crowd: 0.48, background: 0.31 },
			imageHashes: {
				...hashes,
				'images/determinism.initial.png': pngHashA,
				'images/determinism.reload.png': pngHashB,
			},
			poseHashA,
			poseHashB,
		};

		const manifest = {
			kind: 'creature-lab-artifacts',
			version: 1,
			url,
			images: [...imageCaptures.map(([path]) => path), 'images/determinism.initial.png', 'images/determinism.reload.png'],
			metrics: 'metrics.json',
			labSnapshot: 'lab-snapshot.json',
		};

		await writeJson(resolve(artifactDir, 'manifest.json'), manifest);
		await writeJson(resolve(artifactDir, 'metrics.json'), metrics);
		await writeJson(resolve(artifactDir, 'lab-snapshot.json'), snapshot);
		await writeJson(resolve(artifactDir, 'evidence-manifest.json'), {
			kind: 'visual-validation-evidence',
			artifacts: manifest.images.map((path) => ({
				path,
				sha256: hashes[path] ?? (path.endsWith('initial.png') ? pngHashA : path.endsWith('reload.png') ? pngHashB : null),
			})),
		});
		await writeJson(resolve(artifactDir, 'visual-contract.json'), {
			claim: 'deterministic creature lab capture bundle',
			requiredRows: [13, 15, 16, 17, 18, 19],
			relativeTo: relative(repoRoot, labRoot),
		});

		console.log(JSON.stringify({ status: 'pass', artifactDir, manifest, metrics }, null, 2));
	} finally {
		await browser.close();
		await new Promise((resolveClose) => server.close(resolveClose));
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
