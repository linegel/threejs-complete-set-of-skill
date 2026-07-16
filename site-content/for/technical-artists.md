---
kind: audience
slug: /for/technical-artists/
title: Three.js WebGPU and TSL Skills for Technical Artists
description: Material, procedural form, motion, camera, and final-image guidance for technical artists working in Three.js WebGPU and TSL.
h1: Three.js WebGPU and TSL skills for technical artists
primary_query: three.js skills for technical artists
query_aliases: ["three.js tsl workflow for technical artists","procedural three.js skills for technical artists"]
summary: Use the pack to translate a visual target into inspectable causes such as silhouette, material response, motion, camera, lighting signals, and final output. Each layer can be authored and diagnosed before downstream effects are added.
related_skills: ["threejs-choose-skills","threejs-procedural-materials","threejs-procedural-geometry","threejs-object-sculptor","threejs-procedural-motion-systems","threejs-camera-controls-and-rigs","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["webgpu-procedural-timelines","webgpu-tower-ship-sculptor"]
related_pages: ["/docs/use-in-an-existing-project/","/compare/threejs-tsl-vs-glsl/","/industries/product-visualization-and-configurators/","/for/graphics-engineers/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-materials/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-geometry/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-object-sculptor/SKILL.md","https://threejs.org/docs/TSL.html"]
---

This pack is a strong fit for technical artists who can work directly in a Three.js repository and need to translate a visual target into inspectable geometry, material, motion, camera, and final-image causes. It helps an agent preserve the reference contract instead of hiding a weak source signal under post-processing.

## Strong fit

- You author or direct procedural form, TSL materials, staged motion, cameras, or final-image behavior in code.
- You need repeatable reference views and diagnostics that distinguish silhouette, material response, motion, framing, and output changes.
- You can define what must remain authoritative: a product silhouette, a reference image, an authored motion beat, or a perceptual final-image target.

## Poor fit

- You need no-code tooling, beginner JavaScript lessons, generic prompt snippets, or a turnkey game engine.
- The work is primarily DCC asset production, mesh repair, UV unwrapping, baking, compression, or source-asset LOD creation.
- You need pixel-identical reconstruction, a general asset-import pipeline, or a complete studio-lighting/IBL/PMREM workflow; the pack does not claim those outcomes.

## Three recurring jobs

1. **Author surface identity — [`threejs-procedural-materials`](/skills/threejs-procedural-materials.html).** Own the BRDF and material channels first; add filtering, specular antialiasing, triplanar or atlas behavior, wetness, emission, or dissolves only when the target requires them.
2. **Build code-native form — [`threejs-procedural-geometry`](/skills/threejs-procedural-geometry.html) and [`threejs-object-sculptor`](/skills/threejs-object-sculptor.html).** Use the geometry skill when vertices, topology, normals, UVs, or groups own the result; use the sculptor only for quality-gated procedural reconstruction from a reference.
3. **Stage motion and framing — [`threejs-procedural-motion-systems`](/skills/threejs-procedural-motion-systems.html) and [`threejs-camera-controls-and-rigs`](/skills/threejs-camera-controls-and-rigs.html).** Make transform phases, springs, projection, orbit, inspection views, and handoffs reproducible rather than tuning them per screenshot.

The [TSL versus GLSL comparison](/compare/threejs-tsl-vs-glsl/) owns the shader-authoring choice. This page owns the technical-artist fit and workflow.

## Representative workflow: turn a reference into an inspectable animated object

1. State the task in visual causes: preserve the reference silhouette and material identity, add one authored motion beat, and provide fixed near, design, profile, and far views.
2. Freeze Three.js `0.185.1`/r185, `WebGPURenderer`, initialized backend, browser/GPU, reference revision, object scale, camera matrices, seed, viewport, and DPR.
3. Establish a no-post silhouette baseline. Change geometry only where geometry owns the mismatch; keep authoritative CAD, scanned, or supplied meshes authoritative.
4. Author material channels and inspect albedo, roughness, normals, emission, filtering, shadow parity, and the no-post image before adding bloom, grading, or other consumers.
5. Add deterministic motion and fixed camera routes, then capture the baseline, mechanism diagnostics, motion states, and final output. Accept only the declared reference and behavior claims; keep pixel identity and unmeasured performance outside the verdict.

The [procedural timelines demo](/demos/webgpu-procedural-timelines/) exposes launch, spin, debris, quaternion, interpolation, and compute-storage mechanisms under fixed routes. Its current report passes the mechanism claim while visual correctness and lifecycle remain insufficient and GPU timing is not claimed. The [tower-ship sculptor demo](/demos/webgpu-tower-ship-sculptor/) has a source-matched accepted report for its semantic object, renderer, route, and readback contract; it does not prove a different reference reconstruction or product workflow. Local images are mechanism captures, not customer work.

## Constraints

| Constraint | Required boundary |
| --- | --- |
| Renderer | Canonical WebGPU/TSL claims require `WebGPURenderer` from `three/webgpu` with a confirmed native WebGPU backend. |
| Three.js revision | The pack targets r185; this repository resolves `three@0.185.1`. Recheck installed APIs and material/node behavior after revision changes. |
| Agent | The coding agent must be able to inspect source, edit the real project, run the project's commands, and open captured artifacts. The skills do not replace art direction. |
| Browser and device | Record the target browser, OS, GPU, viewport, DPR, input behavior, and required WebGPU features. Motion correctness alone does not prove target performance. |
| Expertise | Expect working TypeScript/JavaScript, Three.js scene/material knowledge, coordinate-space awareness, and the ability to judge reference and diagnostic images. |

Post-processing cannot repair the wrong outline, a broken BRDF, missing shadow transport, or an unstable camera. Bloom needs HDR emission, AO needs justified signals, and final output needs one explicit conversion owner.

## Start here

Use the [installation guide](/docs/install/) to add the pack, then begin the first visual task with `threejs-choose-skills` so the earliest missing cause is selected before implementation.
