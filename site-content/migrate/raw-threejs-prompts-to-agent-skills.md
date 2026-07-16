---
kind: migration
slug: /migrate/raw-threejs-prompts-to-agent-skills/
title: Migrate Raw Three.js Prompts to Agent Skills
description: Replace repeated Three.js mega-prompts with installed specialist skills, minimal routing, explicit project constraints, and evidence-backed verification.
h1: Replace raw Three.js prompts with agent skills
primary_query: migrate threejs prompts to agent skills
query_aliases: ["replace threejs mega prompt with skills","adopt threejs agent skills from raw prompts"]
summary: Keep the project goal and constraints in the prompt, but move reusable Three.js architecture and validation guidance into installed skills. Use the router only for broad cross-system work; invoke one owning skill directly when the task is already narrow.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/docs/use-in-an-existing-project/","/agents/routing-and-minimal-context/","/compare/threejs-webgpu-skill-pack-vs-general-ai-prompts/","/docs/choose-skills/"]
published: 2026-07-16
last_reviewed: 2026-07-16
supported_revision: 0.185.1
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/AGENTS.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/vercel-labs/skills"]
---

## Separate product intent from reusable graphics guidance

Preserve the old prompt and a representative task set before changing the workflow. Mark which sentences describe the product, scene, users, source data, interaction, target devices, acceptance criteria, or repository rules. Those facts still belong in the project request or checked-in instructions.

Extract repeated Three.js guidance such as renderer imports, TSL architecture, material rules, shared signals, final-output ownership, diagnostics, and validation procedure. That reusable material belongs in maintained specialist skills rather than being copied into every prompt.

Flag statements such as `use the latest API`, `make it fast`, or `support all devices`. They are not actionable contracts. Replace them with the resolved package, target backend, named devices, resolution and DPR, protected observable, permissible error, and measurement method.

## Install the maintained source once

Use the [installation guide](/docs/install/) to install the complete pack or configure a local checkout. Keep existing project instructions in `AGENTS.md`, `CLAUDE.md`, or the runtime's equivalent. Add one sentence explaining when to load matching `threejs-*` skills instead of copying their full content into the project prompt.

Use this source precedence:

1. Project-local rules and project source for application behavior.
2. The resolved Three.js package exports, source, and types for API behavior.
3. The selected installed skill for procedure.
4. Current source-bound evidence records and artifacts for technical claims.

Do not merge global and project-local skill copies from different revisions. Select one authoritative source for the task and record it.

## Replace a mega-prompt with one routed request

A broad raw prompt often mixes desired appearance, architecture, optimization, and implementation details without assigning ownership. Replace it with a product-specific request to the router:

```text
Use $threejs-choose-skills to plan this Three.js WebGPU/TSL scene. Preserve the
project's existing application and validation rules. Record the resolved package,
runtime revision, initialized backend, target devices, protected observable, and
product-defined budgets. Return the primary owner plus selected, deferred, gaps,
handoffs, resources, passes, output, and verification fields used by this route.
Do not implement until the route is explicit.
```

The request remains specific to the project. The installed router contributes reusable preflight, routing, ownership, and evidence rules. It should not invent missing product inputs or reframe an unsupported application concern as graphics work.

## Invoke focused owners without routing overhead

When the task already has one bounded owner, call it directly:

```text
Use $threejs-procedural-materials to implement the requested wet-rock material in
the existing r185 WebGPURenderer/TSL project. Preserve application architecture,
the current camera, and final-output ownership. Verify no-post material identity,
normal response, footprint filtering, wetness inputs, shadow parity, and color
space before restoring bloom or grading.
```

For a concrete failure:

```text
Use $threejs-debugging to diagnose this unexpected WebGPURenderer result. Freeze
the failing version, backend, browser, GPU, scene seed, material, and assertion.
Inspect installed source and matching upstream history, then classify the narrowest
proven action. Do not recommend an upgrade from an issue title alone.
```

Add `threejs-visual-validation` whenever a route makes quantitative, temporal, adaptive, compute, or sustained-performance claims. Loading the whole pack into every focused task makes ownership less clear and consumes context without improving the mechanism.

## Require explicit failure behavior

The migrated workflow should report a missing skill owner, product input, backend capability, or evidence artifact as a gap. It must not silently use another renderer, fabricate a quality tier, duplicate tone mapping, or replace a missing cause with post-processing.

Generic app architecture, UI, accessibility, data transport, asset production, WebXR, deployment, and general lighting remain outside the pack's current specialist ownership. Keep those with the project or official domain sources and pass only their declared presentation interfaces into the graphics route.

## Verify that the workflow actually improved

Run the old and new workflows against representative broad, focused, debugging, and unsupported requests. Evaluate whether the new result:

- Selects only installed owners.
- Returns minimal `selected` owners, condition-bound `deferred` owners, and explicit `gaps`.
- Preserves project rules and source precedence.
- Records package, runtime revision, and actual backend separately.
- Closes ordered `handoffs`, named `resources`, executable `passes`, and one `output` contract.
- Returns blockers rather than invented coverage.
- Names the validation needed for each claim.

Use the installed `skills/threejs-choose-skills/SKILL.md` route-result contract to compare the old and new workflows. Verify inventory intersection, causal ordering, handoffs, resources, passes, output ownership, gaps, and acceptance bounds against the current project. The [validation harness](/demos/webgpu-validation-harness/) publishes an evidence structure for rendering claims; confirm its current source-bound evidence before using it as proof.

## Keep the old prompts as bounded migration evidence

Do not delete source prompts until representative tasks produce stable routed results and the team understands how project rules, skills, and installed source divide authority. Keep the old prompt corpus as comparison input or archived rationale, not as a second active instruction system.

This migration does not eliminate the need for good prompts. Product intent, constraints, target devices, source data, and acceptance criteria remain user or project inputs. Skills reduce repeated technical instruction and improve ownership; they cannot supply requirements that were never stated.
