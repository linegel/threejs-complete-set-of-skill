---
name: threejs-choose-skills
description: Choose the smallest expert skill set for ambitious Three.js WebGPU/TSL visual work. Use for WebGPURenderer scenes, TSL/NodeMaterial graphics rewrites, node post pipelines, compute/storage systems, reference matching, or requests spanning geometry, materials, atmosphere, shadows, temporal effects, and final image treatment.
---

# Three.js WebGPU/TSL Choose Skills

This pack teaches one implementation path: latest Three.js r185-era `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, `NodeMaterial` families, node post pipelines, and compute/storage where the algorithm benefits. Route only after the renderer, backend, ownership, and performance architecture are known.

Fallback for unavailable WebGPU is not part of this router's destination-skill
guidance. If, and only if, the user explicitly asks how to apply fallback when
WebGPU is unavailable, route that teaching to
`$threejs-compatibility-fallbacks` after the canonical owner skill is known. Do
not route unrelated target-support or tuning work there.

## Mandatory WebGPU Preflight

Do this before loading any destination skill:

1. Record the installed Three.js revision and check the matching migration guide for the release band.
2. Initialize `WebGPURenderer` and record the backend, target browser/device/GPU class, canvas size, pixel ratio, and whether the authored feature uses TSL nodes, compute, storage textures/buffers, MRT, node post, or built-in nodes.
   - If the backend cannot support the canonical feature and the user explicitly asked how to apply fallback when WebGPU is unavailable, load `$threejs-compatibility-fallbacks`.
   - If the user did not explicitly ask how to apply fallback when WebGPU is unavailable, keep the flagship route and report the missing requirement as a blocker.
3. Choose the highest-throughput architecture first: compute/storage for simulation or dense instance state, MRT to share depth/normal/velocity/albedo data, temporal/reduced-resolution passes for expensive screen effects, `BatchedMesh`/`InstancedMesh`/LOD/chunk culling for scale, adaptive DPR for pressure, and shader warmup with `renderer.compileAsync()`.
4. Assign early ownership for shared resources: one depth source, one normal/velocity source, one history source, one tone-map owner, one output color conversion owner, and one place that adapts resolution.
5. Define the performance budget before implementation: target frame time, pass count, draw calls, triangle/instance counts, dispatch counts, storage sizes, render-target memory, texture memory, and permitted quality tiers.

### Pre-Route Cause Ledger

Write this ledger before selecting image or post-processing skills:

```yaml
physicalCause: ""                 # authored mechanism that creates the visible result
missingSignal: ""                 # geometry/material/light/field/simulation signal not yet present
noPostBaseline: ""                # what must remain readable with bloom/AO/grading disabled
postProcessingRejectedBecause: "" # why a post effect would hide, not solve, the gap
primaryVisualContract: ""         # one sentence that acceptance evidence must prove
```

Route image effects only after the source signal exists. If `physicalCause` or
`missingSignal` is unknown, select the subject-generation owner first and defer
post-processing.

### Route Manifest

Every route decision must produce a structured manifest:

```yaml
selectedSkills: []
omittedSkills: []
primaryOwner: ""
deferredSkills: []
sharedResourceOwners:
  gbuffer: ""
  depth: ""
  normal: ""
  velocity: ""
  history: ""
  weatherEnvelope: ""
  toneMap: ""
  outputTransform: ""
  adaptiveResolution: ""
acceptanceEvidence:
  requiredDebugViews: []
  requiredMetrics: []
  requiredCommands: []
  requiredArtifacts: []
