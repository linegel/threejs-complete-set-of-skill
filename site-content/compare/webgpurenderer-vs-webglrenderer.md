---
kind: technical-comparison
slug: /compare/webgpurenderer-vs-webglrenderer/
title: Three.js WebGPURenderer vs WebGLRenderer
description: Choose a Three.js renderer by backend, materials, compute, post-processing, compatibility, migration cost, and measured workload behavior.
h1: Three.js WebGPURenderer vs WebGLRenderer
primary_query: threejs webgpurenderer vs webglrenderer
query_aliases: ["webgpu renderer vs webgl renderer threejs","threejs webgpu vs webgl renderer"]
summary: Use WebGPURenderer for TSL, node materials, compute, or RenderPipeline when the migration is justified. Keep WebGLRenderer for pure WebGL 2 applications and established legacy stacks.
related_skills: ["threejs-compatibility-fallbacks","threejs-debugging","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["browser-fallback-harness","webgpu-validation-harness"]
related_pages: ["/migrate/webglrenderer-to-webgpurenderer/","/faq/how-do-i-verify-the-native-webgpu-backend/","/compare/renderpipeline-vs-effectcomposer/","/compare/threejs-tsl-vs-glsl/"]
supported_revision: 0.185.1
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://threejs.org/manual/en/webgpurenderer","https://threejs.org/docs/pages/WebGPURenderer.html","https://threejs.org/docs/pages/WebGLRenderer.html","https://github.com/mrdoob/three.js/releases/tag/r185","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-compatibility-fallbacks/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/labs/runtime/canonical-webgpu.mjs"]
---

## Decision rule

Use WebGPURenderer when the application needs TSL node materials, WebGPU compute or storage, or its RenderPipeline and the team can absorb migration and compatibility risk. Keep WebGLRenderer when pure WebGL 2 is sufficient, an established GLSL and EffectComposer stack owns the product, or the target workload has not proved a benefit from migration.

WebGPURenderer can use a WebGL 2 fallback backend. The renderer object's name is therefore not proof of native WebGPU execution. Verify the actual backend before making a WebGPU claim.

This page assumes Three.js `0.185.1` and a browser application. It makes no universal performance claim.

## Architecture comparison

| Criterion | WebGPURenderer | WebGLRenderer |
| --- | --- | --- |
| Default backend | Tries WebGPU when supported and can fall back to WebGL 2 | WebGL 2 rendering path |
| Imports | Commonly uses `three/webgpu` and `three/tsl` | Commonly uses `three` plus addons |
| Initialization | WebGPU setup is asynchronous; use `setAnimationLoop()` or await `init()` when needed | Traditional WebGL initialization path |
| Custom materials | NodeMaterial and TSL path | `ShaderMaterial`, `RawShaderMaterial`, shader chunks, and `onBeforeCompile` ecosystem |
| Compute and storage | Exposes TSL compute and WebGPU-oriented storage capabilities | Does not expose WebGPU compute through the WebGL renderer |
| Post-processing | RenderPipeline and TSL node effects | EffectComposer and addon pass chain |
| Fallback | May run through its WebGL 2 backend | Already targets WebGL 2 |
| Maturity | Official manual describes it as experimental and improving | Maintained and recommended upstream for pure WebGL 2 applications |
| Migration surface | Materials, renderer hooks, post effects, initialization, diagnostics, and backend proof | No renderer migration when the application already uses it |

Most familiar renderer methods have equivalents, but that does not make the migration mechanical. Custom shaders and post-processing are the largest architectural boundaries.

## Choose WebGPURenderer when

- A required feature uses TSL compute, storage resources, node materials, or RenderPipeline.
- The project is investing in the current Three.js WebGPU architecture rather than preserving a WebGL-only design.
- Custom materials can be ported from GLSL or `onBeforeCompile` to NodeMaterial channels.
- Target browsers, devices, and deployment conditions can be tested with explicit backend reporting.
- The team can validate missing features, performance behavior, and fallback conditions per release.

WebGPURenderer is also the relevant path when one TSL graph should generate code for its available backend. That portability should not be confused with a guarantee that the native WebGPU backend is active.

## Keep WebGLRenderer when

- The application is intentionally a pure WebGL 2 product.
- Existing `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile`, or EffectComposer code is large and stable.
- A required addon or feature is not ready on the WebGPU path.
- Current target devices behave better on the established WebGL renderer for the measured workload.
- The migration would consume engineering time without enabling a required product capability.

The official manual states that WebGLRenderer remains maintained and recommended for pure WebGL 2 applications. It also notes that no large new features are planned there. Those facts create a planning tradeoff, not an automatic deadline to migrate.

## Backend identity and fallback

A correct backend check distinguishes at least three states:

1. WebGPURenderer with a native WebGPU backend.
2. WebGPURenderer using its WebGL 2 fallback backend.
3. WebGLRenderer.

Report the renderer, backend, adapter or device evidence available to the harness, and any force-fallback setting. If native WebGPU is required and unavailable, do not silently present fallback output as proof of WebGPU execution. The [native backend FAQ](/faq/how-do-i-verify-the-native-webgpu-backend/) gives the exact verification route.

## Cost and performance

Do not compare renderer names with one headline FPS number. Hold scene content, camera, resolution, pixel ratio, output format, effects, warm-up, and measurement interval constant. Record the actual backend and device.

Relevant costs include:

- draw calls, geometry, material variants, and CPU submission;
- render and compute passes;
- attachment formats, samples, storage, and bandwidth;
- history buffers and invalidation;
- shader compilation and pipeline warm-up;
- readback and diagnostic overhead;
- fallback-specific behavior.

WebGPU can enable compute and pipeline designs that are unavailable through WebGLRenderer. It can also lose for a particular scene, browser, driver, or immature feature path. Only measured workload evidence resolves the choice.

## Migration sequence

1. Inventory renderer imports, initialization, materials, `onBeforeCompile`, post passes, render targets, readbacks, and browser requirements.
2. Capture a WebGL baseline with final and diagnostic views.
3. Establish a minimal WebGPURenderer path and prove the active backend.
4. Port one bounded custom material or effect to TSL.
5. Rebuild post-processing under one RenderPipeline output owner.
6. Compare correctness, failure conditions, and measured resource cost.
7. Expand only after the target device matrix passes.

Use the complete [WebGLRenderer to WebGPURenderer migration guide](/migrate/webglrenderer-to-webgpurenderer/) before changing a production renderer.

## Limitations

The upstream WebGPU path evolves quickly, so every claim must be rechecked after r185. Automatic WebGL 2 fallback improves reach but can conceal an unmet native-WebGPU requirement. Conversely, rejecting WebGPURenderer because one feature is incomplete can overlook workloads where its node, compute, or post architecture is already the better fit.

Neither renderer repairs poor scene architecture, incorrect color management, duplicate output transforms, leaks, or unbounded effects. Those must be verified separately.
