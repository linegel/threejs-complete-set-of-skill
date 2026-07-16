---
kind: user-doc
slug: /docs/use-in-an-existing-project/
title: Use Three.js Agent Skills in an Existing Project
description: Add the Three.js WebGPU Skill Pack to an existing codebase without replacing project rules, then verify revision, routing, and evidence.
h1: Use the skill pack in an existing Three.js project
primary_query: use threejs agent skills in an existing project
query_aliases: ["add threejs webgpu skills to an existing codebase","integrate threejs skills with project instructions"]
summary: Install or reference the pack without overwriting the project's architecture, coding rules, or source authority. Begin with an inventory of the resolved Three.js version, renderer, materials, post-processing, target devices, and the concrete feature or failure being addressed.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["debugging-contract-lab","webgpu-validation-harness"]
related_pages: ["/docs/choose-skills/","/agents/","/migrate/raw-threejs-prompts-to-agent-skills/","/migrate/webglrenderer-to-webgpurenderer/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/AGENTS.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-debugging/SKILL.md"]
---

## Freeze the existing project before changing it

Record the resolved `three` package, runtime `THREE.REVISION`, lockfile resolution, imports, renderer class, and initialized backend. Inventory custom materials, `onBeforeCompile` hooks, post-processing, render targets, compute, readback, shadows, assets, controls, and lifecycle code. Capture the current validation commands and one deterministic scene state or minimal reproduction.

Do not infer the runtime revision from a package range. Do not infer native WebGPU from the class name `WebGPURenderer`. Initialize the renderer and record the actual backend before routing a canonical WebGPU change.

The purpose of this inventory is to preserve a known source state. Without it, a skill can produce technically current code while silently breaking a project-specific material, output transform, interaction contract, or deployment target.

## Add one source of reusable graphics guidance

Use the normal [installation guide](/docs/install/) or keep a local checkout that the project's agent can read. Preserve the existing `AGENTS.md`, `CLAUDE.md`, or equivalent instruction file. Add a narrow routing rule rather than copying the full pack into project instructions:

```text
For Three.js WebGPU work, use the matching threejs-* skill. If the task spans
multiple rendering systems, start with threejs-choose-skills and load only the
destination skills it selects. Preserve this repository's existing application,
testing, safety, and deployment rules.
```

Project rules continue to own framework decisions, state management, UI, accessibility, data transport, assets, deployments, and operational safety. The pack owns only the rendering systems and evidence contracts declared by its installed skills.

## Run the first route as an audit

Ask for a route without authorizing code changes:

```text
Audit this existing Three.js project for the requested WebGPU change. Record the
resolved package, runtime revision, initialized backend, current material and
post-processing paths, primary owner, selected, deferred, gaps, handoffs,
resources, passes, output, and verification. Do not implement yet.
```

For a focused observed failure, use `threejs-debugging` instead. Its job is to preserve the failing mechanism, separate application misuse from version behavior, inspect installed source, and recommend the narrowest proven correction. A nearby issue title or merged pull request is not proof that the installed release contains a fix.

## Integrate one ownership boundary at a time

Start with the earliest missing causal system. Preserve the application's current renderer and no-post baseline while porting one material, pass, effect, or resource path. Keep the old path available only where it provides a bounded comparison or rollback route.

Use `threejs-image-pipeline` only when several consumers share a scene pass, depth, normal, velocity, identifiers, history, or final output. Keep one owner for tone mapping and one for output conversion. If explicit `renderOutput(...)` owns presentation, set `renderPipeline.outputColorTransform = false` and do not apply another output transform.

After changing `renderPipeline.outputNode` or `renderPipeline.outputColorTransform`, set `renderPipeline.needsUpdate = true`. For resolution-policy or diagnostic changes, inspect the installed API and invalidate the affected graph or histories explicitly. Do not rely on an example from a nearby release to prove the current package surface.

## Verify the project, not only the example

Run the repository's existing syntax, build, and targeted validation commands. Then run the selected skill's validation procedure at the appropriate scope. Inspect final, no-post, diagnostic, seed, camera, and temporal images that support the actual claim.

Record renderer and backend information, render-target inventory, formats, physical extents, actual readback row stride, timing method, resource lifecycle, and limitations. A nonblank screenshot does not prove the mechanism. GPU timing is not valid unless the renderer, device, and timestamp-query method support it and the measured graph is named.

The [debugging decision lab](/demos/debugging-contract-lab/) defines version and action-classification fixtures. The [validation harness](/demos/webgpu-validation-harness/) defines evidence records and negative controls. Confirm their current source-bound records, then apply those contracts to the project rather than presenting the labs as proof of the project's output.

## Keep a narrow rollback and support boundary

Renderer, material, and final-output migrations can change several visual contracts at once. Keep the source path reproducible until every required API, backend, correctness, visual, resource, lifecycle, and named-device sustained performance or latency gate passes. Roll back the smallest migration unit when any required gate cannot be proven.

The skill pack does not include managed migration, production assets, target hardware, hosting, or a support SLA. It can structure and verify the rendering work, but it cannot supply missing product requirements or guarantee results on unnamed devices.