```

`selectedSkills` must be the smallest expert set that can author the requested
mechanism. `omittedSkills` records tempting but unnecessary skills and why they
were not loaded. `primaryOwner` is the skill that owns the first non-post visual
mechanism. `deferredSkills` are loaded only after their input signal exists.
Every recipe and route manifest must carry the same `sharedResourceOwners` keys
shown above, using an explicit empty or not-used value when the route does not
consume that shared resource.

### Preflight Checkpoint Outputs

Treat preflight as data, not prose:

| Checkpoint | Required output |
| --- | --- |
| backendManifest | Three.js revision, initialized backend, browser/device/GPU class, `getOutputBufferType()`, feature flags, and blocker if unavailable |
| routeManifest | `selectedSkills`, `omittedSkills`, `primaryOwner`, `deferredSkills`, `sharedResourceOwners`, `acceptanceEvidence` |
| ownershipMap | depth, normal, velocity, history, weather, tone-map, output-transform, and adaptive-resolution owners |
| budgetTable | frame ms, pass count, draw calls, triangles/instances, dispatches, storage bytes, render-target bytes |
| debugViewList | no-post baseline plus every field/pass needed to prove the mechanism |
| capabilityBlocker | missing backend/API/format/performance condition that blocks the canonical path |
| rejectionReason | why an attractive but wrong route was rejected |
| assert | executable grep, script, screenshot, or evidence-bundle check that proves the route contract |

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer( {
  antialias: false,
  outputBufferType: THREE.HalfFloatType
} );

await renderer.init();

const capabilities = {
  revision: THREE.REVISION,
  webgpu: renderer.backend.isWebGPUBackend,
  outputBufferType: renderer.getOutputBufferType(),
  rendererInfo: renderer.info
};

if ( renderer.backend.isWebGPUBackend ) {
  // Canonical path: TSL + NodeMaterial + RenderPipeline + compute/storage as needed.
} else {
  throw new Error(
    'Canonical flagship route requires WebGPU; if fallback teaching was explicitly requested, route to $threejs-compatibility-fallbacks.'
  );
}
```

Legacy WebGL implementation (deprecated, do not extend): none in this router folder.

## Architecture Gates

