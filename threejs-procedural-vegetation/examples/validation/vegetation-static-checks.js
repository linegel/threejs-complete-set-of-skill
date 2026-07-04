const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function walk(dir, predicate, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, files);
    } else if (predicate(full)) {
      files.push(full);
    }
  }
  return files;
}

function run(label, args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });

  return {
    label,
    command: [process.execPath, ...args].join(" "),
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function assertPass(result) {
  if (result.status !== 0) {
    throw new Error(`${result.label} failed:\n${result.stderr || result.stdout}`);
  }
}

function validateRendererFallbackTerms() {
  const pattern = /\b(ShaderMaterial|onBeforeCompile|WebGLRenderTarget|gl_FragColor)\b/g;
  const allowedPrefixes = [
    ".agent/reviews/",
    "examples/gpu-computed-grass/",
    "examples/stylized-meadow-grass/",
  ];
  const allowedExact = new Set([
    "examples/validation/vegetation-static-checks.js",
    "plan.md",
    "review.md",
  ]);
  const files = walk(root, (file) => /\.(js|md|yaml)$/.test(file));
  const hits = [];
  const disallowed = [];

  for (const file of files) {
    const rel = relative(file);
    const text = fs.readFileSync(file, "utf8");
    const matches = [...text.matchAll(pattern)].map((match) => match[1]);
    if (matches.length === 0) continue;

    const allowed = allowedExact.has(rel) || allowedPrefixes.some((prefix) => rel.startsWith(prefix));
    hits.push({ file: rel, terms: [...new Set(matches)].sort(), allowed });
    if (!allowed) {
      disallowed.push(rel);
    }
  }

  if (disallowed.length > 0) {
    throw new Error(`Renderer fallback terms outside explicit WebGPU-unavailable fallback or historical surfaces: ${disallowed.join(", ")}`);
  }

  return hits;
}

function main() {
  const exampleJs = walk(path.join(root, "examples"), (file) => file.endsWith(".js"))
    .map(relative)
    .sort();
  const checks = [];

  for (const file of exampleJs) {
    const result = run(`node --check ${file}`, ["--check", file]);
    assertPass(result);
    checks.push({ label: result.label, status: result.status });
  }

  const ash = run("Ash contract", ["examples/structured-ash-growth/verify-ash-contract.js"]);
  assertPass(ash);
  checks.push({
    label: ash.label,
    status: ash.status,
    summary: JSON.parse(ash.stdout),
  });

  const denseGrass = run("Dense grass contracts", ["examples/webgpu-dense-grass/validation.js"]);
  assertPass(denseGrass);
  checks.push({
    label: denseGrass.label,
    status: denseGrass.status,
    summary: JSON.parse(denseGrass.stdout),
  });

  const rendererFallbackTermHits = validateRendererFallbackTerms();

  return {
    pass: true,
    checkedJsFiles: exampleJs,
    checks,
    rendererFallbackTermHits,
  };
}

try {
  console.log(JSON.stringify(main(), null, 2));
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
