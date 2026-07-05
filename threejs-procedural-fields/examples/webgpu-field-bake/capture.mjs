import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const pagePath = "/threejs-procedural-fields/examples/webgpu-field-bake/index.html";
const defaultArtifactDir = resolve(repoRoot, "threejs-procedural-fields/examples/webgpu-field-bake/artifacts");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

function parseArgs(argv) {
  const options = {
    headed: false,
    port: 0,
    artifacts: defaultArtifactDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--headed") options.headed = true;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--artifacts") options.artifacts = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
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

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function validateArtifacts(artifactDir) {
  const child = spawn(
    process.execPath,
    [resolve(here, "validate-field-contract.mjs"), "--artifacts", artifactDir],
    { cwd: repoRoot, stdio: "inherit" },
  );

  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("field-bake artifact validation failed");
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
      viewport: { width: 64, height: 64 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });

    await page.goto(`${baseUrl}${pagePath}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__fieldBakeValidation !== undefined, null, {
      timeout: 30000,
    });
    await page.waitForFunction(() => window.__fieldBakeValidation.ready === true, null, {
      timeout: 30000,
    });

    const readback = await page.evaluate(() => window.__fieldBakeValidation.captureFieldReadback());
    await writeJson(resolve(options.artifacts, "field-readback.json"), readback);
    await validateArtifacts(options.artifacts);
    console.log(`WebGPU field readback written to ${options.artifacts}`);
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
