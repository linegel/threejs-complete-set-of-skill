import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { chromium } from '/Users/linegel/_reps/threejs/threejs-image-pipeline/examples/webgpu-image-pipeline/node_modules/playwright/index.mjs';

const repoRoot = '/Users/linegel/_reps/threejs';
const labPath = '/threejs-procedural-creatures/examples/webgpu-procedural-creature-lab/index.html';
const screenshotPath = '/tmp/creature-lab-smoke.png';

const contentTypes = new Map([
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.mjs', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.css', 'text/css; charset=utf-8'],
	['.wasm', 'application/wasm'],
	['.png', 'image/png'],
]);

async function serveStatic(root) {
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? '/', 'http://127.0.0.1');
			const decoded = decodeURIComponent(url.pathname);
			const requested = normalize(join(root, decoded));
			const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
			if (requested !== root && !requested.startsWith(rootWithSep)) {
				response.writeHead(403);
				response.end('forbidden');
				return;
			}
			const filePath = requested.endsWith(sep) ? join(requested, 'index.html') : requested;
			const body = await readFile(filePath);
			response.writeHead(200, { 'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream' });
			response.end(body);
		} catch (error) {
			response.writeHead(error?.code === 'ENOENT' ? 404 : 500);
			response.end(error?.message || String(error));
		}
	});
	await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
	return server;
}

function chromiumLaunchArgs() {
	const args = ['--enable-unsafe-webgpu', '--disable-gpu-sandbox'];
	if (platform() !== 'darwin') args.splice(1, 0, '--enable-features=Vulkan,UseSkiaRenderer');
	return args;
}

async function main() {
	const server = await serveStatic(repoRoot);
	const address = server.address();
	const url = `http://127.0.0.1:${address.port}${labPath}`;
	const browser = await chromium.launch({
		headless: true,
		args: chromiumLaunchArgs(),
	});
	const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 1 });
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error?.message || String(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') pageErrors.push(message.text());
	});

	try {
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => window.__lab?.ready === true, null, { timeout: 60000 });
		const telemetry = await page.evaluate(() => window.__lab.telemetry());
		if (telemetry.renderer?.isWebGPUBackend !== true) {
			throw new Error(`renderer.isWebGPUBackend was ${telemetry.renderer?.isWebGPUBackend}`);
		}
		if (!telemetry.shadowParity?.every((entry) => entry.allEqual === true)) {
			throw new Error(`shadowParity failed: ${JSON.stringify(telemetry.shadowParity)}`);
		}
		if (!telemetry.bootCounters?.countersAtInit || !telemetry.bootCounters?.countersAtReveal) {
			throw new Error('bootCounters missing init/reveal marks');
		}
		await page.screenshot({ path: screenshotPath, fullPage: true });
		console.log(JSON.stringify(telemetry, null, 2));
	} catch (error) {
		const labError = await page.evaluate(() => window.__lab?.error || window.__labError || null).catch(() => null);
		console.error('PAGE_ERROR:', labError || error?.message || String(error));
		if (pageErrors.length > 0) console.error('BROWSER_ERRORS:', JSON.stringify(pageErrors, null, 2));
		process.exitCode = 1;
	} finally {
		await browser.close();
		await new Promise((resolveClose) => server.close(resolveClose));
	}
}

main().catch((error) => {
	console.error('SMOKE_ERROR:', error?.message || String(error));
	process.exitCode = 1;
});
