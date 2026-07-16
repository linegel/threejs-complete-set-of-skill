---
kind: technical-comparison
slug: /compare/threejs-tsl-vs-glsl/
title: Three.js TSL vs GLSL
description: Compare TSL and GLSL by renderer support, composition, compute, debugging, maintenance, and migration cost in Three.js r185.
h1: Three.js TSL vs GLSL
primary_query: threejs tsl vs glsl
query_aliases: ["tsl vs glsl threejs","three.js shading language vs glsl"]
summary: Use TSL for WebGPURenderer node materials, compute, and RenderPipeline composition. Keep GLSL where WebGLRenderer and an established shader estate own the workload.
related_skills: ["threejs-procedural-materials","threejs-image-pipeline","threejs-ambient-contact-shading","threejs-visual-validation"]
related_demos: ["webgpu-node-gtao"]
related_pages: ["/migrate/glsl-shadermaterial-to-tsl/","/compare/webgpurenderer-vs-webglrenderer/","/compare/renderpipeline-vs-effectcomposer/","/docs/use-in-an-existing-project/"]
supported_revision: 0.185.1
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://threejs.org/docs/TSL.html","https://threejs.org/manual/en/webgpurenderer","https://threejs.org/docs/pages/WebGLRenderer.html","https://github.com/mrdoob/three.js/releases/tag/r185","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-materials/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md"]
---

## Decision rule

Use TSL when WebGPURenderer, node materials, compute, storage, or RenderPipeline owns the feature. Keep GLSL when an existing WebGLRenderer application and its `ShaderMaterial`, `RawShaderMaterial`, addon shaders, or shader tooling remain the supported production path. Migrate for a renderer or architecture requirement, not because one syntax is newer.

This comparison assumes Three.js `0.185.1` in a browser application. Language choice does not change the project's world units or coordinate conventions. Those remain explicit application contracts.

## Mechanism comparison

| Criterion | TSL | GLSL in Three.js |
| --- | --- | --- |
| Authoring model | JavaScript functions and composable node graphs | Shader source supplied to WebGL materials or addons |
| Primary renderer path | WebGPURenderer and its node material system | WebGLRenderer custom shader path |
| Backend output | Node builders can generate WGSL for WebGPU and GLSL for WebGL 2 | Authored GLSL targets the WebGL shader path |
| Lighting integration | High-level material nodes can participate in Three.js lighting models | Custom shader authors own the relevant lighting implementation |
| Compute and storage | TSL exposes compute, storage, atomics, and related WebGPU-oriented nodes | Traditional WebGL shaders do not expose WebGPU compute through WebGLRenderer |
| Post-processing | TSL nodes compose into RenderPipeline | GLSL effects commonly enter a WebGL EffectComposer pass chain |
| Reuse | Graph functions can be composed across node materials and effects | Existing shader libraries, chunks, and team expertise may be extensive |
| Debug surface | Inspect node inputs, generated code, graph outputs, and diagnostics | Inspect authored shader source, uniforms, varyings, compile logs, and render targets |

TSL is not raw WGSL. The author describes a node graph and Three.js generates backend code. That abstraction enables composition and backend-aware generation, but it also changes debugging: the authored JavaScript graph and the generated shader are both relevant.

## Choose TSL when

- The application is moving to WebGPURenderer and custom materials must leave `ShaderMaterial` or `onBeforeCompile`.
- A feature needs WebGPU compute, storage buffers, storage textures, atomics, or a TSL render graph.
- Several materials or effects should share typed shader functions and high-level material properties.
- Post-processing needs RenderPipeline, MRT signals, node effects, or one explicit final output node.
- Backend generation is more valuable than direct ownership of handwritten shader source.

TSL is particularly useful when a material must preserve the built-in lighting model while replacing selected channels such as color, normal, roughness, metalness, emissive, or position. It is also the supported language for custom WebGPURenderer post effects described by the upstream manual.

## Keep GLSL when

- WebGLRenderer remains the product's supported renderer.
- A large, tested GLSL shader estate already owns the visual result.
- The application relies on WebGL addons, custom passes, or authoring tools that do not have an equivalent TSL path.
- Target browsers and devices are already served correctly by WebGL 2 and no WebGPU-specific mechanism is required.
- Migration risk exceeds the value of changing renderer architecture.

GLSL is not obsolete merely because TSL exists. The official WebGPURenderer manual still describes WebGLRenderer as maintained and recommended for pure WebGL 2 applications. A stable GLSL path can be the lower-risk engineering choice.

## Cost and performance accounting

The language name does not determine frame time. Measure the graph that each implementation produces.

| Cost | What to inspect |
| --- | --- |
| Compilation | Generated shader variants, graph complexity, authored GLSL variants, and warm-up behavior |
| Draw work | Draw calls, material variants, instancing, visibility, and pass count |
| Storage | Uniforms, textures, storage resources, MRT attachments, and history buffers |
| Bandwidth | Attachment formats, sampling, reconstruction, and full-screen passes |
| Maintenance | Source readability, team expertise, upstream churn, diagnostics, and test coverage |
| Migration | Custom materials, chunks, `onBeforeCompile`, pass code, tooling, and baseline capture |

A TSL implementation can be slower than a focused GLSL implementation if it allocates unused signals or adds unnecessary passes. A GLSL implementation can be harder to maintain if it duplicates lighting, color, or backend logic. Only the rendered workload and measured resources resolve that tradeoff.

## Combining them safely

TSL and GLSL can coexist at explicit application boundaries, such as separate WebGPURenderer and WebGLRenderer paths or a staged migration with independent baselines. Do not imply that an existing WebGL `ShaderMaterial` can be installed directly into WebGPURenderer. The upstream migration guidance says those custom-material paths must be ported to node materials and TSL.

During migration, keep the old path available long enough to compare fixed views and diagnostics. Avoid two renderers competing for the same final canvas or two systems applying tone mapping to one output.

## Migration sequence

1. Inventory shader inputs, coordinate spaces, uniforms, texture color spaces, defines, and renderer hooks.
2. Capture the GLSL baseline plus channel diagnostics and failure cases.
3. Port one bounded material or effect to TSL.
4. Reconnect built-in lighting through NodeMaterial channels where appropriate.
5. Verify the active backend, generated graph, final output, and negative controls.
6. Measure the actual passes, storage, bandwidth, and frame behavior before expanding.

The full procedure is in [GLSL ShaderMaterial to TSL](/migrate/glsl-shadermaterial-to-tsl/).

## Limitations

TSL APIs and generated output can change after r185, so recheck the installed revision. Generated-code abstraction can make shader debugging less direct. GLSL preserves direct source ownership but does not provide the WebGPURenderer node and compute model by itself.

Neither language fixes incorrect spaces, unbounded loops, unstable temporal state, double output transforms, or an unmeasured resource budget. Those remain architecture and validation responsibilities.
