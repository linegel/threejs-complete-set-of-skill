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
related_demos: []
related_pages: ["/for/technical-artists/","/for/graphics-engineers/","/docs/use-in-an-existing-project/","/compare/threejs-tsl-vs-glsl/","/faq/which-threejs-skill-should-i-use-first/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/references/router-recipes.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-materials/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-camera-controls-and-rigs/SKILL.md","https://threejs.org/manual/en/webgpurenderer"]
---

## Protect product truth before adding polish

The source of truth is the imported product hierarchy, stable part IDs, variant table, material definitions, and approved product data. A rendering change must preserve silhouette, part correspondence, visibility state, material response, and color intent across every supported configuration.

Start with [Choose Skills](/skills/threejs-choose-skills.html) and classify the workload as an identity-sensitive product configurator. Reject procedural replacement geometry when the imported silhouette is authoritative. Reject bloom or AO as a repair for incorrect materials, lighting, or color management.

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

The [camera-rig demo](/demos/webgpu-camera-rig/) documents fixed view routes and intended camera checks. Its checked summary no longer matches the live source hash and must be regenerated before citation as current evidence. It does not establish the usability of a product viewer that has not been tested with its users.

## Keep the presentation graph minimal

Use [Three.js Image Pipeline](/skills/threejs-image-pipeline.html) for scene and final-output ownership. Start with scene color and presentation. Add depth, normals, velocity, identifiers, or history only after a named consumer is accepted. A persistent identifier attachment may be unnecessary if on-demand picking satisfies the interaction contract.

Tone mapping and display conversion need one owner. Exposure changes can alter perceived product color, so the project must define whether exposure is fixed, adapted, or constrained. The [exposure and color demo](/demos/webgpu-exposure-color-pipeline/) documents its intended metering mechanism, but its checked summary no longer matches the live source hash and cannot support current correctness or performance claims.

General studio lighting, IBL, PMREM, reflection probes, and cube-capture design are not owned by a current expert skill. Use official Three.js and project lighting guidance. Material, shadow, and image-pipeline skills consume lighting; they do not invent a product-lighting contract.

## Validate the actual buying and inspection states

Use [Three.js Visual Validation](/skills/threejs-visual-validation.html) to capture fixed product views, material diagnostics, variant sweeps, no-post and final output, color and output ledgers, reset behavior, and lifecycle evidence. Measure variant-change and interaction latency on the named target matrix. Preserve identity, picking, silhouette, and color gates before reducing visual cost.

For integration details, read [use the pack in an existing project](/docs/use-in-an-existing-project/). Technical artists can continue with the [technical-artist path](/for/technical-artists/), while rendering ownership questions belong to the [graphics-engineer path](/for/graphics-engineers/).

## What this page does not claim

The pack does not own product data, commerce logic, availability rules, analytics, UI, accessibility, customer research, or conversion measurement. It does not own source-asset preparation, general lighting design, or production content approval.

There is no accepted real-customer configurator, complete variant-sweep case study, sales-lift result, or universal performance result in the repository. Local material, camera, and color captures are mechanism evidence. Product acceptance requires the real hierarchy, approved references, variant catalog, target devices, interaction states, and business-owned correctness gates.
