# Three.js WebGPU Skill Pack

Specialized Codex skills for building ambitious Three.js scenes with a modern
WebGPU and TSL-first architecture.

This repository is not a generic Three.js tutorial. It is a practical skill
pack for agents that need to design, implement, debug, and validate advanced
real-time graphics systems: atmospheres, oceans, procedural worlds, particles,
camera rigs, post-processing pipelines, shadows, water, clouds, and GPU-backed
surface effects.

## Why This Exists

Complex Three.js scenes fail when every visual system is treated as isolated
code. A believable ocean needs sky reflection, exposure, validation, and camera
scale. A rain scene needs particles, wet surfaces, puddle optics, shadows, and
post-processing ownership. A black-hole scene needs curved-ray integration,
HDR signal discipline, bloom, and fixed-view diagnostics.

These skills encode those boundaries so Codex can choose the right expert
guidance without loading everything at once.

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

Use the chooser first when the request spans more than one rendering system:

```text
Use $threejs-choose-skills to plan a WebGPU/TSL scene with an ocean at sunset,
volumetric clouds, camera flythrough, bloom, exposure, and validation.
```

Then load the specific skills it routes to:

```text
Use $threejs-spectral-ocean and $threejs-sky-atmosphere-and-haze to build the
water and sky systems, then use $threejs-image-pipeline and
$threejs-visual-validation to assemble and verify the final frame.
```

For a single focused task, invoke that skill directly:

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

## Repository Layout

Each skill is a standalone folder:

```text
threejs-skill-name/
  SKILL.md                 Required skill metadata and core guidance
  agents/openai.yaml       UI display name, summary, and default prompt
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

- Codex or another skill-aware agent runtime.
- Node.js for examples and local Three.js inspection.
- Three.js `^0.185.1` as pinned in [`package.json`](package.json).
- A browser/device with WebGPU support for full runtime validation.

Install package dependencies when working with examples:

```bash
npm install
```

## Validation

Validate each skill folder after edits:

```bash
for dir in threejs-*; do
  [ -f "$dir/SKILL.md" ] || continue
  python3 /path/to/skill-creator/scripts/quick_validate.py "$dir"
done
```

A good change also checks:

- Skill folder name matches `name:` in `SKILL.md`.
- `agents/openai.yaml` default prompt mentions the exact `$skill-name`.
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
