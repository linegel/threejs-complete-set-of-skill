---
kind: industry
slug: /industries/product-visualization-and-configurators/
title: Three.js WebGPU for Product Visualization and Configurators
description: Build product viewers and configurators that preserve part identity, materials, inspection behavior, and color-managed Three.js WebGPU output.
h1: Three.js WebGPU for product visualization and configurators
primary_query: three.js webgpu product configurator
query_aliases: ["three.js product visualization with webgpu","three.js webgpu configurator rendering"]
summary: Use the pack to preserve product truth through rendering including exact part and variant identity, stable silhouette, material response, inspection behavior, and color-managed output. Preserve the authoritative product hierarchy instead of replacing it.
related_skills: ["threejs-procedural-materials","threejs-camera-controls-and-rigs","threejs-image-pipeline","threejs-exposure-color-grading","threejs-visual-validation","threejs-choose-skills"]
related_demos: ["webgpu-camera-rig"]
related_pages: ["/for/technical-artists/","/for/graphics-engineers/","/docs/use-in-an-existing-project/","/compare/threejs-tsl-vs-glsl/","/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/references/router-recipes.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-materials/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-camera-controls-and-rigs/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-exposure-color-grading/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-visual-validation/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/visual-validation/webgpu-camera-rig/evidence-summary.json","https://threejs.org/manual/en/webgpurenderer"]
---

## Protect product truth before adding polish

The source of truth is the imported product hierarchy, stable part IDs, variant table, material definitions, and approved product data. A rendering change must preserve silhouette, part correspondence, visibility state, material response, and color intent across every supported configuration.

Start with [Choose Skills](/skills/threejs-choose-skills.html) and classify the workload as an identity-sensitive product configurator. Reject procedural replacement geometry when the imported silhouette is authoritative. Reject bloom or AO as a repair for incorrect materials, lighting, or color management.

## Use a concrete reference workload

The reference workload is one imported product assembly with stable SKU and part IDs, a finite variant catalog, material and visibility swaps, orbit/zoom inspection, click or tap selection, a deterministic reset view, neutral no-post output, and a final color-managed presentation. Treat one world unit as one metre after asset conversion, camera distance and bounds in metres, control and adaptation time in seconds, interaction latency in milliseconds, texture dimensions in pixels, and resident/upload cost in bytes.

The workload contract is:

- The product-information or commerce system owns the allowed variant record. Rendering receives one immutable variant revision at a time.
- Every rendered node maps to a stable product part ID. Material or visibility changes may not silently change that correspondence.
- Approved silhouette, part presence, material assignment, neutral color reference, selection result, and camera reset pose are acceptance gates.
- The target matrix names browser, device/GPU class, physical canvas size, DPR, input modes, display/color assumptions, asset-cache state, and memory ceiling.
- The representative sequence loads the base assembly, applies each supported variant transition, selects a part, frames it, resets the camera, resizes the view, and tears the viewer down.

This is a workload definition, not evidence that the repository contains a customer configurator.

## Assign product and rendering ownership explicitly

| Cause or state | Primary owner | Consumes | Must not own |
|---|---|---|---|
| SKU, option rules, compatibility, availability, price, transaction | Product/commerce application | Catalog and business data | Render graph or scene-derived guesses |
| Imported hierarchy, stable part mapping, asset lifecycle | Product asset layer | glTF/CAD conversion output | Procedural replacement of authoritative shape |
| Selection, annotations, DOM controls, analytics, accessibility | Application interaction/UI layer | Stable part IDs and user intent | Camera or material state through hidden side effects |
| Material coordinates, causes, PBR channels, dynamic variant state | [Procedural Materials](/skills/threejs-procedural-materials.html) | Approved maps, material identity, world or art-unit scale | Lighting design or product option rules |
| Inspection pose, projection, framing, handoff, reset | [Camera Controls and Rigs](/skills/threejs-camera-controls-and-rigs.html) | Product bounds, active part target, control intent | Selection truth or multiple simultaneous camera writers |
| Shared targets, optional ID/depth/normal signals, graph mutation, presentation | [Image Pipeline](/skills/threejs-image-pipeline.html) | Scene-linear product render and named consumers | Adding attachments without a consumer |
| Exposure, tone map, grading, output conversion | [Exposure and Color Grading](/skills/threejs-exposure-color-grading.html) | Declared scene-linear source and color contract | Repairing wrong source materials or lighting |
| Captures, variant sweeps, color diagnostics, resource and lifecycle verdicts | [Visual Validation](/skills/threejs-visual-validation.html) | Frozen catalog revision and target matrix | Declaring product approval on its own |
| Studio lighting, IBL/PMREM, reflection probes | Project lighting owner and official Three.js guidance | Approved lighting references | Being inferred from material or post-processing skills |

