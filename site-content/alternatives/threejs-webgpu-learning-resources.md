---
kind: alternatives
slug: /alternatives/threejs-webgpu-learning-resources/
title: Three.js WebGPU Learning Resources
description: Choose official manuals, the TSL specification, runnable examples, r185 source, or agent-led workflows for learning Three.js WebGPU.
h1: Three.js WebGPU learning resources
primary_query: threejs webgpu learning resources
query_aliases: ["learn threejs webgpu","threejs webgpu resources"]
summary: Use the WebGPURenderer manual for setup, the TSL specification for node composition, official examples for patterns, tagged source for exact behavior, and this pack for agent-led architecture and validation.
related_skills: ["threejs-choose-skills","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/compare/threejs-webgpu-skill-pack-vs-official-threejs-docs/","/compare/threejs-tsl-vs-glsl/","/compare/webgpurenderer-vs-webglrenderer/","/docs/","/migrate/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://threejs.org/manual/en/webgpurenderer","https://threejs.org/docs/pages/WebGPURenderer.html","https://threejs.org/docs/TSL.html","https://threejs.org/examples/?q=webgpu","https://github.com/mrdoob/three.js/releases/tag/r185","https://github.com/mrdoob/three.js/tree/r185/src","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md"]
---

## Short answer

Use the official WebGPURenderer manual for renderer setup and migration boundaries. Use the TSL specification for node, shader, compute, storage, MRT, and RenderPipeline concepts. Use official examples for runnable feature patterns. Use tagged r185 source and release notes when exact behavior matters. Use this pack when an agent must turn those mechanisms into an architecture and prove the result in a repository.

These resources are stages of one learning path, not mutually exclusive products.

## Resource map

| Resource | Best for | What it does not replace |
| --- | --- | --- |
| WebGPURenderer manual and API | Imports, initialization, fallback, renderer features, and migration constraints | TSL language depth, production architecture, or local proof |
| TSL specification | Node functions, NodeMaterial channels, compute, storage, render passes, MRT, and post-processing | A complete project workflow or target-device validation |
| Official examples | Running isolated features and seeing current upstream patterns | Source-level explanation of every mechanism or production integration |
| r185 source, release, and migration notes | Exact implementation and revision-specific change history | A guided learning sequence or application-specific decision |
| This skill pack | Agent routing, workload decisions, integration rules, diagnostics, and evidence | Official API authority, beginner JavaScript teaching, or complete Three.js coverage |

## 1. WebGPURenderer manual and API

Start here when the immediate question is how to instantiate the renderer, why initialization can be asynchronous, how WebGL 2 fallback works, or which legacy material and post-processing paths require migration.

The manual states several boundaries that should shape the rest of the learning plan:

- `three/webgpu` and `three/tsl` are the relevant imports;
- `setAnimationLoop()` or an explicit `await renderer.init()` handles asynchronous initialization;
- WebGPURenderer can use a WebGL 2 fallback backend;
- `ShaderMaterial`, `RawShaderMaterial`, and `onBeforeCompile` customizations need a node-material and TSL path;
- EffectComposer passes are not the WebGPURenderer post-processing path.

Use the API page after the manual for exact options and properties. Recheck the installed revision before copying a live-doc example into an r185 project.

## 2. TSL specification

Use the TSL specification when the problem moves from renderer setup to shader and render-graph authoring. It explains why TSL can generate WGSL or GLSL through backend builders and documents high-level material properties, flow control, compute, storage, passes, MRT, node post effects, and `renderOutput()`.

Read it by task rather than from top to bottom:

- material authors should start with NodeMaterial channels, spaces, textures, and functions;
- compute work should focus on storage, workgroups, atomics, and lifecycle;
- post-processing work should focus on `pass()`, texture outputs, MRT, effects, and RenderPipeline;
- migration work should study the GLSL-to-TSL mappings and unsupported legacy hooks.

The specification explains mechanisms. It does not decide whether an application should allocate a normal attachment, use temporal history, or run compute on a particular workload. Those are architecture decisions.

## 3. Official examples

Use official examples to run one feature in a small upstream context. They are valuable for import patterns, basic object setup, current node APIs, renderer behavior, and visual discovery.

When adapting an example, identify what it omits:

- target-device and low-power budgets;
- integration with the application's camera, resize, and disposal lifecycle;
- final output and color ownership;
- diagnostic views and negative controls;
- failure behavior when the backend or feature is unavailable;
- measured pass, attachment, and storage cost.

An example is evidence that a feature can be demonstrated in its own conditions. It is not proof that the copied version is correct or efficient in a production graph.

## 4. Tagged source and release notes

Use the r185 tag when documentation is ambiguous, a behavior changed between releases, or a generated node graph needs source-level explanation. Tagged source is also the strongest way to distinguish the project's installed revision from live docs that may already describe a later release.

Read the smallest relevant source path. Start from the documented class or node, follow its imports and builder behavior, and record which conclusion is directly visible in source versus inferred from surrounding code. Pair source inspection with a minimal runtime reproduction when behavior depends on the browser backend.

Source code has the highest reading cost in this set. It answers exact mechanism questions but does not automatically provide a learning order or product recommendation.

## 5. This skill pack

Use the pack after the feature is understood but the architecture remains open. Its router selects a small set of specialist skills. Those specialists add workload decisions, resource costs, invalidation, failure conditions, examples, and validation procedures around the upstream mechanisms.

For example, the TSL specification shows how to attach MRT outputs. The image-pipeline skill asks whether each signal has a consumer, whether one scene render can expose the required data, how attachment traffic changes, who owns history, and where the final output conversion occurs.

The pack is not a beginner course. It assumes the reader or agent can inspect JavaScript, Three.js source, graphics spaces, GPU resources, and the existing repository.

## Recommended learning sequences

### New WebGPURenderer project

1. Read the renderer manual.
2. Run one official example on target browsers.
3. Learn the TSL concepts required for the first material or effect.
4. Use [choose skills](/docs/choose-skills/) for the first multi-system feature.
5. Validate backend identity and final output.

### Existing WebGL project

1. Inventory custom materials, renderer hooks, EffectComposer passes, and device support.
2. Read the upstream migration constraints.
3. Compare [WebGPURenderer and WebGLRenderer](/compare/webgpurenderer-vs-webglrenderer/).
4. Port one bounded path using the [migration hub](/migrate/).
5. Compare fixed-view output, diagnostics, and measured cost before expanding.

### Shader author moving to TSL

1. Read the TSL introduction and GLSL mapping.
2. Map spaces, uniforms, textures, and material outputs explicitly.
3. Port one material.
4. Inspect the generated graph and runtime result.
5. Use [TSL vs GLSL](/compare/threejs-tsl-vs-glsl/) to decide what should remain on the old path.

## Cost and maintenance

These primary resources are publicly accessible, but total learning cost includes time, coding-agent usage, target hardware, and implementation review. Do not copy volatile course or provider prices into this page. If a structured commercial resource is later added, source its current price and update owner separately.

## Limitations

Live official documentation can move beyond r185. Official examples prioritize feature demonstration over every production constraint. Tagged source is exact but difficult to navigate. This pack is deep in its supported systems but deliberately incomplete outside them.

When a resource conflicts with the installed package, inspect that exact package revision and reproduce the behavior. Do not resolve the conflict by trusting whichever prose sounds more confident.