- Renderer and materials: use `WebGPURenderer`, TSL, and `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, `MeshBasicNodeMaterial`, `SpriteNodeMaterial`, or sibling node materials.
- Post stack: use `RenderPipeline`, `pass()`, `mrt()`, `renderOutput()`, and `PassNode.setResolutionScale()`; plan shared MRT outputs before individual effects.
- Compute/storage: use `renderer.compute()` or `renderer.computeAsync()` with `Fn().compute(count)`, `StorageTexture`, `StorageBufferAttribute`, `StorageInstancedBufferAttribute`, `storage()` nodes, `textureStore()`, and barriers/atomics when the algorithm requires synchronization.
- Built-in nodes first: route to the owner skill with `GTAONode`, `BloomNode`, `TRAANode`, `DepthOfFieldNode`, `CSMShadowNode`, `TileShadowNode`, and sky/fog nodes as the first baseline when they cover the need.
- Scale primitives: choose `BatchedMesh` for many unique static meshes sharing compatible material state, `InstancedMesh` or storage-instanced attributes for repeated dynamic populations, chunked LOD/culling for fields, and adaptive DPR for sustained pressure.

### r185 API Proof Table

Every named r18x API in a route needs `apiProof` from installed source or
official docs before coding; do not guess current APIs.

| API | Import path / proof target |
| --- | --- |
| `WebGPURenderer`, `RenderPipeline` | `three/webgpu`; verify in installed source before use |
| `pass`, `mrt`, `renderOutput` | `three/tsl`; verify in installed source before use |
| `ao` / `GTAONode` | `three/addons/tsl/display/GTAONode.js` |
| `bloom` / `BloomNode` | `three/addons/tsl/display/BloomNode.js` |
| `traa` / `TRAANode` | `three/addons/tsl/display/TRAANode.js` |
| `dof` / `DepthOfFieldNode` | `three/addons/tsl/display/DepthOfFieldNode.js` |
| `CSMShadowNode` | `three/addons/csm/CSMShadowNode.js` |
| `TileShadowNode` | `three/addons/tsl/shadows/TileShadowNode.js` |
| `PassNode.setResolutionScale()` | installed `PassNode` source or official docs |

Record `apiProof` in the route manifest when an implementation depends on one
of these APIs.

## WebGPU Quality Tiers

Every routed implementation defines explicit tiers inside the canonical WebGPU/TSL architecture:

| Tier | Use when | Required degradation |
| --- | --- | --- |
| Full | `renderer.backend.isWebGPUBackend` is true and budgets hold | All authored compute/storage, MRT, temporal history, and node post paths enabled. |
| Budgeted | Frame time or memory exceeds budget | Lower DPR, lower pass resolution with `setResolutionScale()`, fewer raymarch steps/samples, smaller simulation grids, sparser LOD, and update amortization. |
| Minimum viable | WebGPU exists but the target GPU is below budget | Keep the same architecture while reducing density, resolution, history length, update cadence, and optional passes. |

Do not define alternate-renderer tiers here. Use
`$threejs-compatibility-fallbacks` only for an explicit request to teach how to
apply fallback when WebGPU is unavailable.

## Performance Budgets

Use these starting budgets unless the product target is stricter:

| Target | Frame | GPU budget | Typical constraints |
| --- | --- | --- | --- |
| Desktop discrete | 60 Hz | 10-12 ms GPU, 2-4 ms CPU submit | 3-6 full-res passes, 2-6 reduced passes, <= 300 visible draws before batching, <= 256 MB transient render targets. |
| Desktop integrated | 60 Hz | 6-8 ms GPU, 2 ms CPU submit | 2-4 full-res passes, quarter/half-res expensive effects, <= 120 visible draws, <= 128 MB transient render targets. |
| Mobile or thermally constrained | 30-60 Hz | 4-7 ms GPU, 1.5 ms CPU submit | 1-2 full-res passes, aggressive DPR, sparse updates, <= 80 visible draws, <= 64 MB transient render targets. |

Record measured `renderer.info`, draw calls, triangles, texture/render-target counts, dispatch sizes, storage sizes, and frame-time evidence before acceptance.

## Composed-scene budget aggregation

### Routing preflight

Before composing a route, enumerate the actually available `threejs-*` skills in
the live inventory. Compare that inventory against this roster from the current
workspace:

- `threejs-ambient-contact-shading`
- `threejs-black-holes-and-space-effects`
- `threejs-bloom`
- `threejs-camera-controls-and-rigs`
- `threejs-choose-skills`
- `threejs-compatibility-fallbacks`
- `threejs-dynamic-surface-effects`
- `threejs-exposure-color-grading`
- `threejs-image-pipeline`
- `threejs-particles-trails-and-effects`
- `threejs-procedural-buildings-and-cities`
- `threejs-procedural-creatures`
- `threejs-procedural-fields`
- `threejs-procedural-geometry`
- `threejs-procedural-materials`
- `threejs-procedural-motion-systems`
- `threejs-procedural-planets`
- `threejs-procedural-vegetation`
- `threejs-rain-snow-and-wet-surfaces`
- `threejs-scalable-real-time-shadows`
- `threejs-sky-atmosphere-and-haze`
- `threejs-spectral-ocean`
- `threejs-visual-validation`
- `threejs-volumetric-clouds`
- `threejs-water-optics`

If the live inventory and roster differ, route only to the intersection and
surface the divergence in `routeManifest.rejectionReason`. Do not guess renamed,
deprecated, or missing siblings. If a required owner is absent from the
intersection, mark the route blocked or reduce the scope to retained owners.

### Aggregation rule

A composed scene must declare one `frameBudgetMs` before skill selection. Use
`16.6 ms` for `60 Hz`, `8.3 ms` for `120 Hz`, or `33.3 ms` for `30 Hz` unless
the brief gives a stricter budget; these are `floor((1000 ms / Hz) * 10) / 10`.

For every selected skill, the route manifest must cite the selected tier row and
sum that row's published cost-range maximum. If one selected row publishes
multiple required ranges, add the maxima. Add one fixed overhead line for shared
composition work:

```yaml
budgetAggregation:
  frameBudgetMs:
  selectedSkillMaxima: []
fixedOverhead:
  scenePassMs: 0.5
  sharedUpsamplesMs: 0.5
  totalMs: 1.0 # 0.5 + 0.5
