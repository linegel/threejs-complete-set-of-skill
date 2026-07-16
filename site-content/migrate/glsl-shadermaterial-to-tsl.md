---
kind: migration
slug: /migrate/glsl-shadermaterial-to-tsl/
title: Migrate Three.js ShaderMaterial from GLSL to TSL
description: Rewrite a Three.js ShaderMaterial as a TSL and NodeMaterial graph while preserving coordinates, material response, shadows, color space, and diagnostics.
h1: Migrate a Three.js ShaderMaterial to TSL
primary_query: migrate threejs shadermaterial to tsl
query_aliases: ["threejs glsl to tsl migration","replace shadermaterial with node material"]
summary: Do not treat this as a text-level GLSL translation. Reconstruct the shader's inputs, spaces, material response, displacement, shadows, and outputs as a TSL graph attached to appropriate NodeMaterial slots, then validate that graph before restoring post-processing.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-procedural-materials","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["webgpu-image-pipeline","webgpu-validation-harness"]
related_pages: ["/migrate/webglrenderer-to-webgpurenderer/","/compare/threejs-tsl-vs-glsl/","/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/","/docs/use-in-an-existing-project/"]
published: 2026-07-16
last_reviewed: 2026-07-16
supported_revision: 0.185.1
sources: ["https://threejs.org/docs/TSL.html","https://threejs.org/manual/en/webgpurenderer","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-materials/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json"]
---

## Inventory the GLSL contract before translating it

Freeze the original material with a deterministic object, lights, environment, camera, seed, texture set, and no-post output. Record every input and side effect:

- Uniforms, attributes, varyings, preprocessor defines, extensions, and shader chunks.
- Vertex displacement, normal changes, coordinate spaces, and shadow-caster behavior.
- Fragment color, alpha or discard behavior, blending, depth writes, derivatives, and texture operations.
- Texture color spaces, data encodings, wrapping, filtering, mip behavior, and precision.
- Built-in lighting or material behavior injected through `onBeforeCompile`.
- External consumers such as bloom, MRT outputs, picking IDs, or readback.

Classify the shader's primary contract. A physically lit surface, screen-space effect, compute kernel, and full custom output do not have the same NodeMaterial target. This guide focuses on material graphs; route a shared final-image chain to `threejs-image-pipeline` and a concrete migration failure to `threejs-debugging`.

## Choose a NodeMaterial target rather than translating strings

For a physically lit surface, start with `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial`. Preserve Three.js lighting, environment, shadow, transmission, clearcoat, sheen, anisotropy, and output behavior, then replace only the procedural causes through node slots.

A simple material identity can begin like this in the pinned r185 surface:

```js
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float } from 'three/tsl';

const material = new MeshStandardNodeMaterial({ name: 'painted-metal' });
material.colorNode = color(0x6b7480);
material.roughnessNode = float(0.42);
material.metalnessNode = float(0.78);
```

This is not a line-by-line replacement for an arbitrary `ShaderMaterial`. It demonstrates the target ownership model: material identity is expressed through NodeMaterial slots, while the renderer retains its lighting and output contracts.

Build one shared TSL cause graph and derive color, roughness, metalness, normal, opacity, emissive, and masks from it. Repeating unrelated noise or texture work independently per channel can detach the material's visible identity and multiply cost.

## Port vertex, coordinate, and shadow behavior together

Label every value as object, local, world, view, clip, UV, texel, or another explicit space. Preserve the original units and transformations. A matching expression in a different space is not a successful port.

Use `positionNode` for visible displacement. In r185, `positionNode` already feeds shadow projection. Set `castShadowPositionNode` only when the caster intentionally uses a different position; duplicating the same displacement there creates a second owner without changing the intended shadow contract.

Fragment derivatives must execute in derivative-uniform control flow. For vertex or compute displacement, use an analytic or stored gradient rather than assuming fragment derivatives transfer across stages. Validate normal orientation and encoding with direct diagnostic output.

Keep geometry-owned silhouette and topology separate from material microstructure. If the old shader changes topology or depends on an unsupported asset pipeline, name that dependency instead of forcing it into a material node.

## Port material response and color ownership

Color textures use their declared sRGB encoding; normals, roughness, masks, identifiers, simulation fields, and other data remain non-color data. Generated procedural colors stay scene-linear until the unique output owner. Do not apply display conversion inside a material cause and again in the final pipeline.

Use `emissiveNode` only for real material emission. Bloom is a later optical consumer and requires an HDR emission and exposure policy. Do not paint glow into base color or treat bloom as evidence that emissive energy is correct.

For normals, derive the perturbation from the same height or structural field that produces the visible detail. Keep derivative work within valid control flow and preserve the base material's normal and shadow semantics. For dissolve and cutouts, drive visible and shadow masks from the same instance or field inputs.

Assign one tone-map owner and one output-conversion owner. If explicit `renderOutput(...)` owns final presentation, set `renderPipeline.outputColorTransform = false`. After changing `renderPipeline.outputNode` or `renderPipeline.outputColorTransform`, set `renderPipeline.needsUpdate = true`.

## Compare the original and target with useful diagnostics

Capture near, design, and far views plus deterministic seeds or inputs. Compare:

- No-post material response.
- Base color or material identity.
- Roughness, metalness, and other physical parameters.
- Geometric and perturbed normals.
- Texture footprint, filtering, and aliasing behavior.
- Visible displacement and shadow-caster parity.
- Alpha, dissolve, and shadow masks.
- Raw emission, final output, and output conversion.

No source-bound evidence linked by this guide proves a general GLSL-to-TSL material migration. The demo catalog entries for the [WebGPU image-pipeline lab](/demos/webgpu-image-pipeline/) and [validation harness](/demos/webgpu-validation-harness/) describe output and evidence mechanisms, but the catalog is not live status authority. Confirm a matching source hash and evidence record before using either artifact; the target project must still provide its own material comparison.

## Handle limits and rollback honestly

Do not promise that every GLSL shader has an automatic TSL equivalent. Custom chunks, unsupported renderer paths, stage-specific operations, third-party material patches, or release-dependent APIs can require redesign or a bounded blocker. Inspect installed `three/tsl` exports and source rather than relying on an API name from another release.

Keep the original material available for fixed comparison until every required material, shadow, color, output, lifecycle, correctness, and named-device sustained performance or latency gate passes. If the target cannot preserve the required observable, roll back that material unit or reduce scope. Do not retain a hidden ShaderMaterial branch inside the canonical WebGPURenderer route.
