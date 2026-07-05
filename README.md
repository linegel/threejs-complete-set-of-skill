# Three.js WebGPU Skill Pack for TSL, Procedural Graphics, and Visual Validation

Specialized agent skills for building ambitious Three.js WebGPU scenes with a
TSL-first architecture, procedural graphics systems, generated texture assets,
and screenshot-backed visual validation.

**Website:** <https://linegel.github.io/threejs-complete-set-of-skill/> ·
**LLM overview:** [llms.txt](https://linegel.github.io/threejs-complete-set-of-skill/llms.txt) ·
**Machine-readable index:** [skills.json](https://linegel.github.io/threejs-complete-set-of-skill/skills.json)

## Install

Each skill is a self-contained folder (`SKILL.md` with YAML frontmatter,
`references/`, `agents/`, runnable `examples/`), so any agent that reads local
files can use the pack.

- **Claude Code**: `git clone` this repo, then symlink or copy the
  `threejs-*` folders into `~/.claude/skills/` (or your project's
  `.claude/skills/`).
- **Codex CLI**: clone the repo and reference it from `AGENTS.md` — "for
  Three.js WebGPU work, read the matching `threejs-*/SKILL.md`".
- **Cursor / other IDE agents**: add as a submodule and point a rule at the
  skill folders.
- **Gemini CLI / generic agents**: clone and instruct the agent to load the
  relevant `SKILL.md`; start broad requests with `threejs-choose-skills`.

This is not a generic Three.js tutorial. It is a practical skill pack for
agents that need to design, implement, debug, and validate advanced real-time
graphics systems: atmospheres, oceans, procedural worlds, particles, camera
rigs, post-processing pipelines, shadows, water, clouds, and GPU-backed surface
effects.

Use this repository when an agent needs current Three.js WebGPU guidance for
procedural oceans, volumetric clouds, wet surfaces, cratered planets, procedural
materials, vegetation, star fields, image pipelines, and reproducible visual QA.

## Why This Exists

Complex Three.js scenes fail when every visual system is treated as isolated
code. A believable ocean needs sky reflection, exposure, validation, and camera
scale. A rain scene needs particles, wet surfaces, puddle optics, shadows, and
post-processing ownership. A black-hole scene needs curved-ray integration,
HDR signal discipline, bloom, and fixed-view diagnostics.

These skills encode those boundaries so a skill-aware agent runtime can choose
the right expert guidance without loading the whole repository into context.
The pack is intended for Codex, Claude, and any compatible agent shell that can
load local skill folders.

The pack is built around a few hard rules:

- Start from current Three.js WebGPU APIs, not legacy WebGL examples.
- Use TSL, NodeMaterial, RenderPipeline, compute, storage, MRT, and node post
  pipelines where they are the right architecture.
- Keep one owner for depth, normals, velocity, history, tone mapping, output
  color conversion, and adaptive resolution.
- Build the visual cause first, then use post-processing to preserve or reveal
  it.
- Validate with reproducible evidence, not a single attractive screenshot.

## Quick Start

Use the router first when the request spans more than one rendering system:

```text
Use $threejs-choose-skills to plan a WebGPU/TSL scene with an ocean at sunset,
volumetric clouds, camera flythrough, bloom, exposure, and validation.
```

Then load the specific skills it selects:

```text
Use $threejs-spectral-ocean and $threejs-sky-atmosphere-and-haze to build the
water and sky systems, then use $threejs-image-pipeline and
$threejs-visual-validation to assemble and verify the final frame.
```

For a focused task, invoke that skill directly:

```text
Use $threejs-particles-trails-and-effects to build a pooled spark and debris
system with HDR emission and bloom ownership.
```

## Skill Map

### Planning and Validation

| Skill | Use it for |
| --- | --- |
| [`threejs-choose-skills`](threejs-choose-skills/SKILL.md) | Route a broad visual request to the smallest useful set of skills. |
| [`threejs-visual-validation`](threejs-visual-validation/SKILL.md) | Fixed-view contracts, diagnostics, timing evidence, seed sweeps, leak loops, and regression bundles. |
| [`threejs-compatibility-fallbacks`](threejs-compatibility-fallbacks/SKILL.md) | Explicitly requested WebGL, old-browser, low-end-device, or non-WebGPU fallback plans. |

### Cameras, Lighting, and Final Image

| Skill | Use it for |
| --- | --- |
| [`threejs-camera-controls-and-rigs`](threejs-camera-controls-and-rigs/SKILL.md) | Chase, side, orbit, and authored-shot camera rigs, controls, projection ownership, floating origins, and lifecycle restoration. |
| [`threejs-scalable-real-time-shadows`](threejs-scalable-real-time-shadows/SKILL.md) | Real-time shadows for dynamic and large scenes, cascades, tiled projections, cached clipmaps, texel snapping, and invalidation budgets. |
| [`threejs-ambient-contact-shading`](threejs-ambient-contact-shading/SKILL.md) | Ambient contact shading, AO/GTAO, bent normals, bilateral reconstruction, and depth-grounded indirect visibility. |
| [`threejs-bloom`](threejs-bloom/SKILL.md) | HDR bloom, selective emissive contribution, BloomNode controls, resolution-scale budgets, and effect isolation. |
| [`threejs-exposure-color-grading`](threejs-exposure-color-grading/SKILL.md) | GPU luminance metering, eye adaptation, tone mapping, LUT grading, and output color ownership. |
| [`threejs-image-pipeline`](threejs-image-pipeline/SKILL.md) | Shared depth, normals, albedo, emissive, velocity, history, pass ordering, and final RenderPipeline assembly. |

### Worlds and Environments

| Skill | Use it for |
| --- | --- |
| [`threejs-sky-atmosphere-and-haze`](threejs-sky-atmosphere-and-haze/SKILL.md) | Sky scattering, aerial perspective, atmospheric haze, sun/moon discs, scattering LUTs, and atmosphere-aware lighting. |
| [`threejs-volumetric-clouds`](threejs-volumetric-clouds/SKILL.md) | Weather-shaped cloud density, bounded raymarching, temporal reconstruction, cloud shadows, and quality tiers. |
| [`threejs-spectral-ocean`](threejs-spectral-ocean/SKILL.md) | FFT oceans, spectral cascades, whitecaps, foam, above/below-water optics, and large-water validation. |
| [`threejs-water-optics`](threejs-water-optics/SKILL.md) | Bounded water, local ripples, heightfield simulation, caustics, depth refraction, absorption, Fresnel, and crest foam. |
| [`threejs-rain-snow-and-wet-surfaces`](threejs-rain-snow-and-wet-surfaces/SKILL.md) | Rain, snow, accumulation, wetness, puddles, ripple normals, splashes, and shared weather envelopes. |

### Procedural Content

| Skill | Use it for |
| --- | --- |
| [`threejs-procedural-fields`](threejs-procedural-fields/SKILL.md) | Shared scalar/vector fields, domain warping, masks, procedural normals, storage bakes, and CPU/GPU parity. |
| [`threejs-procedural-materials`](threejs-procedural-materials/SKILL.md) | NodeMaterial PBR identities, triplanar/atlas filtering, specular AA, terrain wetness, lava, emissive surfaces, and dissolve. |
| [`threejs-procedural-geometry`](threejs-procedural-geometry/SKILL.md) | Semantic mesh writers, indexed BufferGeometry, UV density, normals, material slots, BatchedMesh, and InstancedMesh choices. |
| [`threejs-procedural-buildings-and-cities`](threejs-procedural-buildings-and-cities/SKILL.md) | Building grammars, facades, profiles, ornaments, roofs, city chunks, and material-slot mesh compilation. |
| [`threejs-procedural-planets`](threejs-procedural-planets/SKILL.md) | Cube-sphere quadtree planets, crater fields, biome/climate masks, GPU displacement, analytic normals, and atmosphere handoff. |
| [`threejs-procedural-vegetation`](threejs-procedural-vegetation/SKILL.md) | Trees, grass, foliage, roots, branches, leaf cards, rooted wind, species presets, chunked LOD, and vegetation diagnostics. |

### Motion and Effects

| Skill | Use it for |
| --- | --- |
| [`threejs-procedural-motion-systems`](threejs-procedural-motion-systems/SKILL.md) | Launches, staging, spin docking, springs, rotating frames, detachments, transform timelines, and quaternion control. |
| [`threejs-particles-trails-and-effects`](threejs-particles-trails-and-effects/SKILL.md) | Particles, trails, plasma, wakes, sparks, debris, dense-swap effect pools, and scene-relative HDR emission. |
| [`threejs-dynamic-surface-effects`](threejs-dynamic-surface-effects/SKILL.md) | Frost, thaw, touch clearing, history ping-pong, decay/diffusion masks, reduced blur, and refraction surfaces. |
| [`threejs-black-holes-and-space-effects`](threejs-black-holes-and-space-effects/SKILL.md) | Black holes, accretion disks, wormholes, curved-ray integration, procedural star fields, and bounded space effects. |

## Generated Three.js Texture Assets and Validation Screenshots

Several skills include deterministic generated PNG texture variants under
`assets/generated-variants/`. These Three.js texture assets are repeatable
starting points for examples, diagnostics, and low-cost fallback demos; they are
not final art direction. Agents can use these generated assets directly from the
skill folder when that keeps a demo simple, or replace/regenerate them on
request when the user wants a different style, resolution, channel contract, or
domain-specific look.

The contact sheet is an overview index only. The validation screenshots below
are the reviewable evidence for the families currently covered by skill-local
domain gates: water caustic fields, rain ripple normal maps, and procedural
planet crater masks.

![Contact sheet of 30 deterministic Three.js generated texture assets for water caustics, ocean wave seeds, cloud weather maps, rain ripple normals, frost crystals, lava cause maps, meadow density masks, star fields, biome fields, and planet crater masks](docs/generated-asset-contact-sheet.png)

| Skill | Suggested generated assets | Useful for |
| --- | --- | --- |
| [`threejs-water-optics`](threejs-water-optics/SKILL.md) | `caustic-field-{a,b,c}.png` | Caustic floor projection, shallow-water intensity fields, and diagnostics. |
| [`threejs-spectral-ocean`](threejs-spectral-ocean/SKILL.md) | `directional-wave-seed-{a,b,c}.png` | Preview height/slope seeds and ocean normal-debug experiments. |
| [`threejs-volumetric-clouds`](threejs-volumetric-clouds/SKILL.md) | `weather-map-{a,b,c}.png` | Packed RGBA coverage, cloud type/detail, vertical bias, and erosion inputs. |
| [`threejs-rain-snow-and-wet-surfaces`](threejs-rain-snow-and-wet-surfaces/SKILL.md) | `ripple-normal-{a,b,c}.png` | RGBA `NoColorSpace` ripple normals for wet asphalt, puddles, and fallback rain tiers. |
| [`threejs-dynamic-surface-effects`](threejs-dynamic-surface-effects/SKILL.md) | `frost-crystal-{a,b,c}.png` | Frost/thaw masks, crystalline structure targets, and refraction-normal derivation. |
| [`threejs-procedural-materials`](threejs-procedural-materials/SKILL.md) | `lava-cause-{a,b,c}.png` | Packed rock, crack, emission, and grain cause maps for material-channel debugging. |
| [`threejs-procedural-vegetation`](threejs-procedural-vegetation/SKILL.md) | `meadow-density-{a,b,c}.png` | Packed density, path, clump, and flower masks for grass and meadow placement. |
| [`threejs-black-holes-and-space-effects`](threejs-black-holes-and-space-effects/SKILL.md) | `starfield-tile-{a,b,c}.png` | Tileable star/debug backgrounds for space-effect prototypes. |
| [`threejs-procedural-fields`](threejs-procedural-fields/SKILL.md) | `biome-field-{a,b,c}.png` | Packed altitude, moisture, wear, and biome fields for CPU/GPU parity tests. |
| [`threejs-procedural-planets`](threejs-procedural-planets/SKILL.md) | `crater-mask-{a,b,c}.png` | RGBA `NoColorSpace` crater masks for reduced-tier spherical projection and material diagnostics. |

### Three.js Water Caustic Field Validation Screenshots

The water optics pilot validates generated caustic fields as reduced-tier
`NoColorSpace` data for shallow bounded-water floor projection. The screenshots
separate the dry floor, water without caustics, caustic-enabled variants,
caustic-only diagnostics, tiled seam stress, camera-distance checks, and
temporal caustic drift.

![Three.js WebGPU water caustic validation final design showing dry floor, water without caustics, generated caustic variants, and caustic-only projections](docs/visual-validation/water-generated-caustics/final.design.png)

Final design: compares dry and wet baselines with each generated caustic
variant and caustic-only contribution.

![Three.js WebGPU water caustic validation diagnostics mosaic showing tiled seam stress and source-channel views](docs/visual-validation/water-generated-caustics/diagnostics.mosaic.png)

Diagnostics mosaic: exposes tiled seam stress and source-channel behavior for
all caustic variants.

| Capture | Screenshot |
| --- | --- |
| Final design | [final.design.png](docs/visual-validation/water-generated-caustics/final.design.png) |
| No-post/baseline | [no-post.design.png](docs/visual-validation/water-generated-caustics/no-post.design.png) |
| Diagnostics mosaic | [diagnostics.mosaic.png](docs/visual-validation/water-generated-caustics/diagnostics.mosaic.png) |
| Near camera | [camera.near.png](docs/visual-validation/water-generated-caustics/camera.near.png) |
| Design camera | [camera.design.png](docs/visual-validation/water-generated-caustics/camera.design.png) |
| Far camera | [camera.far.png](docs/visual-validation/water-generated-caustics/camera.far.png) |
| Seed baseline | [seed-0001.final.png](docs/visual-validation/water-generated-caustics/seed-0001.final.png) |
| Stress seed | [seed-stress.final.png](docs/visual-validation/water-generated-caustics/seed-stress.final.png) |
| Temporal start | [temporal.t000.png](docs/visual-validation/water-generated-caustics/temporal.t000.png) |
| Temporal response | [temporal.t001.png](docs/visual-validation/water-generated-caustics/temporal.t001.png) |

### Three.js Rain Ripple Normal Validation Screenshots

The rain and wet-surfaces pilot validates generated ripple normal maps as
`NoColorSpace` wet-surface normal data. The screenshots show dry asphalt, wet
asphalt without ripples, wet asphalt with each ripple variant, normal-field
diagnostics, camera-distance checks, stress views, and temporal wetness gating.
This evidence is meant to teach how the `threejs-rain-snow-and-wet-surfaces`
skill applies generated ripple textures to a real material response.

![Three.js WebGPU rain ripple normal validation final design showing dry asphalt, wet baseline, ripple variants A B C, and normal-debug panels](docs/visual-validation/rain-generated-ripples/final.design.png)

Final design: compares dry asphalt, wet asphalt without ripple normals, wet
asphalt with each generated ripple-normal variant, and normal-map diagnostics.

![Three.js WebGPU rain ripple normal validation no-post baseline showing wetness gating before and after ripple-normal contribution](docs/visual-validation/rain-generated-ripples/no-post.design.png)

No-post baseline: proves the wet-surface response exists without relying on
post-processing or a single final beauty frame.

![Three.js WebGPU rain ripple normal validation diagnostics mosaic showing tiled seam stress and normal-field views for all ripple variants](docs/visual-validation/rain-generated-ripples/diagnostics.mosaic.png)

Diagnostics mosaic: exposes normal fields and tile-seam stress for every ripple
variant.

![Close camera screenshot of generated ripple-normal response on grazing wet asphalt in Three.js WebGPU validation](docs/visual-validation/rain-generated-ripples/camera.near.png)

Near camera: checks close inspection of wet asphalt highlight response.

![Design camera screenshot for generated rain ripple normal validation on wet asphalt in Three.js WebGPU](docs/visual-validation/rain-generated-ripples/camera.design.png)

Design camera: repeats the authored review framing for regression comparison.

![Far camera screenshot showing tiled generated ripple normal diagnostics for minified wet-surface validation](docs/visual-validation/rain-generated-ripples/camera.far.png)

Far camera: checks minified and tiled ripple-normal behavior.

![Seed baseline screenshot for generated Three.js rain ripple normal validation](docs/visual-validation/rain-generated-ripples/seed-0001.final.png)

Seed baseline: records the fixed deterministic seed used by the evidence
bundle.

![Stress screenshot for generated Three.js rain ripple normal validation with diagnostics and tiled seam pressure](docs/visual-validation/rain-generated-ripples/seed-stress.final.png)

Stress seed: increases tiling pressure so seam problems are visible.

![Temporal start screenshot for generated rain ripple normals before wetness reaches the ripple contribution threshold](docs/visual-validation/rain-generated-ripples/temporal.t000.png)

Temporal start: shows the wetness gate before ripple normals contribute.

![Temporal response screenshot for generated rain ripple normals after wetness activates the wet-surface normal response](docs/visual-validation/rain-generated-ripples/temporal.t001.png)

Temporal response: shows ripple normals only after the wetness state reaches the
normal-response band.

| Capture | Screenshot |
| --- | --- |
| Final design | [final.design.png](docs/visual-validation/rain-generated-ripples/final.design.png) |
| No-post/baseline | [no-post.design.png](docs/visual-validation/rain-generated-ripples/no-post.design.png) |
| Diagnostics mosaic | [diagnostics.mosaic.png](docs/visual-validation/rain-generated-ripples/diagnostics.mosaic.png) |
| Near camera | [camera.near.png](docs/visual-validation/rain-generated-ripples/camera.near.png) |
| Design camera | [camera.design.png](docs/visual-validation/rain-generated-ripples/camera.design.png) |
| Far camera | [camera.far.png](docs/visual-validation/rain-generated-ripples/camera.far.png) |
| Seed baseline | [seed-0001.final.png](docs/visual-validation/rain-generated-ripples/seed-0001.final.png) |
| Stress seed | [seed-stress.final.png](docs/visual-validation/rain-generated-ripples/seed-stress.final.png) |
| Temporal start | [temporal.t000.png](docs/visual-validation/rain-generated-ripples/temporal.t000.png) |
| Temporal response | [temporal.t001.png](docs/visual-validation/rain-generated-ripples/temporal.t001.png) |

### Three.js Procedural Planet Crater Mask Validation Screenshots

The procedural planet pilot validates generated crater-mask PNGs on spherical
and close-patch terrain views. The screenshots show that crater masks are used
as `NoColorSpace` data for projected planet material and diagnostics, not as
flat color thumbnails. This evidence is meant to teach how the
`threejs-procedural-planets` skill applies crater masks to spherical projection,
height/material response, channel diagnostics, and projection stress.

![Three.js procedural planet crater-mask validation final design showing crater variants on orbit-scale spheres and close terrain patches](docs/visual-validation/planet-generated-craters/final.design.png)

Final design: shows each generated crater-mask variant on orbit-scale spherical
views and close terrain patches.

![Three.js procedural planet crater-mask validation no-post baseline and diagnostics view](docs/visual-validation/planet-generated-craters/no-post.design.png)

No-post baseline: keeps crater interpretation reviewable without presentation
effects hiding weak geometry or material response.

![Three.js procedural planet crater-mask diagnostics mosaic showing crater channels and height-material views for generated variants](docs/visual-validation/planet-generated-craters/diagnostics.mosaic.png)

Diagnostics mosaic: exposes crater channel behavior and height/material views.

![Close camera screenshot of generated crater-mask displacement and material response on a procedural planet patch](docs/visual-validation/planet-generated-craters/camera.near.png)

Near camera: checks close crater-ring and floor/rim material response.

![Design camera screenshot for generated crater masks on procedural planet validation](docs/visual-validation/planet-generated-craters/camera.design.png)

Design camera: repeats the authored orbit and close-patch review framing.

![Far camera screenshot showing generated crater masks surviving orbit-scale procedural planet projection](docs/visual-validation/planet-generated-craters/camera.far.png)

Far camera: checks that crater masks remain legible at reduced orbit scale.

![Seed baseline screenshot for generated procedural planet crater-mask validation](docs/visual-validation/planet-generated-craters/seed-0001.final.png)

Seed baseline: records the deterministic crater-mask state used by the evidence
bundle.

![Projection stress screenshot for generated crater masks on procedural planet terrain diagnostics](docs/visual-validation/planet-generated-craters/seed-stress.final.png)

Stress seed: exposes channel/projection behavior under diagnostic pressure.

![State comparison start screenshot for generated crater-mask spherical projection validation](docs/visual-validation/planet-generated-craters/temporal.t000.png)

State start: captures the lower projection-scale state.

![State comparison response screenshot for generated crater-mask spherical projection stress validation](docs/visual-validation/planet-generated-craters/temporal.t001.png)

State response: captures the higher projection-scale stress state for comparison.

| Capture | Screenshot |
| --- | --- |
| Final design | [final.design.png](docs/visual-validation/planet-generated-craters/final.design.png) |
| No-post/baseline | [no-post.design.png](docs/visual-validation/planet-generated-craters/no-post.design.png) |
| Diagnostics mosaic | [diagnostics.mosaic.png](docs/visual-validation/planet-generated-craters/diagnostics.mosaic.png) |
| Near camera | [camera.near.png](docs/visual-validation/planet-generated-craters/camera.near.png) |
| Design camera | [camera.design.png](docs/visual-validation/planet-generated-craters/camera.design.png) |
| Far camera | [camera.far.png](docs/visual-validation/planet-generated-craters/camera.far.png) |
| Seed baseline | [seed-0001.final.png](docs/visual-validation/planet-generated-craters/seed-0001.final.png) |
| Stress seed | [seed-stress.final.png](docs/visual-validation/planet-generated-craters/seed-stress.final.png) |
| Temporal/state start | [temporal.t000.png](docs/visual-validation/planet-generated-craters/temporal.t000.png) |
| Temporal/state response | [temporal.t001.png](docs/visual-validation/planet-generated-craters/temporal.t001.png) |

## Repository Layout

Each skill is a standalone folder:

```text
threejs-skill-name/
  SKILL.md                 Required skill metadata and core guidance
  references/              Deeper technical guidance loaded only when needed
  examples/                Runnable or inspectable implementation examples
  assets/                  Visual assets used by examples or generated outputs
  review.md                Audit notes and improvement context where present
```

Top-level reports such as [`SKILL_QUALITY_BAR.md`](SKILL_QUALITY_BAR.md),
[`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md), and
[`FINAL_REPORT.md`](FINAL_REPORT.md) document the quality bar, review history,
and migration context for the pack.

## Requirements

- A skill-aware agent runtime such as Codex, Claude, or another compatible agent
  shell that can load local skill folders.
- Node.js for examples and local Three.js inspection.
- Three.js `^0.185.1` as pinned in [`package.json`](package.json).
- A browser/device with WebGPU support for full runtime validation.

Install package dependencies when working with examples:

```bash
npm install
```

## Validation

This repository does not currently ship a single top-level validation command.
After edits, run the checks that match the files you touched:

```bash
npm install
node threejs-choose-skills/examples/router-contract.test.mjs

find . -name node_modules -prune -o -name '*.mjs' -print \
  -exec node --check {} \;
```

A good change also checks:

- Skill folder name matches `name:` in `SKILL.md`.
- `SKILL.md` frontmatter has a precise `description:` trigger.
- Cross-skill links point to current folders.
- Examples still parse or run at their stated level.
- No obsolete WebGL path is presented as the flagship implementation.

## Design Philosophy

The skills are intentionally opinionated:

- Use plain names where possible so non-experts can find the right capability.
- Keep expert terms in descriptions and references where they help precision.
- Prefer one coherent visual mechanism over layered noise and post-processing.
- Keep compatibility work quarantined until explicitly requested.
- Treat validation evidence as part of the implementation, not polish at the end.

## Contributing

When adding or revising a skill:

1. Keep the name descriptive enough for a non-expert to discover it.
2. Keep `SKILL.md` concise and move deep technical material into `references/`.
3. Add examples only when they are runnable, inspectable, or directly useful.
4. Validate the skill metadata before committing.
5. Update this README when a skill is added, removed, or renamed.

## Status

This pack is actively evolving around current Three.js WebGPU and TSL APIs.
Treat checked-in skill files, references, examples, and validation notes as the
source of truth for project-specific behavior.
