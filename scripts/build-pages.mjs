#!/usr/bin/env node
// Generates docs/index.html (the GitHub Pages site) from the SKILL.md
// frontmatter of every threejs-* skill folder. Re-run after adding or
// renaming skills: node scripts/build-pages.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/linegel/threejs-complete-set-of-skill';
const SITE = 'https://linegel.github.io/threejs-complete-set-of-skill/';
const OG_IMAGE = `${SITE}visual-validation/planet-generated-craters/final.design.png`;

const CATEGORIES = [
  { name: 'Planning and Validation', blurb: 'Route requests to the right experts and prove the result with reproducible evidence.', slugs: ['threejs-choose-skills', 'threejs-visual-validation', 'threejs-compatibility-fallbacks'] },
  { name: 'Cameras, Lighting, and Final Image', blurb: 'Who owns depth, tone mapping, and the last pass — the difference between a demo and an image.', slugs: ['threejs-camera-controls-and-rigs', 'threejs-scalable-real-time-shadows', 'threejs-ambient-contact-shading', 'threejs-bloom', 'threejs-exposure-color-grading', 'threejs-image-pipeline'] },
  { name: 'Worlds and Environments', blurb: 'Skies, oceans, weather, and water that share causes instead of fighting each other.', slugs: ['threejs-sky-atmosphere-and-haze', 'threejs-volumetric-clouds', 'threejs-spectral-ocean', 'threejs-water-optics', 'threejs-rain-snow-and-wet-surfaces'] },
  { name: 'Procedural Content', blurb: 'Fields, materials, geometry, buildings, planets, vegetation, creatures — authored systems, not noise soup.', slugs: ['threejs-procedural-fields', 'threejs-procedural-materials', 'threejs-procedural-geometry', 'threejs-procedural-buildings-and-cities', 'threejs-procedural-planets', 'threejs-procedural-vegetation', 'threejs-procedural-creatures'] },
  { name: 'Motion and Effects', blurb: 'Kinematics, particles, surface history, and spacetime — motion with frame-rate-independent discipline.', slugs: ['threejs-procedural-motion-systems', 'threejs-particles-trails-and-effects', 'threejs-dynamic-surface-effects', 'threejs-black-holes-and-space-effects'] },
];

const GALLERY = [
  { img: 'visual-validation/planet-generated-craters/final.design.png', title: 'Procedural planet — crater field', note: 'threejs-procedural-planets · final design frame from the fixed-view visual contract' },
  { img: 'visual-validation/water-generated-caustics/final.design.png', title: 'Bounded water — generated caustics', note: 'threejs-water-optics · differential-area caustics with depth-aware refraction' },
  { img: 'visual-validation/rain-generated-ripples/final.design.png', title: 'Rain — generated ripple normals', note: 'threejs-rain-snow-and-wet-surfaces · wet-surface ripples from generated normal variants' },
  { img: 'visual-validation/planet-generated-craters/diagnostics.mosaic.png', title: 'Diagnostics mosaic — planet', note: 'threejs-visual-validation · per-signal diagnostic passes, not a single pretty screenshot' },
  { img: 'visual-validation/water-generated-caustics/diagnostics.mosaic.png', title: 'Diagnostics mosaic — water', note: 'threejs-visual-validation · effect isolation across the node pipeline' },
  { img: 'generated-asset-contact-sheet.png', title: 'Generated texture asset contact sheet', note: 'deterministic PNG variants shipped under assets/generated-variants/' },
];

