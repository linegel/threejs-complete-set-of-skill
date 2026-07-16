---
kind: migration
slug: /migrate/webglrenderer-to-webgpurenderer/
title: Migrate Three.js WebGLRenderer to WebGPURenderer
description: Migrate a Three.js project from WebGLRenderer to WebGPURenderer by auditing custom materials, post-processing, initialization, and output ownership.
h1: Migrate from WebGLRenderer to WebGPURenderer
primary_query: migrate threejs webglrenderer to webgpurenderer
query_aliases: ["threejs webgl to webgpu migration","replace webglrenderer with webgpurenderer"]
summary: This is an application migration, not a constructor rename. Change the renderer and import path, initialize it asynchronously, verify the actual backend, then port unsupported ShaderMaterial, onBeforeCompile, and EffectComposer paths to NodeMaterial, TSL, and RenderPipeline equivalents.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-procedural-materials","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["debugging-contract-lab","webgpu-image-pipeline","webgpu-validation-harness"]
related_pages: ["/migrate/glsl-shadermaterial-to-tsl/","/compare/webgpurenderer-vs-webglrenderer/","/docs/use-in-an-existing-project/","/faq/how-do-i-verify-the-native-webgpu-backend/"]
published: 2026-07-16
last_reviewed: 2026-07-16
supported_revision: 0.185.1
sources: ["https://threejs.org/manual/en/webgpurenderer","https://threejs.org/docs/pages/WebGPURenderer.html","https://github.com/mrdoob/three.js/wiki/Migration-Guide","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-debugging/SKILL.md"]
---

## Define the source and target states

The source is an existing application using `WebGLRenderer`. Inventory its imports, animation loop, context options, standard and custom materials, `onBeforeCompile` hooks, EffectComposer chain, render targets, texture formats, readback, loaders, shadows, controls, XR path, color management, and resource disposal.

The target for this guide is the repository's pinned `three` package, `0.185.1`, using imports from `three/webgpu`, TSL imports from `three/tsl`, an initialized `WebGPURenderer`, NodeMaterial where custom shading is required, and `RenderPipeline` when node post-processing owns final presentation.

The target does not imply that every WebGL feature, custom shader, addon, or third-party integration has a direct equivalent. It also does not imply a performance win. The official manual states that some applications can encounter missing features or better performance with `WebGLRenderer`, so measure the complete target graph on named devices.

## Inventory compatibility before changing code

Use this checklist before touching the renderer:

- Imports and import maps for `three`, `three/webgpu`, `three/tsl`, and addons.
- Renderer construction, context attributes, pixel ratio, size, animation loop, and initialization order.
- `ShaderMaterial`, `RawShaderMaterial`, and built-in material modifications through `onBeforeCompile`.
- EffectComposer passes, tone mapping, output color conversion, antialiasing, and UI compositing.
- Render-target classes, formats, samples, MRT outputs, cube targets, and readback paths.
- Compute and storage resources, feature checks, and synchronization assumptions.
- Loaders or integrations that call renderer capability APIs during setup.
- Tests, screenshots, deterministic seeds, fixed cameras, and performance capture method.

Classify each item as reusable, replace, gated, route away, or unknown. Unknown is a blocker for deleting the source path, not permission to assume compatibility.

## Change imports and initialize the renderer

A minimal source renderer may look like this:

```js
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

function frame() {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

frame();
```

The r185 target starts with the WebGPU build and an explicit backend gate:

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('Native WebGPU is required for this canonical route.');
}

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

`setAnimationLoop()` can coordinate first-frame initialization, while explicit `await renderer.init()` is required before synchronous capability inspection or other setup that depends on initialized backend state. Keep the explicit call when the application performs a backend gate before entering its loop.

`WebGPURenderer` can use a WebGL 2 backend. That behavior is useful in Three.js generally, but it does not satisfy this pack's native-WebGPU claim. Record the renderer class and actual backend as separate facts.

## Replace unsupported material and post-processing paths

The official WebGPURenderer manual states that `ShaderMaterial`, `RawShaderMaterial`, and built-in material modifications through `onBeforeCompile()` are not supported by `WebGPURenderer`. Port those paths to TSL and NodeMaterial instead of retaining a hidden legacy branch in the canonical graph. Use the dedicated [ShaderMaterial-to-TSL guide](/migrate/glsl-shadermaterial-to-tsl/) for that work.

EffectComposer and its effect passes are not the WebGPURenderer post-processing path. In r185 the current coordinator name is `RenderPipeline`. Start from one renderer, one pipeline, and one primary scene pass. Request only the depth and MRT outputs consumed by later nodes, and compare each attachment with reconstruction or a narrow rerender on the target device.

Assign tone mapping and output conversion once. Either provide scene-linear output for the pipeline's configured conversion, or let explicit `renderOutput(...)` own presentation and set `renderPipeline.outputColorTransform = false`. After changing `renderPipeline.outputNode` or `renderPipeline.outputColorTransform`, set `renderPipeline.needsUpdate = true`.

Audit revision-specific render-target changes as separate items. For the r184 to r185 range, the official migration guide replaces `WebGLCubeRenderTarget` usage with `CubeRenderTarget` for WebGPURenderer. Verify every such name against the installed package rather than copying this rule to another revision.

## Diagnose the common failure modes

- Renderer capability methods are used before initialization.
- The application creates `WebGPURenderer` but actually runs its WebGL 2 backend.
- A third-party dependency still constructs `ShaderMaterial` or patches built-in shader chunks.
- The old EffectComposer and new RenderPipeline both process or present the frame.
- Tone mapping or output conversion is applied twice.
- Render-target format, sample count, depth convention, or readback layout changed without a diagnostic.
- A release-specific API name was taken from documentation or an example that does not match the installed package.
- A performance claim compares different scenes, resolutions, DPRs, backend states, or timing methods.

Use `threejs-debugging` when the installed source, current documentation, and runtime behavior disagree. Preserve the failing renderer, material, backend, and assertion in a minimal reproduction before searching upstream history.

## Verify and retire the source path deliberately

Keep the WebGLRenderer baseline separately runnable while the migration is incomplete. Hold scene, assets, camera, seed or data, resolution, DPR, and visual assertion constant. Compare no-post output first, then material and signal diagnostics, final output, render-target inventory, resource lifecycle, and timing on the named target.

The published [WebGPU image-pipeline lab](/demos/webgpu-image-pipeline/) catalog entry describes shared-pass, history, and final-output ownership, but its current evidence summary does not match the current source hash. Do not treat it as accepted evidence until source-bound validation is rerun. The [native WebGPU validation harness](/demos/webgpu-validation-harness/) describes backend proof, diagnostics, aligned readback, resources, timing evidence, and lifecycle records; confirm its current source-bound record before use. Apply those contracts to the migrated application rather than treating a catalog entry as application proof.

Remove the WebGL source path only after every required API, backend, correctness, visual, resource, lifecycle, and named-device sustained performance or latency gate passes. If the target is blocked, retain the narrow source route or roll back the affected migration unit. Do not disguise an unverified compatibility branch as the completed canonical migration.
