---
kind: user-doc
slug: /docs/choose-skills/
title: Choose the Right Three.js WebGPU Skills
description: Choose the smallest Three.js WebGPU skill set for a task, distinguish broad routes from focused work, and handle unsupported concerns explicitly.
h1: Choose the smallest Three.js skill set
primary_query: how to choose threejs webgpu skills
query_aliases: ["threejs webgpu skill selection guide","route a threejs graphics task"]
summary: Start with threejs-choose-skills when a request spans multiple rendering systems, shared signals, final output, or performance ownership. For one bounded mechanism, invoke its owning skill directly and add validation or pipeline skills only when the task actually needs them.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/agents/routing-and-minimal-context/","/docs/use-in-an-existing-project/","/faq/which-threejs-skill-should-i-use-first/","/migrate/raw-threejs-prompts-to-agent-skills/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json"]
---

## Decide whether the task needs a router

Use `threejs-choose-skills` when a request spans several causal systems, requires shared depth or history, has unresolved final-output ownership, or needs a composed performance and validation plan. A scene with ocean, atmosphere, camera motion, exposure, bloom, and visual acceptance is a routing problem because the systems exchange signals and compete for frame and memory budgets.

Invoke one owner directly when the request is already bounded. A camera audit belongs to `threejs-camera-controls-and-rigs`; a procedural material belongs to `threejs-procedural-materials`; a concrete unexpected API or runtime behavior belongs to `threejs-debugging`. Broad routing adds no value when ownership is already known and no cross-skill contract is missing.

## Give the router product facts, not adjectives

Before selecting skills, record the installed Three.js package and runtime revision, initialized renderer backend, target devices, resolution and DPR, interaction pattern, temporal behavior, scale, and acceptable error. State whether the scene must explain, inspect, configure, present, or monitor something.

Replace vague requests such as `make it cinematic and fast` with observable requirements:

```text
Use $threejs-choose-skills to plan a native-WebGPU product viewer. The primary
observable is material and silhouette identity during orbit inspection. Target
views are near, design, and far; UI and asset ingestion stay outside the graphics
route. Report required product inputs rather than guessing them.
```

The router should identify the earliest missing causal layer before it selects post-processing. A missing silhouette, field, material response, illumination, motion, camera, or image transform has a different owner. Adding bloom or grading cannot repair an unidentified physical or material cause.

## Require a concrete route manifest

A useful route result includes:

- Minimal `selected` owners, condition-bound `deferred` owners, and explicit `gaps` from the installed inventory.
- A primary causal owner plus any data, render, and validation owners.
- Required API and backend gates for the installed revision.
- Ordered `handoffs`, allocated `resources`, executable `passes`, one `output` contract, and causal `verification`.
- Candidate algorithms, rejected alternatives, and the evidence needed to choose between them.
- Explicit project inputs or missing owners that block part of the request.

The installed `skills/threejs-choose-skills/SKILL.md` file defines the route-result fields and completion conditions. Check the route against the current project's installed inventory, initialized backend, handoffs, resources, passes, output ownership, acceptance bounds, and project-level verification before implementation.

## Load only the selected implementation owners

After the route is fixed, load the destination skills that own the missing mechanisms. Add `threejs-image-pipeline` when several image-space consumers genuinely share a scene pass, attachments, history, or final output. Do not load it merely because a scene contains one isolated effect.

Add `threejs-visual-validation` whenever a route makes quantitative, temporal, adaptive, compute, or sustained-performance claims. A simple focused mechanism may use its own local validation instead. Add `threejs-debugging` only for a concrete failure, suspicious behavior, source/documentation disagreement, or version investigation.

This keeps active context smaller and keeps decisions attributable to owners. It also makes omissions visible rather than burying them under a large generic instruction set.

## Route unsupported concerns away

The current pack does not own generic application architecture, DOM UI, accessibility, live-data transport, asset authoring and compression, general studio lighting, WebXR, or deployment. Use project and official domain guidance for those concerns, then route only their declared Three.js presentation interfaces through the pack.

When no installed skill owns a required cause, state the gap and either block that part or reduce scope. Never invent a pseudo-owner. When native WebGPU is unavailable, keep the canonical route blocked unless the user explicitly asks how to teach or apply fallback.

## Check the route before implementation

Confirm that every selected skill exists, every shared signal has one producer, and tone mapping plus output conversion each have one owner. Verify numeric budgets have units and provenance. A published table from another scene or device is not measured evidence for the current composition.

For the agent-side contract, continue to [routing and minimal context](/agents/routing-and-minimal-context/). For a codebase that already has a renderer and project rules, continue to [using the pack in an existing project](/docs/use-in-an-existing-project/).