const skills = {};
for (const d of readdirSync(root)) {
  const p = join(root, d, 'SKILL.md');
  if (!d.startsWith('threejs-') || !existsSync(p)) continue;
  const t = readFileSync(p, 'utf8');
  const fm = t.match(/^---\n([\s\S]*?)\n---/)[1];
  const desc = fm.match(/description:\s*([\s\S]*?)(?=\n\w|$)/)[1].replace(/\s*\n\s+/g, ' ').trim();
  const title = (t.split('\n').find((l) => l.startsWith('# ')) || `# ${d}`).slice(2).trim();
  const exDir = join(root, d, 'examples');
  const examples = existsSync(exDir) ? readdirSync(exDir).filter((e) => !e.startsWith('.') && !e.includes('.')).length : 0;
  skills[d] = { slug: d, title, desc, examples };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const total = Object.keys(skills).length;

const card = (s, i) => `
      <a class="card" href="${REPO}/blob/main/${s.slug}/SKILL.md" style="--d:${i * 40}ms">
        <span class="card-index">${String(i + 1).padStart(2, '0')}</span>
        <h4>${esc(s.title)}</h4>
        <p>${esc(s.desc)}</p>
        <span class="card-meta">$${s.slug}${s.examples ? ` · ${s.examples} example${s.examples > 1 ? 's' : ''}` : ''}</span>
      </a>`;

let cardIndex = 0;
const catalog = CATEGORIES.map((c) => `
    <section class="category">
      <div class="category-head">
        <h3>${esc(c.name)}</h3>
        <p>${esc(c.blurb)}</p>
      </div>
      <div class="grid">${c.slugs.filter((s) => skills[s]).map((s) => card(skills[s], cardIndex++)).join('')}
      </div>
    </section>`).join('\n');

const gallery = GALLERY.map((g) => `
      <figure>
        <img src="${g.img}" alt="${esc(g.title)}" loading="lazy" />
        <figcaption><strong>${esc(g.title)}</strong><span>${esc(g.note)}</span></figcaption>
      </figure>`).join('');

const HARNESSES = [
  { name: 'Claude Code', how: 'Symlink (or copy) the skill folders into your personal or project skills directory; they appear in the Skill tool automatically.', code: `git clone ${REPO}.git\nln -s "$PWD/threejs-complete-set-of-skill"/threejs-* ~/.claude/skills/` },
  { name: 'Codex CLI', how: 'Point Codex at the folders via AGENTS.md: list each skill name + path and instruct it to read the SKILL.md when the task matches.', code: `git clone ${REPO}.git\n# in AGENTS.md: "For Three.js WebGPU work, read the matching\n# threejs-*/SKILL.md from ./threejs-complete-set-of-skill/"` },
  { name: 'Cursor / other IDEs', how: 'Add the repo as a workspace folder and reference skills in rules (.cursor/rules or equivalent) so the agent loads SKILL.md on demand.', code: `git submodule add ${REPO}.git skills/threejs\n# rule: "Before Three.js WebGPU tasks, read skills/threejs/<skill>/SKILL.md"` },
  { name: 'Gemini CLI & generic agents', how: 'Any harness that can read local files works: each skill is a self-contained folder with SKILL.md, references/, and examples/. A machine-readable index lives at skills.json; a plain-text overview at llms.txt.', code: `curl -s ${SITE}skills.json | jq '.skills[].name'\ncurl -s ${SITE}llms.txt` },
];

const harnessSection = HARNESSES.map((h, i) => `
    <div class="step"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(h.name)}</h3>
      <p>${esc(h.how)}</p>
      <pre><code>${esc(h.code)}</code></pre></div>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Three.js WebGPU Skill Pack — TSL, Procedural Graphics, Visual Validation</title>
<meta name="description" content="${total} specialized agent skills for ambitious Three.js WebGPU/TSL scenes: oceans, clouds, planets, water optics, image pipelines, and screenshot-backed visual validation. Works with Claude Code, Codex, Cursor, Gemini CLI, and any agent that loads local skill folders." />
<meta name="keywords" content="three.js, threejs, webgpu, TSL, three shading language, NodeMaterial, agent skills, claude code skills, codex skills, procedural graphics, spectral ocean, volumetric clouds, procedural planets, visual validation, RenderPipeline" />
<link rel="canonical" href="${SITE}" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Three.js WebGPU Skill Pack" />
<meta property="og:title" content="Three.js WebGPU Skill Pack — ${total} expert agent skills for TSL scenes" />
<meta property="og:description" content="Agent skills for ambitious Three.js WebGPU/TSL graphics: oceans, atmospheres, planets, clouds, water optics, image pipelines, and screenshot-backed validation." />
<meta property="og:url" content="${SITE}" />
<meta property="og:image" content="${OG_IMAGE}" />
<meta property="og:image:alt" content="Procedural planet crater field rendered with the skill pack" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Three.js WebGPU Skill Pack — ${total} expert agent skills" />
<meta name="twitter:description" content="TSL-first Three.js WebGPU skills for Claude Code, Codex, Cursor, Gemini CLI, and any skill-aware agent." />
<meta name="twitter:image" content="${OG_IMAGE}" />
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareSourceCode',
      name: 'Three.js WebGPU Skill Pack',
      description: `${total} specialized agent skills for Three.js WebGPU/TSL: procedural graphics, image pipelines, and visual validation.`,
      codeRepository: REPO,
      url: SITE,
      programmingLanguage: ['JavaScript', 'TSL'],
      runtimePlatform: 'Three.js WebGPURenderer',
      keywords: 'three.js, webgpu, TSL, agent skills, procedural graphics, visual validation',
      license: 'https://opensource.org/licenses/MIT',
      image: OG_IMAGE,
    },
    {
      '@type': 'ItemList',
      name: 'Skill catalog',
      numberOfItems: total,
      itemListElement: Object.values(skills).map((s, i) => ({
        '@type': 'ListItem', position: i + 1, name: s.title,
        url: `${REPO}/blob/main/${s.slug}/SKILL.md`, description: s.desc,
      })),
    },
  ],
}, null, 1)}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet" />
<style>
:root{
  --bg:#0a0c10; --bg2:#0f1218; --ink:#e8e4da; --dim:#8b8778;
  --amber:#ffb454; --cyan:#7fd4c1; --line:#23262e;
  --serif:'Instrument Serif',serif; --mono:'IBM Plex Mono',monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:var(--mono);font-size:15px;line-height:1.65;
  background-image:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(255,180,84,.07),transparent),
  radial-gradient(ellipse 60% 40% at 90% 110%,rgba(127,212,193,.05),transparent)}
a{color:inherit;text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:0 clamp(20px,4vw,56px)}
/* nav */
nav{display:flex;justify-content:space-between;align-items:baseline;padding:28px 0;border-bottom:1px solid var(--line)}
nav .brand{font-family:var(--serif);font-size:22px;letter-spacing:.02em}
nav .links{display:flex;gap:28px;font-size:13px;color:var(--dim)}
nav .links a:hover{color:var(--amber)}
/* hero */
header{padding:clamp(70px,11vw,140px) 0 clamp(50px,7vw,90px);position:relative}
.kicker{color:var(--amber);font-size:13px;letter-spacing:.22em;text-transform:uppercase;margin-bottom:26px;animation:rise .7s ease both}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(44px,7.2vw,96px);line-height:1.02;letter-spacing:-.01em;max-width:14ch;animation:rise .7s .08s ease both}
h1 em{font-style:italic;color:var(--amber)}
.lede{margin-top:34px;max-width:62ch;color:var(--dim);animation:rise .7s .16s ease both}
.stats{display:flex;gap:clamp(28px,5vw,72px);margin-top:56px;padding-top:28px;border-top:1px solid var(--line);animation:rise .7s .24s ease both}
.stat b{display:block;font-family:var(--serif);font-weight:400;font-size:40px;color:var(--ink)}
.stat span{font-size:12px;color:var(--dim);letter-spacing:.14em;text-transform:uppercase}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
/* sections */
h2{font-family:var(--serif);font-weight:400;font-size:clamp(30px,4vw,48px);margin-bottom:14px}
.section{padding:clamp(56px,8vw,110px) 0;border-top:1px solid var(--line)}
.section>.wrap>p.sub{color:var(--dim);max-width:64ch;margin-bottom:44px}
/* quickstart */
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}
.step{background:var(--bg2);border:1px solid var(--line);padding:26px 26px 22px;position:relative}
.step .n{position:absolute;top:-14px;left:22px;background:var(--bg);border:1px solid var(--line);color:var(--amber);
  font-size:12px;padding:2px 10px;letter-spacing:.15em}
.step h3{font-family:var(--serif);font-weight:400;font-size:21px;margin-bottom:10px}
.step p{color:var(--dim);font-size:13.5px;margin-bottom:14px}
pre{background:#07090c;border:1px solid var(--line);border-left:2px solid var(--amber);padding:14px 16px;overflow-x:auto;
  font-size:12.5px;line-height:1.6;color:#cfc9ba;white-space:pre-wrap}
code{font-family:var(--mono)}
/* catalog */
.category{margin-bottom:64px}
.category-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 26px;margin-bottom:24px}
.category-head h3{font-family:var(--serif);font-weight:400;font-size:27px;color:var(--amber)}
.category-head p{color:var(--dim);font-size:13px;max-width:60ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
.card{background:var(--bg2);border:1px solid var(--line);padding:24px;display:flex;flex-direction:column;gap:10px;
  transition:border-color .25s,transform .25s,box-shadow .25s}
.card:hover{border-color:var(--amber);transform:translateY(-3px);box-shadow:0 14px 40px rgba(0,0,0,.45)}
.card-index{font-size:11px;color:var(--dim);letter-spacing:.2em}
.card h4{font-family:var(--serif);font-weight:400;font-size:21px}
.card p{color:var(--dim);font-size:12.8px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{margin-top:auto;padding-top:12px;font-size:11.5px;color:var(--cyan);border-top:1px dashed var(--line)}
/* gallery */
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:22px}
figure{background:var(--bg2);border:1px solid var(--line)}
figure img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover;filter:saturate(1.05)}
figcaption{padding:16px 18px;font-size:12.5px}
figcaption strong{display:block;font-family:var(--serif);font-weight:400;font-size:17px;margin-bottom:4px}
figcaption span{color:var(--dim)}
/* footer */
footer{border-top:1px solid var(--line);padding:44px 0 60px;display:flex;flex-wrap:wrap;gap:16px 40px;justify-content:space-between;color:var(--dim);font-size:13px}
footer a{color:var(--amber)}
footer a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="wrap"><nav>
  <a class="brand" href="#">Three.js WebGPU Skill&nbsp;Pack</a>
  <div class="links"><a href="#quickstart">Usage</a><a href="#install">Install</a><a href="#skills">Skills</a><a href="#gallery">Gallery</a><a href="${REPO}">GitHub&nbsp;↗</a></div>
</nav></div>

<header class="wrap">
  <p class="kicker">TSL-first · WebGPURenderer · Screenshot-backed validation</p>
  <h1>${total} expert skills for <em>ambitious</em> Three.js WebGPU scenes.</h1>
  <p class="lede">Not a tutorial. A skill pack for agents — Claude Code, Codex, and any shell that loads local skill folders — that need to design, implement, debug, and <strong>prove</strong> advanced real-time graphics: oceans, atmospheres, planets, volumetric clouds, water optics, particles, shadows, and full node post pipelines.</p>
  <div class="stats">
    <div class="stat"><b>${total}</b><span>skills</span></div>
    <div class="stat"><b>${Object.values(skills).reduce((a, s) => a + s.examples, 0)}</b><span>runnable examples</span></div>
    <div class="stat"><b>TSL</b><span>node-first architecture</span></div>
    <div class="stat"><b>PNG+JSON</b><span>regression evidence</span></div>
  </div>
</header>

<div class="section" id="quickstart"><div class="wrap">
  <h2>Usage</h2>
  <p class="sub">Clone the repo where your agent can see it, then invoke skills by name. The router picks the smallest useful set; each skill carries its own references, agents, and runnable examples.</p>
  <div class="steps">
    <div class="step"><span class="n">01</span><h3>Install</h3>
      <p>Clone next to your project, or symlink the skill folders into your agent's skills directory (e.g. <code>~/.claude/skills/</code>).</p>
      <pre><code>git clone ${REPO}.git</code></pre></div>
    <div class="step"><span class="n">02</span><h3>Route</h3>
      <p>Start broad requests with the router so only the relevant experts are loaded into context.</p>
      <pre><code>Use $threejs-choose-skills to plan a WebGPU/TSL
scene with an ocean at sunset, volumetric clouds,
camera flythrough, bloom, and validation.</code></pre></div>
    <div class="step"><span class="n">03</span><h3>Build &amp; validate</h3>
      <p>Load the selected skills, build the visual cause first, then prove the frame with reproducible evidence.</p>
      <pre><code>Use $threejs-spectral-ocean and
$threejs-sky-atmosphere-and-haze, then
$threejs-visual-validation to verify the frame.</code></pre></div>
  </div>
</div></div>

<div class="section" id="install"><div class="wrap">
  <h2>Install for your harness</h2>
  <p class="sub">Every skill is a plain folder — SKILL.md with YAML frontmatter, references/, agents/, and runnable examples/ — so any agent that reads local files can use the pack. Machine-readable index: <a href="skills.json" style="color:var(--cyan)">skills.json</a> · plain-text overview for LLMs: <a href="llms.txt" style="color:var(--cyan)">llms.txt</a>.</p>
  <div class="steps">${harnessSection}
  </div>
</div></div>

<div class="section" id="skills"><div class="wrap">
  <h2>Skill catalog</h2>
  <p class="sub">One owner for depth, tone mapping, and output color. Build the visual cause first; use post to preserve it. Validate with evidence, not one attractive screenshot. Every card links to the full SKILL.md.</p>
${catalog}
</div></div>

<div class="section" id="gallery"><div class="wrap">
  <h2>Validation gallery</h2>
  <p class="sub">Frames produced and verified by the skills themselves — fixed-view design contracts, per-signal diagnostics mosaics, and deterministic generated texture assets.</p>
  <div class="gallery">${gallery}
  </div>
</div></div>

<div class="wrap"><footer>
  <span>Three.js WebGPU Skill Pack — TSL, procedural graphics, and visual validation.</span>
  <span><a href="${REPO}">Repository</a> · <a href="${REPO}#readme">Full README</a> · MIT-spirited, agent-tested</span>
</footer></div>
</body>
</html>
`;

writeFileSync(join(root, 'docs', 'index.html'), html);

// llms.txt — https://llmstxt.org convention: concise, plain-text entry point for LLMs.
const llms = `# Three.js WebGPU Skill Pack

> ${total} specialized agent skills for ambitious Three.js WebGPU/TSL scenes: procedural oceans, volumetric clouds, planets, water optics, particles, shadows, image pipelines, and screenshot-backed visual validation. Works with Claude Code, Codex, Cursor, Gemini CLI, and any agent that loads local skill folders.

Repository: ${REPO}
Install (Claude Code): git clone ${REPO}.git && ln -s "$PWD/threejs-complete-set-of-skill"/threejs-* ~/.claude/skills/
Install (any agent): clone the repo; each skill is a self-contained folder with SKILL.md (YAML frontmatter: name, description), references/, agents/, and runnable examples/.
Machine-readable index: ${SITE}skills.json
Routing: start broad requests with threejs-choose-skills; it selects the smallest useful skill set.

## Skills

${CATEGORIES.map((c) => `### ${c.name}\n\n${c.slugs.filter((s) => skills[s]).map((s) => `- [${skills[s].title}](${REPO}/blob/main/${s}/SKILL.md): ${skills[s].desc}`).join('\n')}`).join('\n\n')}

## Hard rules the pack teaches

- Start from current Three.js WebGPU APIs (WebGPURenderer from three/webgpu, TSL from three/tsl), not legacy WebGL examples.
- One owner for depth, normals, velocity, history, tone mapping, and output color conversion.
- Build the visual cause first; use post-processing to preserve or reveal it.
- Validate with reproducible evidence (fixed-view contracts, diagnostics, seed sweeps), not a single attractive screenshot.
`;
writeFileSync(join(root, 'docs', 'llms.txt'), llms);

// skills.json — machine-readable manifest for tooling and agent installers.
writeFileSync(join(root, 'docs', 'skills.json'), JSON.stringify({
  name: 'threejs-webgpu-skill-pack',
  description: `${total} agent skills for Three.js WebGPU/TSL procedural graphics and visual validation`,
  repository: REPO,
  homepage: SITE,
  skillFormat: 'SKILL.md with YAML frontmatter (name, description) per folder',
  router: 'threejs-choose-skills',
  categories: CATEGORIES.map((c) => ({ name: c.name, skills: c.slugs.filter((s) => skills[s]) })),
  skills: Object.values(skills).map((s) => ({
    name: s.slug, title: s.title, description: s.desc, examples: s.examples,
    skillMd: `${REPO}/blob/main/${s.slug}/SKILL.md`,
    raw: `https://raw.githubusercontent.com/linegel/threejs-complete-set-of-skill/main/${s.slug}/SKILL.md`,
  })),
}, null, 2) + '\n');

writeFileSync(join(root, 'docs', 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
writeFileSync(join(root, 'docs', 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`);

console.log(`Wrote docs/{index.html,llms.txt,skills.json,robots.txt,sitemap.xml} — ${total} skills, ${CATEGORIES.length} categories.`);