## Bind variants without rebuilding the product

The application product layer should own SKU, part, option, dependency, compatibility, availability, and transaction state. The rendering layer consumes an immutable variant state and applies material or visibility changes to stable hierarchy nodes.

Preserve part identity through hide, show, swap, and material changes. Avoid rebuilding geometry for an ordinary variant transaction. Keep picking and selection in the application interaction layer, with an explicit mapping between visible render objects and authoritative product IDs.

A useful validation sweep enumerates supported variants from fixed cameras and checks required parts, forbidden parts, material assignments, silhouette bounds, selection correspondence, and reset behavior. This evidence must come from the actual product project; the skill repository does not contain a complete customer configurator.

## Prove material response under neutral output

Use [Three.js Procedural Materials](/skills/threejs-procedural-materials.html) when the missing cause is material identity, filtering, normal response, roughness, emission, or another surface channel. Keep a no-post view where the product can be judged without AO, bloom, or grading.

The material skill supplies implementation rules and failure conditions, but this page does not attach an unrelated material demo as product proof. A real configurator still needs neutral reference captures, approved material targets, and a variant sweep from its own assets.

Imported glTF and CAD preparation remains authoritative. Do not use procedural geometry to replace a validated product mesh. Compression, mesh repair, UVs, texture baking, source-asset LOD, KTX2, Meshopt, and DRACO remain asset-pipeline concerns outside this route.

## Make inspection behavior predictable

Use [Three.js Camera Controls and Rigs](/skills/threejs-camera-controls-and-rigs.html) for orbit, inspection, scale-aware framing, projection and depth, handoff, and reset. Define product bounds, allowed views, target anchors, zoom limits, pointer behavior, collision rules, and the exact reset pose.

The [camera-rig demo](/demos/webgpu-camera-rig/) has source-matched accepted evidence for its fixed view routes and camera checks. It does not establish the usability of a product viewer that has not been tested with its users.

## Keep the presentation graph minimal

Use [Three.js Image Pipeline](/skills/threejs-image-pipeline.html) for scene and final-output ownership. Start with scene color and presentation. Add depth, normals, velocity, identifiers, or history only after a named consumer is accepted. A persistent identifier attachment may be unnecessary if on-demand picking satisfies the interaction contract.

Tone mapping and display conversion need one owner. Exposure changes can alter perceived product color, so the project must define whether exposure is fixed, adapted, or constrained. The [exposure and color demo](/demos/webgpu-exposure-color-pipeline/) has source-matched accepted evidence for its metering, adaptation, tone-map, LUT, and output mechanisms. Named-adapter GPU timing and lifecycle remain insufficient, and the report does not validate this product's color.

General studio lighting, IBL, PMREM, reflection probes, and cube-capture design are not owned by a current expert skill. Use official Three.js and project lighting guidance. Material, shadow, and image-pipeline skills consume lighting; they do not invent a product-lighting contract.

The complete scene-cause-to-image path is:

```text
catalog variant revision + stable part IDs
  -> imported hierarchy visibility/material bindings
  -> approved textures, geometry, material causes, and project-owned lighting
  -> inspection camera and selection highlight with one active owner each
  -> scene-linear product color + only the depth/normal/ID signals with consumers
  -> fixed or constrained exposure
  -> one tone map and one output conversion
  -> physical canvas pixels
```

Selection flows back through the stable render-object-to-part mapping into the DOM UI; it is not inferred from the final image. Each arrow needs a revision, lifetime, reset condition, and failure state so an asynchronous asset or option change cannot combine two catalog revisions in one frame.

## Trade presentation quality against named resources

Product truth is not a quality lever. A tier may reduce pixels, reflection updates, shadows, post effects, texture residency, or geometric detail only while preserving the declared part identity, allowed configuration, silhouette tolerance, material class, selection correspondence, and output ownership.