aggregateMs:
routeValid:
```

The composed route is invalid when:

```text
sum(selectedSkillPublishedMaxMs) + fixedOverhead.totalMs > frameBudgetMs
```

When invalid, downgrade deterministically and recompute after each step:

1. post-effects internals: AO denoise/history, bloom scale, TAA/DoF, optional
   grading/LUT cadence, and optional history branches;
2. volumetrics: cloud march scale, step counts, shadow maps, update cadence;
3. water: FFT grid, cascade count, spray, refraction, and shading tier;
4. crowds: creature count, shell tier, outline, and update cadence.

If a selected skill has no published cost row for the proposed downgrade, do
not assign a cheaper number. Keep the previous maximum, record the missing table
entry, and continue to the next downgrade owner.

### Worked aggregation example

Input route: top-tier horizon ocean, Ultra clouds, desktop creature crowd, and
full post at `60 Hz`. The declared budget is `16.6 ms` because
`floor((1000 / 60) * 10) / 10 = 16.6`.

Published rows used:

- `$threejs-spectral-ocean`, `Budgets`, row `High desktop discrete`: target
  `2.5-4.0 ms simulation` and `1.5-3.0 ms ocean shading/post at 1440p`;
  aggregate maximum `4.0 + 3.0 = 7.0 ms`.
- `$threejs-volumetric-clouds`, `Quality Tiers And Budgets`, row
  `Ultra desktop-discrete`: target cost `2.5-4.0 ms`; maximum `4.0 ms`.
- `$threejs-procedural-creatures`, `Performance Budgets`, row
  `Desktop discrete`: frame budget `0.5-1.5 ms`; maximum `1.5 ms`.
- `$threejs-image-pipeline`, `Budgets`, row `Desktop discrete`: full post
  frame cost `2.0-4.0 ms at 1440p`; maximum `4.0 ms`.
- Router fixed overhead: `0.5 ms scene pass + 0.5 ms shared upsamples = 1.0 ms`.
  Both `0.5 ms` inputs are authored planning placeholders, not measured or
  validator-gated costs: replace them with the composed scene's own measured
  scene-pass and upsample timings (from `$threejs-visual-validation` GPU timing
  evidence) before trusting any aggregate within `1 ms` of the budget line.

Initial aggregate:

```text
7.0 ocean + 4.0 clouds + 1.5 creatures + 4.0 full post + 1.0 overhead = 17.5 ms
17.5 ms > 16.6 ms, so the route is invalid.
```

Downgrade order check:

1. Post-effects internals: `$threejs-image-pipeline` publishes no cheaper
   named full-post tier in its `Budgets` table, so keep `4.0 ms` and record the
   missing lower row.
2. Volumetrics: downgrade `$threejs-volumetric-clouds` from
   `Ultra desktop-discrete` to `High desktop-discrete`; the `Quality Tiers And
   Budgets` row publishes `1.8-3.0 ms`, maximum `3.0 ms`.

Valid aggregate after the first published downgrade:

```text
7.0 ocean + 3.0 clouds + 1.5 creatures + 4.0 full post + 1.0 overhead = 16.5 ms
16.5 ms <= 16.6 ms, so the route is valid.
```

### Tier-exclusion matrix at 16.6 ms

These combinations are invalid at `60 Hz` with the fixed `1.0 ms` composition
overhead because the sum of published maxima exceeds `16.6 ms`.

| Combination | Published max sum | Status |
| --- | ---: | --- |
| `$threejs-spectral-ocean` High desktop discrete (`4.0 + 3.0 = 7.0`) + `$threejs-volumetric-clouds` Ultra desktop-discrete (`4.0`) + `$threejs-image-pipeline` Desktop discrete full post (`4.0`) + `$threejs-procedural-creatures` Desktop discrete crowd (`1.5`) + overhead (`1.0`) | `17.5 ms` | invalid |
| `$threejs-spectral-ocean` High desktop discrete (`7.0`) + `$threejs-volumetric-clouds` Ultra desktop-discrete (`4.0`) + `$threejs-image-pipeline` Desktop discrete full post (`4.0`) + `$threejs-ambient-contact-shading` Desktop discrete denoise/temporal AO (`2.0`) + overhead (`1.0`) | `18.0 ms` | invalid |
| `$threejs-spectral-ocean` High desktop discrete (`7.0`) + `$threejs-volumetric-clouds` Ultra desktop-discrete (`4.0`) + `$threejs-image-pipeline` Desktop discrete full post (`4.0`) + `$threejs-ambient-contact-shading` Desktop discrete scalar GTAO (`1.2`) + `$threejs-procedural-creatures` Desktop discrete crowd (`1.5`) + overhead (`1.0`) | `18.7 ms` | invalid |

Source rows: `$threejs-spectral-ocean` `Budgets`, row
`High desktop discrete`; `$threejs-volumetric-clouds`
`Quality Tiers And Budgets`, rows `Ultra desktop-discrete` and
`High desktop-discrete`; `$threejs-image-pipeline` `Budgets`, row
`Desktop discrete`; `$threejs-procedural-creatures` `Performance Budgets`, row
`Desktop discrete`; `$threejs-ambient-contact-shading` `Performance Budgets`,
row `Desktop discrete`.

### Fauna and ocean handoff

For creature swimmers in a spectral ocean route:

- `$threejs-spectral-ocean` owns water height, displacement derivative, foam,
  and current queries. `$threejs-procedural-creatures` consumes a sampled
  swimmer contact interface; it does not recompute FFT spectra or own wave
  phase.
- `$threejs-procedural-creatures` owns body shell, gait/swim locomotion, pose
  storage, crowd tier, and species variant cache.
- `$threejs-scalable-real-time-shadows` owns the shared shadow clipmap when
  routed. Creatures cast into that clipmap; do not allocate per-creature shadow
  maps.
- `$threejs-image-pipeline` owns MRT, outline inputs, velocity, normal, history,
  tone map, and output transform. Creature outlines use the shared post edge or
  MRT signal owner, not a second outline graph.

## Color And Output Rules

- Mark color textures as `SRGBColorSpace`; data maps such as normal, roughness, masks, noise, LUTs, weather, and simulation textures stay `NoColorSpace` or linear.
- Keep HDR working buffers as `HalfFloatType` until the single tone-map step.
- The node pipeline owns final conversion through `renderOutput()` and `outputColorTransform`; individual materials and effects must not double-convert.
- Decide mipmap generation per data texture. Do not auto-generate mipmaps for storage outputs unless the sampling path actually needs them.

## Route By Authored System

| Required result | Load | Tie-breaker |
| --- | --- | --- |
| shot composition, chase/side/orbit rigs, camera handoffs, projection ownership, pointer look, floating origins | `$threejs-camera-controls-and-rigs` | Load before subject skills when framing changes silhouette, scale, or temporal validity. |
| launch and docking timelines, procedural transform phases, springs, staging, rotating-frame alignment, debris motion | `$threejs-procedural-motion-systems` | Use for transform authorship; use effects only when the visible result is event energy, trails, or particles. |
| reusable scalar/vector fields, domain warping, causal masks, procedural normals | `$threejs-procedural-fields` | Use when several outputs share one cause; use materials when the field only shades a surface. |
| atlas-filtered blocks, planetary surfaces, terrain wetness, lava/emissive procedural surfaces, authored frame PBR, specular AA | `$threejs-procedural-materials` | Use for BRDF/material identity; pair with fields for shared masks and geometry for actual silhouette changes. |
| sculpted rails/frames, branch rings, semantic mesh writers, material groups | `$threejs-procedural-geometry` | Use when vertices, normals, UV density, or material slots must be authored. |
| trees, stylized grass, GPU-computed grass, branching organisms, roots, foliage, rooted wind deformation | `$threejs-procedural-vegetation` | Use for biological distribution/growth/wind; pair with fields only for terrain or biome control. |
| procedural creatures, fauna, NPCs, spec-driven bodies, SDF blend-shell skins, capsule rigs, gait/hop/flight/swim locomotion, creature crowds, creature labs | `$threejs-procedural-creatures` | Use for living-actor bodies and locomotion; use motion systems for generic transform timelines, vegetation for plants; imported skinned-clip pipelines stay a declared gap. |
| buildings, facade grammars, profiles, ornaments, modular mesh writers | `$threejs-procedural-buildings-and-cities` | Use for authored building grammar; use geometry for general mesh construction without architectural semantics. |
| planets, terrain, craters, biome fields, coastlines, spherical detail | `$threejs-procedural-planets` | Use for planetary terrain/body ownership; pair with atmosphere only after body scale and horizon are fixed. |
| sky scattering, planetary shells, depth-based aerial perspective | `$threejs-sky-atmosphere-and-haze` | Use for air/sky/light transport; use image pipeline only for final exposure and color ownership. |
| weather-driven raymarched clouds and cloud shadows | `$threejs-volumetric-clouds` | Use for volumetric density and temporal march; use precipitation for particles or surface wetness. |
| FFT oceans, hybrid FFT/Gerstner clear water, stylized above/below ocean optics, spectral cascades, choppy derivatives, Jacobian whitecaps | `$threejs-spectral-ocean` | Use for large-water wave spectra and horizon-scale water; use water optics for bounded pools or local interactions. |
| authored analytic waves, bounded heightfield pools, object ripples, differential-area caustics, ray-traced pool volume optics, shared normals, heuristic refraction, absorption, crest foam | `$threejs-water-optics` | Use for local/bounded water and optical coupling; use temporal surfaces for screen-history masks without physical water. |
| falling snow, snow accumulation, model snow caps, wet asphalt puddles, procedural ripple normals, splash flipbooks, rain streaks, shared weather envelopes, surface wetness | `$threejs-rain-snow-and-wet-surfaces` | Use for weather particles plus affected surfaces; route puddle optics to water when refraction/caustics dominate. |
| curved-ray black holes, accretion disks, wormholes | `$threejs-black-holes-and-space-effects` | Use for bounded curved-ray integration; route exposure/bloom separately after HDR signal is correct. |
| particles, trails, plasma, shockwaves, layered event effects | `$threejs-particles-trails-and-effects` | Use for time-local energy and particles; route motion mechanics to animation when object transforms drive the result. |
| accumulated screen frost, touch clearing, reduced blur, and refraction masks | `$threejs-dynamic-surface-effects` | Use for screen-space history surfaces; use materials or precipitation when the effect is object/world anchored. |
| real-time shadows for dynamic or large scenes, cascades, tiles, cached updates | `$threejs-scalable-real-time-shadows` | Use built-in `CSMShadowNode`/`TileShadowNode` first; custom cached clipmaps only for streaming worlds with invalidation budgets. |
| GTAO, bent normals, bilateral reconstruction | `$threejs-ambient-contact-shading` | Use `GTAONode` baseline; route to image pipeline when depth/normal/MRT ownership is not yet planned. |
| HDR bloom and selective emission contribution | `$threejs-bloom` | Use `BloomNode` baseline; route to exposure/color grading when bloom strength depends on tone-map/exposure policy. |
| eye adaptation, tone mapping, LUT grading, output color | `$threejs-exposure-color-grading` | Use when the question changes luminance measurement, tone-map ownership, LUTs, or output conversion. |
| shared depth/normal/velocity ownership, MRT, history, node pass ordering, final pipeline assembly | `$threejs-image-pipeline` | Plan early for shared buffers; load late again for final image treatment after the no-post baseline reads. |
| fixed-view diagnostics, seed sweeps, temporal stability, GPU budgets, regression evidence | `$threejs-visual-validation` | Use for any ambitious scene before acceptance, especially compute, temporal, or adaptive-resolution work. |

## Execution Order

For a new procedural scene:

1. Run the mandatory WebGPU preflight, capability gate, quality-tier choice, performance budget, and color/output ownership.
2. Define a visual contract: subject, scale, camera distance, motion, target devices, target frame time, and no-post readability.
3. Load `$threejs-camera-controls-and-rigs` when framing, lens, camera frame, or mode transitions affect the target.
4. Load the subject-generation skill and any required field/material/geometry owner.
5. Add `$threejs-procedural-motion-systems` when object motion requires authored phases, moving frames, or spring convergence.
6. Plan `$threejs-image-pipeline` early if depth, normal, velocity, MRT, history, tone mapping, or adaptive resolution will be shared.
7. Add lighting, shadows, atmosphere, and weather only after silhouette and material masks read without effects.
8. Add atomic image effects only when the authored scene emits the signal they need.
9. Use `$threejs-image-pipeline` for final node pass ordering and `$threejs-visual-validation` for deterministic evidence.

## Routing Constraints

- Do not load a skill for generic API setup. The router itself owns the r185-era WebGPU/TSL baseline check, then destination skills own domain algorithms.
- Do not route "make it beautiful" directly to post processing. Find the missing authored system or missing physical signal.
- Prefer one strong, inspectable visual rule over several independent noise layers.
- When adapting a supplied reference, preserve the mechanism that creates its character. Do not reduce it to a generic effect category.
- Keep source-space, world-space, and screen-space systems separate unless the composition explicitly requires coupling.
- If no retained skill matches, state that the pack lacks expert coverage for that system and use official Three.js docs without inventing a pseudo-owner.
- Unsupported/common gaps unless a new skill is added: asset optimization pipelines, WebXR interaction design, deployment, UI overlays, editor tooling, physics engines, and generic app architecture.
- Teaching how to apply fallback when WebGPU is unavailable is not a general gap; it is owned by `$threejs-compatibility-fallbacks` and stays out of flagship destination skills unless the user explicitly asks for it.

## Space And Owner Handoff

Every destination handoff must label:

| Interface | Required label |
| --- | --- |
| source-space | object/local/growth/field/simulation coordinates that authored the signal |
| world-space | Three.js Y-up world units and any floating-origin offset |
| view-space | camera-space convention, including camera `-Z` and normal encoding |
| clip-space | projection owner, jitter owner, and depth range |
| NDC | normalized device coordinates and screen origin assumption |
| UV | UV origin, wrap mode, and whether deltas are UV or pixels |
| texel | texel-center rule, physical pixel size, and DPR scaling |
| depth convention | standard, reversed, logarithmic, orthographic, or resolved MSAA depth |
| color domain | `SRGBColorSpace`, scene-linear HDR, tone-mapped linear, display-referred sRGB, or data/no-color |
| owner boundary | which skill writes the signal and which skill may consume it |

## Route-Away Ledger

Use route-away entries when the request is outside this pack's expert scope:

| Request area | Route-away decision |
| --- | --- |
| asset pipeline | Use official Three.js/glTF/KTX2/Meshopt/DRACO docs or a future asset skill; do not stretch a visual skill into packaging ownership. |
| WebXR | Use official WebXR and Three.js docs unless a dedicated skill exists. |
| UI overlays | Keep DOM/app UI outside flagship graphics skills; only route UI-safe compositing to image-pipeline when it affects color/output ownership. |
| deployment | Use deployment/platform docs; do not load graphics skills for hosting or bundling. |
| editor tooling | Use editor/tooling docs or project conventions. |
| physics engines | Use a physics engine or project-local integration; route visual effects only after physical state is available. |
| generic app architecture | Keep framework/state/router decisions outside this visual skill pack. |
| Teaching how to apply fallback when WebGPU is unavailable | Use `$threejs-compatibility-fallbacks` only when the user explicitly asks how to apply fallback when WebGPU is unavailable. |

## Acceptance Gate

A routed task is incomplete until the implementation exposes:

- installed Three.js revision, initialized backend, target browser/device/GPU class, and migration-guide check;
- deterministic seed or reproducible inputs;
- explicit Full/Budgeted/Minimum viable quality tiers and the condition that selects each tier;
- visual debug modes for controlling fields, intermediate buffers, and shared MRT/history outputs;
- parameters grouped by perceptual role;
- no-post baseline that still reads;
- color texture/data texture `colorSpace`, HDR buffer type, tone-map owner, output conversion owner, and proof of no double conversion;
- `renderer.info`, draw calls, triangles, texture/render-target counts, dispatch counts, storage sizes, and measured frame-time evidence;
- validation screenshots or fixed-view captures for the target tiers.
