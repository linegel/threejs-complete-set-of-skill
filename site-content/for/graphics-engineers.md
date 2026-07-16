---
kind: audience
slug: /for/graphics-engineers/
title: Three.js WebGPU Skills for Graphics Engineers
description: Architecture, TSL, WebGPU, resource ownership, and validation guidance for graphics engineers building serious Three.js rendering systems.
h1: Three.js WebGPU skills for graphics engineers
primary_query: three.js webgpu skills for graphics engineers
query_aliases: ["three.js rendering architecture agent skills","webgpu tsl workflow for graphics engineers"]
summary: Use the pack when the hard part is rendering architecture, choosing a causal algorithm, assigning resource ownership, composing WebGPU passes, and proving the result. It exposes assumptions instead of hiding them behind a visual preset.
related_skills: ["threejs-choose-skills","threejs-image-pipeline","threejs-visual-validation","threejs-debugging"]
related_demos: []
related_pages: ["/docs/choose-skills/","/agents/routing-and-minimal-context/","/compare/renderpipeline-vs-effectcomposer/","/compare/threejs-tsl-vs-glsl/","/compare/webgpurenderer-vs-webglrenderer/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-visual-validation/SKILL.md","https://threejs.org/manual/en/webgpurenderer"]
---

## Architecture begins with a truth contract

The router asks what the scene must preserve before it asks which effect to add. A product scene protects silhouette and variant identity. A scientific display protects units and transfer semantics. A cinematic scene protects shot intent and temporal coherence. That distinction determines the representation, resource graph, error bounds, and validation plan.

Use [Three.js WebGPU/TSL Choose Skills](/skills/threejs-choose-skills.html) to record the workload, observable, earliest missing layer, candidate algorithms, and rejected alternatives. The result should name one primary causal owner and a small set of consumers, not a bag of loosely related techniques.

## Build an ownership graph before a pass graph

Scene color, depth, normals, velocity, identifiers, histories, tone mapping, output conversion, and adaptive quality each need an owner or an explicit `not used` value. Matching names do not make signals shareable across cameras, resolutions, time samples, or encodings.

Use [Three.js Image Pipeline](/skills/threejs-image-pipeline.html) when the scene actually has shared consumers or final-output assembly. Keep one scene render when the required signals can come from one declared graph. Keep the final conversion exclusive: either the pipeline owns output conversion or an explicit `renderOutput()` node owns it. A second output transform is a correctness bug, not extra polish.

The [RenderPipeline versus EffectComposer comparison](/compare/renderpipeline-vs-effectcomposer/) covers the architectural decision. The [TSL versus GLSL comparison](/compare/threejs-tsl-vs-glsl/) covers the shader-authoring boundary.

## Select compute and MRT from evidence

Compute is useful when dense GPU-resident state, reuse, reduction, or synchronization behavior justifies dispatch and storage overhead. It is not automatically faster than a small CPU update. Likewise, MRT is useful only when named downstream consumers justify each attachment.

For every attachment, declare format, resolution, sample count, lifetime, producer, and consumers. Compare the composed minimal-forward and shared-MRT variants on target hardware. A desktop result does not settle tile-based mobile bandwidth behavior.

The [WebGPU image-pipeline demo](/demos/webgpu-image-pipeline/) is organized around output, normal, emissive, velocity, temporal, and final modes. Its checked correctness summary no longer matches the live source hash and must be regenerated before it is treated as current; it cannot support a current-adapter GPU-timing claim.

## Measure the composed system

Do not add standalone lab percentiles. CPU and GPU work can overlap, shared passes can be counted twice, and a new attachment can change the cost of existing work. Acceptance comes from the composed scene under a named browser, device, GPU, viewport, DPR, camera path, scene state, and quality tier.

Use [Three.js Visual Validation](/skills/threejs-visual-validation.html) to define fixed views, mechanism diagnostics, readback contracts, lifecycle checks, and mutation controls. The [native WebGPU validation harness](/demos/webgpu-validation-harness/) documents an aligned render-target readback, MRT, resource-ledger, timing, and artifact-validation contract. Its checked summary must be regenerated against the live source before citation as current evidence.

When GPU timestamp queries are unavailable, label GPU performance unmeasurable. CPU or presentation timing cannot be renamed as GPU evidence. `renderer.info` provides engine counters with exclusions; it is not measured VRAM or external-memory traffic.

## Diagnose source and version disagreements

Use [Three.js Debugging](/skills/threejs-debugging.html) when installed behavior, documentation, source, and an upstream issue appear to disagree. Verify the installed export map and implementation before copying a nearby-release example. The [native backend FAQ](/faq/how-do-i-verify-the-native-webgpu-backend/) covers the first runtime gate.

For existing projects, follow the [WebGPU adoption path](/for/threejs-developers-moving-to-webgpu/) rather than blending migration, architecture, and comparison queries into this page.

## What this page does not claim

The pack does not provide universal frame, memory, draw, triangle, or attachment budgets. It does not make an ambitious physical simulation valid merely because the code compiles. It also does not own generic asset ingestion, application state, UI, data transport, or physics-engine selection.

A lab bundle can support its declared mechanism only while its recorded source hash matches the source under review. It cannot be added to another bundle to predict a different composition. Final acceptance still requires project-specific target matrices, failure controls, sustained runs, and direct inspection of the important diagnostic and final artifacts.