| Lever | Named resource cost | Safe decision rule |
|---|---|---|
| Geometry and LOD | Vertex/index bytes, upload time, vertex work, acceleration/culling structures, and simultaneous LOD residency during a transition | Use source-authored LOD with a silhouette-error gate; never generate a cheaper shape that changes approved product geometry |
| Texture resolution and format | Resident texel bytes, mip residency, decode/upload work, sampler bandwidth; an uncompressed full mip chain is approximately `width × height × bytes per texel × 4/3` before API padding | Preserve approved material identity and neutral-reference error; choose KTX2 or another project-owned delivery format deliberately |
| DPR and scene scale | Physical pixel count, depth/color/ID attachments, fill, and bandwidth scale with rendered width × height | Lower resolution only while textural detail, edge quality, and selection feedback remain legible on the target display |
| Shadows and reflections | Shadow depth targets, caster submissions, cube or probe faces, update cadence, and residency | Spend them only where they communicate form or material truth; lighting remains a project owner |
| Picking path | Persistent ID attachment and write bandwidth versus CPU raycast or an on-demand narrow pass | Choose from selection frequency, hierarchy complexity, transparency, instancing, and latency requirement |
| Exposure and post | Meter reductions, temporal state, LUT/meter textures, additional passes and histories | Prefer fixed exposure for stable catalog comparison unless an automatic meter has an explicit source, mask, bounds, and reset |
| Variant readiness | Peak simultaneous geometry/texture residency versus decode/upload stalls during a swap | Preload only the variant set justified by the memory ceiling; present a defined loading state rather than a mixed configuration |

A useful three-policy ledger is:

| Policy | Reduce | Preserve |
|---|---|---|
| Reference capture | Nothing needed for approval; use approved assets, neutral output, fixed camera, and declared display assumptions | Exact hierarchy, materials, silhouette, selection map, and color reference |
| Interactive inspection | DPR, shadow/reflection update cadence, optional post, or nonselected detail according to measured pressure | Current variant truth, selected-part feedback, camera response, and final color contract |
| Constrained device | Source-authored LOD, texture mip residency, shadows/reflections, temporal branches, and preloaded variant count | Stable IDs, valid option state, silhouette threshold, material class, keyboard/touch access, and correct output conversion |

## Close deployment, lifecycle, and accessibility constraints

- **Browser and device:** initialize `WebGPURenderer` before allocating dependent resources and prove the backend for each claimed target. Decide separately whether a WebGL route is required. Record physical pixels, DPR, texture limits, memory ceiling, color/display assumptions, touch capability, and behavior under device loss.
- **Assets:** normalize source units and axes; preserve hierarchy and IDs through glTF/CAD conversion; own mesh repair, UVs, tangents, texture baking, KTX2, Meshopt, DRACO, LODs, licensing, cache keys, and integrity checks in the asset pipeline.
- **Controls:** define mouse, touch, pen, and keyboard orbit/zoom/select behavior; avoid relying on hover; prevent page scroll and viewer gestures from fighting; expose a deterministic reset and visible focus; keep exactly one camera writer.
- **Lifecycle:** version and cancel asynchronous loads, prevent old variants from committing after a newer choice, define cache eviction, resize/DPR transactions, route teardown, device-loss recreation, and disposal of geometry, textures, render targets, controls, listeners, and observers.
- **Accessibility:** provide the full option and part-selection workflow in semantic DOM controls; use accessible names and keyboard order; never communicate availability or selection only through material color, outline, or animation; provide reduced-motion inspection and useful static product imagery or text alternatives. The pack does not supply this application layer.

## Validate the actual buying and inspection states

Use [Three.js Visual Validation](/skills/threejs-visual-validation.html) to capture fixed product views, material diagnostics, variant sweeps, no-post and final output, color and output ledgers, reset behavior, and lifecycle evidence. Measure variant-change and interaction latency on the named target matrix. Preserve identity, picking, silhouette, and color gates before reducing visual cost.

For integration details, read [use the pack in an existing project](/docs/use-in-an-existing-project/). Technical artists can continue with the [technical-artist path](/for/technical-artists/), while rendering ownership questions belong to the [graphics-engineer path](/for/graphics-engineers/).

## Know when another route is better

Use pre-rendered stills or image spins when the catalog has fixed views and 3D interaction does not change the buying decision. Use offline or server-rendered reference imagery for color-critical approval that cannot depend on an unknown consumer display. Use a CAD/B-rep viewer when exact topology, tolerances, sectioning, measurement, or engineering metadata matters more than real-time presentation. Use a hosted commerce-viewer service when turnkey catalog ingestion, analytics, CDN operation, and support matter more than a custom render graph. Use a WebGL renderer when the required browser matrix cannot mandate WebGPU and the project accepts the different rendering path.

## What this page does not claim

The pack does not own product data, commerce logic, availability rules, analytics, UI, accessibility, customer research, or conversion measurement. It does not own source-asset preparation, general lighting design, or production content approval.

There is no accepted real-customer configurator, complete variant-sweep case study, sales-lift result, or universal performance result in the repository. The related camera-rig evidence is current and accepted for its camera mechanisms only, so this page does not use it as a product hero. The current exposure/color report proves its own captured mechanisms, not this product's material accuracy or presentation. Product acceptance requires the real hierarchy, approved references, variant catalog, target devices, interaction states, and business-owned correctness gates.
