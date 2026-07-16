# Three.js WebGPU/TSL Skills

Twenty-seven installable agent skills for Three.js r185 WebGPU/TSL work. They cover
procedural graphics, rendering systems, motion, final-image ownership, debugging,
and falsifiable visual validation.

[![skills.sh](https://skills.sh/b/linegel/threejs-complete-set-of-skill)](https://skills.sh/linegel/threejs-complete-set-of-skill)

**Website:** <https://threejs-skills.com/> ·
**LLM overview:** [llms.txt](https://threejs-skills.com/llms.txt) ·
**Machine-readable index:** [skills.json](https://threejs-skills.com/skills.json)

## Install

List the available skills, install the complete pack, or select one skill:

```bash
npx skills@latest add linegel/threejs-complete-set-of-skill --list
npx skills@latest add linegel/threejs-complete-set-of-skill --skill '*'
npx skills@latest add linegel/threejs-complete-set-of-skill --skill threejs-spectral-ocean
```

For a specific agent in non-interactive setup:

```bash
npx skills@latest add linegel/threejs-complete-set-of-skill --skill '*' -g -a codex -y
npx skills@latest add linegel/threejs-complete-set-of-skill --skill '*' -g -a claude-code -y
```

The authoritative installable product is [`skills/`](skills/). Runtimes without
the skills CLI can copy the required `skills/<name>/` directories into their local
skills directory. A skill may include self-contained references, scripts, examples,
assets, or fixtures when reachable from `SKILL.md`. Statically named local
dependencies of linked scripts and examples are included through the same checked
closure. Full demos, labs, reviews, and generated media under the top-level
`threejs-*` directories remain repository-only.

For a request spanning several rendering systems, start with
`threejs-choose-skills`. Focused requests can invoke the owning skill directly.

```text
Use $threejs-choose-skills to route an ocean-at-sunset scene with clouds,
a flythrough camera, bloom, exposure, and visual validation.
```

## Skills

### Planning and validation

| Skill | Use it for |
| --- | --- |
| [`threejs-choose-skills`](skills/threejs-choose-skills/SKILL.md) | Route multi-system work to the smallest causal skill set. |
| [`threejs-debugging`](skills/threejs-debugging/SKILL.md) | Reproduce, localize, and contain version-dependent Three.js failures. |
| [`threejs-visual-validation`](skills/threejs-visual-validation/SKILL.md) | Prove visual, numerical, temporal, performance, and lifecycle claims. |
| [`threejs-compatibility-fallbacks`](skills/threejs-compatibility-fallbacks/SKILL.md) | Derive an explicit unavailable-WebGPU fallback and state the lost guarantees. |

### Cameras and final image

| Skill | Use it for |
| --- | --- |
| [`threejs-camera-controls-and-rigs`](skills/threejs-camera-controls-and-rigs/SKILL.md) | Camera ownership, rigs, controls, framing, large coordinates, and resets. |
| [`threejs-scalable-real-time-shadows`](skills/threejs-scalable-real-time-shadows/SKILL.md) | Single shadows, CSM, tiled shadows, and cached clipmaps. |
| [`threejs-ambient-contact-shading`](skills/threejs-ambient-contact-shading/SKILL.md) | AO/GTAO, reconstruction, temporal AO, and bent normals. |
| [`threejs-bloom`](skills/threejs-bloom/SKILL.md) | Full-scene or selective HDR glare with explicit alpha and output ownership. |
| [`threejs-exposure-color-grading`](skills/threejs-exposure-color-grading/SKILL.md) | Metering, EV adaptation, tone mapping, LUT grading, and output color. |
| [`threejs-image-pipeline`](skills/threejs-image-pipeline/SKILL.md) | Minimal framegraphs, shared signals, histories, and final presentation. |

### Worlds and environments

| Skill | Use it for |
| --- | --- |
| [`threejs-sky-atmosphere-and-haze`](skills/threejs-sky-atmosphere-and-haze/SKILL.md) | Authored sky/fog or planetary atmosphere and aerial perspective. |
| [`threejs-volumetric-clouds`](skills/threejs-volumetric-clouds/SKILL.md) | Cloud density, bounded transport, shadows, and temporal reconstruction. |
| [`threejs-spectral-ocean`](skills/threejs-spectral-ocean/SKILL.md) | Periodic offshore FFT oceans, foam, queries, and coastal handoff. |
| [`threejs-water-optics`](skills/threejs-water-optics/SKILL.md) | Bounded and coastal water, wet/dry flow, caustics, and optics. |
| [`threejs-rain-snow-and-wet-surfaces`](skills/threejs-rain-snow-and-wet-surfaces/SKILL.md) | Precipitation, receiver accumulation, snow, wetness, ripples, and splashes. |

### Procedural content

| Skill | Use it for |
| --- | --- |
| [`threejs-procedural-fields`](skills/threejs-procedural-fields/SKILL.md) | Shared scalar/vector causes, bakes, filtering, parity, and metric terrain fields. |
| [`threejs-procedural-materials`](skills/threejs-procedural-materials/SKILL.md) | Procedural PBR graphs, mapping, filtering, emission, and instance variants. |
| [`threejs-procedural-geometry`](skills/threejs-procedural-geometry/SKILL.md) | Indexed mesh writers, sweeps, batching, dynamic updates, and contours. |
| [`threejs-object-sculptor`](skills/threejs-object-sculptor/SKILL.md) | Reconstruct reference-image objects as procedural Three.js models. |
| [`threejs-procedural-buildings-and-cities`](skills/threejs-procedural-buildings-and-cities/SKILL.md) | Building grammars, facades, compilation, city paging, and LOD. |
| [`threejs-procedural-planets`](skills/threejs-procedural-planets/SKILL.md) | Body-scale mapping, cube-sphere/clipmap LOD, fields, and atmosphere handoff. |
| [`threejs-procedural-vegetation`](skills/threejs-procedural-vegetation/SKILL.md) | Dense populations, tree growth, terrain ecology, LOD, and rooted wind. |
| [`threejs-procedural-creatures`](skills/threejs-procedural-creatures/SKILL.md) | Generated bodies, surfaces, rigs, locomotion, and repeated populations. |

### Motion and effects

| Skill | Use it for |
| --- | --- |
| [`threejs-procedural-motion-systems`](skills/threejs-procedural-motion-systems/SKILL.md) | Analytic and fixed-step motion, constraints, frames, and quaternions. |
| [`threejs-particles-trails-and-effects`](skills/threejs-particles-trails-and-effects/SKILL.md) | Analytic/recurrent particles, trails, compaction, and HDR effects. |
| [`threejs-dynamic-surface-effects`](skills/threejs-dynamic-surface-effects/SKILL.md) | Stateful surface history, sparse/full updates, decay, diffusion, and refraction. |
| [`threejs-black-holes-and-space-effects`](skills/threejs-black-holes-and-space-effects/SKILL.md) | Artistic bending, Ellis wormholes, Schwarzschild lensing, and disk transport. |

## Product boundary

```text
skills/<name>/                 Installable product
  SKILL.md                     Invocation and common execution path
  agents/openai.yaml           Human-facing name, summary, and default prompt
  references/                  Branch-specific technical guidance
  scripts/                     Invoked helper, only when indispensable
  examples/                    Minimal canonical examples, when clearer than prose
  assets/                      Inputs or templates used by the installed workflow
  fixtures/                    Oracles that distinguish correct and incorrect output
  LICENSE                      License included with the standalone skill

threejs-*/examples/            Full repository demos and labs
threejs-*/assets/              Demo, evidence, and generated media
threejs-*/                     Other repository review and validation material
threejs-physics-integration/   Experimental notes; not an installable skill
```

Every public skill is model-invoked. Its description names the real invocation
branches; common decisions stay in `SKILL.md`; branch-only equations, API rules,
caveats, validation methods, and bundled resources are loaded through explicit
context pointers. Unlinked or unreferenced bundled files are rejected from the
installed product.

## Validation

Validate the roster, frontmatter, real-file product boundary, transitive resource
closure, standalone links, licenses, and forbidden repository leakage:

```bash
npm run skills:check
```

Before release, run this manual copy-mode smoke installation from the repository
root; it creates and uses a fresh scratch directory:

```bash
repo="$(pwd -P)"
scratch="$(mktemp -d)"
(
  cd "$scratch"
  npx skills@latest add "$repo" --skill '*' --copy -a codex -y
)
diff -qr "$repo/skills" "$scratch/.agents/skills"
```

The smoke passes only when the CLI discovers and installs all 27 skills, every
copied skill directory matches its source under [`skills/`](skills/), and no
top-level repository demo or lab is installed. The scratch check is deliberately
manual; `npm run skills:check` does not claim to run it.

Top-level repository examples and labs have separate validation procedures. They
support development but are not installed. A resource becomes part of an installed
skill only when it is self-contained under `skills/<name>/` and is either linked
from reachable Markdown outside fenced code or is a statically named local
dependency of a linked script or example. The validator follows JavaScript and
TypeScript imports, `new URL`, `fetch`, and `readFile` calls; HTML/SVG `href` and
`src` attributes plus inline module imports; CSS imports and URLs; and relative
Python imports. Dynamically assembled paths require an explicit Markdown pointer.

## Quality rules

- Choose the representation from the workload and truth contract before writing GPU code.
- Name units, spaces, owners, validity limits, resets, and visible failure signatures.
- Keep sequential actions in order; every step ends with a checkable completion criterion.
- Keep each meaning in one place and load branch-only reference material conditionally.
- Delete prose only when it is irrelevant, duplicated, stale, a behavioral no-op, or relocated.
- Use one scene render and one final output conversion whenever shared signals permit it.
- Treat measured evidence as evidence, not as a substitute for understanding the mechanism.

## Attribution

`threejs-object-sculptor` is adapted from
[Three.js Object Sculptor](https://github.com/vinhhien112/Three.js-Object-Sculptor-Codex-Plugin)
by [Vinh Hiển](https://github.com/vinhhien112), pinned at upstream commit
`4194e9ad436a0dff4e1ec982fac1ac64dfded241`. Its installed directory retains the
upstream MIT license. The duplicate Codex plugin bundle is not part of this repository.

## Contributing

Edit the authoritative files under `skills/<name>/`. Bundle a reference, script,
example, asset, or fixture only when it is self-contained and reachable from the
installed workflow. Keep full demos, labs, and repository validation outside that
directory. Run `npm run skills:check`, then run the directly relevant example or
lab validation when implementation evidence changed.
