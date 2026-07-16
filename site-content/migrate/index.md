---
kind: hub
slug: /migrate/
title: Three.js WebGPU and Agent-Skill Migration Guides
description: Move existing Three.js projects and prompt workflows toward WebGPURenderer, TSL, and specialist agent skills with version-aware guides.
h1: Three.js WebGPU and agent-skill migration guides
primary_query: threejs webgpu migration guides
query_aliases: ["threejs tsl migration guide index","modernize a threejs webgl project"]
summary: Choose a guide by the source contract you are replacing: renderer, custom shader, or agent prompt workflow. Each migration preserves a working baseline, exposes unsupported behavior, and verifies the target state against the installed Three.js revision.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-procedural-materials","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["webgpu-image-pipeline","webgpu-validation-harness"]
related_pages: ["/docs/use-in-an-existing-project/","/compare/webgpurenderer-vs-webglrenderer/","/compare/threejs-tsl-vs-glsl/","/agents/routing-and-minimal-context/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://threejs.org/manual/en/webgpurenderer","https://github.com/mrdoob/three.js/wiki/Migration-Guide","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/package.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-debugging/SKILL.md"]
---

## Choose the source contract that must change

Release 1 provides three migration paths. Each owns a different source-to-target query:

- [Migrate from WebGLRenderer to WebGPURenderer](/migrate/webglrenderer-to-webgpurenderer/) when renderer initialization, backend behavior, custom materials, post-processing, render targets, or output ownership must change.
- [Migrate from GLSL ShaderMaterial to TSL](/migrate/glsl-shadermaterial-to-tsl/) when custom shader strings or `onBeforeCompile` patches must become NodeMaterial and TSL graphs.
- [Migrate from raw Three.js prompts to agent skills](/migrate/raw-threejs-prompts-to-agent-skills/) when reusable graphics guidance is repeated inside large prompts instead of installed, routed, and verified as specialist skills.

Do not combine all three migrations into one unreviewable rewrite. A renderer transition can expose material and pipeline incompatibilities, but those should remain named work units with separate acceptance evidence.

## Freeze the source state first

Record the resolved Three.js package, runtime `THREE.REVISION`, lockfile, imports, renderer class, initialized backend, materials, `onBeforeCompile` patches, post-processing, render targets, compute, readback, assets, lifecycle, and project validation commands. Capture one deterministic baseline with the current scene, camera, data, and no-post output.

For a prompt-workflow migration, preserve the old prompts and representative tasks. Separate project requirements from generic rendering instructions, version assumptions, and unverified performance demands.

The source baseline is not an endorsement of the old architecture. It is the fixed comparison needed to tell whether a target change preserves the intended observable or merely produces a different attractive image.

## Define a target contract and explicit non-goals

Every technical guide in this release targets the repository's currently pinned Three.js package, `0.185.1`. Verify that package and the runtime revision rather than assuming a version label proves API availability. State the required backend, features, renderer/material/pipeline owners, and project-defined correctness or performance gates.

Name what the migration does not include. The skill pack does not own application framework changes, generic UI, asset ingestion and optimization, production lighting design, WebXR, deployment, or live-data transport. It also does not guarantee that WebGPURenderer is faster for every project or device.

For agent workflows, the target is a small prompt that carries product intent and project constraints while installed skills carry reusable technical guidance. It is not a prompt-free workflow and does not transfer repository authority to the skill pack.

## Implement in dependency order

Change the earliest required ownership boundary first. Renderer initialization and backend proof precede native-WebGPU claims. Material and geometry causes precede post-processing. A no-post baseline precedes bloom, grading, or output conversion. Shared depth, normal, velocity, identifiers, and histories need owners before consumers are added.

Keep one tone-map owner and one output-conversion owner. Keep current source and target paths separately runnable only where coexistence is bounded and useful for comparison. Avoid permanent duplicated architectures that silently diverge.

## Verify before retiring the source path

Run the project's existing static and runtime checks, then the validation procedure owned by the selected skill or lab. Compare fixed cameras, deterministic seeds or data, no-post output, mechanism diagnostics, final output, resource inventory, lifecycle behavior, and relevant negative controls.

Use the published demo catalog to locate examples, not to infer current acceptance. The current evidence summaries for the debugging decision lab and WebGPU image-pipeline lab do not match their current source hashes, so neither is migration proof until source-bound validation is rerun. Use the [validation harness](/demos/webgpu-validation-harness/) only after confirming its source hash, evidence record, and required artifacts; it still does not prove the migrated project until the project runs its own checks.

Retain a rollback path until every required backend, API, correctness, visual, resource, lifecycle, and named-device sustained performance or latency gate passes. If the target capability is unavailable, report the exact blocker and the narrower migration work that remains valid.

## Use official release history as evidence, not as implementation

Three.js WebGPU and TSL APIs evolve. Read the official WebGPURenderer manual and the release migration guide for the installed range, then inspect installed exports and source. A current documentation page can describe a newer API than the project's resolved package, while a nearby example can preserve an older name.

When source, documentation, and runtime behavior disagree, use `threejs-debugging` to build a minimal reproduction and version matrix. A closed issue, merged change, or remembered release does not prove that a published dependency contains the fix.
