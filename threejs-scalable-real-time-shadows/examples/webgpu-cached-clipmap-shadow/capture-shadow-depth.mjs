import { spawn } from "node:child_process";
import { once } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const pagePath = "/threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/browser.html";
const defaultArtifactDir = resolve(here, "artifacts");
const defaultPort = 0; // Gated: request an ephemeral loopback port for parallel-safe local capture.
const validationFailureCode = 1; // Gated: standard process failure when the validator exits without a code.
const webgpuReadyTimeoutMs = 120000; // Gated: first WebGPU pipeline compile can exceed field-bake's readback-only ceiling.
const captureViewportSize = 512; // Gated: matches browser.html's fixed artifact viewport.

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

function parseArgs(argv) {
  const options = {
    artifacts: defaultArtifactDir,
    headed: false,
    port: defaultPort,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifacts") {
      options.artifacts = resolve(argv[++index]);
    } else if (arg === "--headed") {
      options.headed = true;
    } else if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function serveStatic(root) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const decoded = decodeURIComponent(url.pathname);
    const normalized = decoded === "/" ? pagePath : decoded;
    const path = resolve(root, `.${normalized}`);

    if (!path.startsWith(root) || !existsSync(path)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes.get(extname(path)) ?? "application/octet-stream",
    });
    createReadStream(path).pipe(response);
  });

  return server;
}

function decodePngDataUrl(dataUrl, name) {
  const prefix = "data:image/png;base64,";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) {
    throw new Error(`${name} was not a PNG data URL`);
  }
  return Buffer.from(dataUrl.slice(prefix.length), "base64");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function validateArtifacts(artifactDir) {
  const child = spawn(process.execPath, ["validate.js", "--artifacts", artifactDir], {
    cwd: here,
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  return code ?? validationFailureCode;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { chromium } = await import("playwright");
  const server = serveStatic(repoRoot);

  server.listen(options.port, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({
    headless: !options.headed,
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan,UseSkiaRenderer",
      "--disable-gpu-sandbox",
    ],
  });

  try {
    await mkdir(options.artifacts, { recursive: true });
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: captureViewportSize, height: captureViewportSize },
    });
    const page = await context.newPage();

    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("pageerror", (error) => {
      console.error(error.stack ?? error.message);
    });

    await page.goto(`${baseUrl}${pagePath}`, { waitUntil: "networkidle" });
    try {
      await page.waitForFunction(
        () =>
          window.cachedClipmapShadowArtifact?.ready === true ||
          Boolean(window.cachedClipmapShadowArtifact?.error),
        null,
        { timeout: webgpuReadyTimeoutMs },
      );
    } catch (error) {
      const state = await page
        .evaluate(() => window.cachedClipmapShadowArtifact ?? null)
        .catch(() => null);
      throw new Error(`${error.message}\npage artifact state: ${JSON.stringify(state)}`);
    }

    const artifact = await page.evaluate(() => window.cachedClipmapShadowArtifact);
    if (artifact.error) {
      throw new Error(artifact.error);
    }

    const { shadowMapPng, silhouettePng, ...metadata } = artifact;
    await writeFile(resolve(options.artifacts, "shadow-map.png"), decodePngDataUrl(shadowMapPng, "shadowMapPng"));
    await writeFile(resolve(options.artifacts, "silhouette.png"), decodePngDataUrl(silhouettePng, "silhouettePng"));
    await writeJson(resolve(options.artifacts, "shadow-capture.json"), {
      ...metadata,
      page: pagePath,
    });

    const validationCode = await validateArtifacts(options.artifacts);
    if (validationCode === 0) {
      console.log(`Phase-1 clipmap scaffold artifacts written to ${options.artifacts}`);
    }
    process.exitCode = validationCode;
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
