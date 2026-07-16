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
related_demos: ["webgpu-image-pipeline","webgpu-validation-harness"]
related_pages: ["/docs/choose-skills/","/agents/routing-and-minimal-context/","/compare/renderpipeline-vs-effectcomposer/","/compare/threejs-tsl-vs-glsl/","/compare/webgpurenderer-vs-webglrenderer/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-visual-validation/SKILL.md","https://threejs.org/manual/en/webgpurenderer"]
---

This pack is a strong fit for graphics engineers who already work in Three.js and need an agent to reason about WebGPU/TSL architecture, resource ownership, and falsifiable acceptance criteria. It exposes assumptions instead of hiding them behind a visual preset.

## Strong fit

- You need to choose a causal rendering architecture before allocating passes, compute work, MRT attachments, or histories.
- Multiple consumers share depth, normals, velocity, identifiers, temporal state, or final-output policy.
- Correctness, GPU attribution, resource use, or lifecycle claims must be tied to a named target and inspectable evidence.

## Poor fit

- You need no-code 3D, beginner JavaScript instruction, a turnkey game engine, or generic prompt snippets.
- The project is a fixed WebGL recipe collection with no planned WebGPU/TSL adoption.
- The main problem is asset ingestion, application state, UI, data transport, or physics-engine selection; this pack does not own those systems.

## Three recurring jobs

1. **Choose the causal architecture — [`threejs-choose-skills`](/skills/threejs-choose-skills.html).** Record the protected observable, units, coordinate frame, target matrix, earliest missing cause, candidate mechanisms, and rejected alternatives.
2. **Own shared passes and final presentation — [`threejs-image-pipeline`](/skills/threejs-image-pipeline.html).** Name each attachment's format, resolution, sample count, lifetime, producer, and consumers. Keep one scene render when the declared graph already exposes the required signals, and keep exactly one tone-map/output path.
3. **Turn claims into evidence — [`threejs-visual-validation`](/skills/threejs-visual-validation.html).** Freeze the run, capture only the diagnostics that isolate each claim, use aligned readback or timestamp queries where required, and label unavailable evidence `unmeasurable`.

The [RenderPipeline versus EffectComposer comparison](/compare/renderpipeline-vs-effectcomposer/) owns that architecture decision; the [TSL versus GLSL comparison](/compare/threejs-tsl-vs-glsl/) owns the shader-authoring decision.

## Representative workflow: add a shared WebGPU image pipeline

1. Define the task as a protected observable, such as stable product identity under AO, bloom, temporal accumulation, and grading—not “add more effects.”
2. Record Three.js `0.185.1`/r185, `WebGPURenderer`, the initialized backend, browser, GPU, viewport, DPR, fixed camera path, scene state, and acceptance bounds.
3. Route the earliest missing cause, then declare scene color, depth, normals, velocity, histories, and final-output ownership before adding consumers.
4. Implement the smallest composed graph. Compare minimal-forward and shared-MRT variants on the target hardware; do not infer mobile bandwidth behavior from a desktop result.
5. Capture no-post, contribution, final, resource-ledger, lifecycle, and any required timing evidence from that composition. Accept the task only when each bound has direct evidence or is explicitly narrowed.

The [WebGPU image-pipeline demo](/demos/webgpu-image-pipeline/) has source-matched accepted evidence for output, normal, emissive, velocity, temporal, and final diagnostics in its captured graph; current-adapter GPU timing and lifecycle claims remain insufficient. The [native WebGPU validation harness](/demos/webgpu-validation-harness/) has source-matched accepted evidence for aligned render-target readback, MRT, resource-ledger, timing, and artifact-validation mechanics. Neither report proves a different project composition.

## Constraints

| Constraint | Required boundary |
| --- | --- |
| Renderer | Canonical claims require `WebGPURenderer` from `three/webgpu` with `renderer.backend.isWebGPUBackend === true`. |
| Three.js revision | The pack targets r185; this repository resolves `three@0.185.1`. Installed source and runtime `THREE.REVISION` remain authoritative. |
| Agent | Use a coding agent that can read repository rules and source, run project commands, and inspect generated artifacts. The pack is not an agent runtime. |
| Browser and device | Record the exact browser, OS, GPU, viewport, DPR, and supported WebGPU features. One target cannot establish another target's behavior. |
| Expertise | Expect working knowledge of TypeScript/JavaScript, Three.js render architecture, GPU resources, coordinate spaces, and measurement limits. |

There are no universal frame, memory, draw, triangle, or attachment budgets. `renderer.info` is an engine counter with exclusions, not measured VRAM, and CPU or presentation timing is not GPU timing.

## Start here

Use the [installation guide](/docs/install/) to add the pack to the repository, then start the first multi-system task with `threejs-choose-skills`.
