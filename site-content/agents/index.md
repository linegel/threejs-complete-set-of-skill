---
kind: hub
slug: /agents/
title: Agent Documentation for the Three.js WebGPU Skill Pack
description: Understand how coding agents discover, route, and verify the Three.js WebGPU Skill Pack through SKILL.md, skills.json, and llms.txt.
h1: Agent contract for the Three.js WebGPU Skill Pack
primary_query: threejs webgpu agent documentation
query_aliases: ["threejs skill pack machine interface","threejs agent skills contract"]
summary: Agents discover the pack through local SKILL.md folders or the machine-readable catalog, then route broad work through threejs-choose-skills. Installed source, resolved Three.js revision, actual initialized backend, and current evidence outrank remembered behavior or nearby examples.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-visual-validation"]
related_demos: ["debugging-contract-lab","webgpu-validation-harness"]
related_pages: ["/agents/routing-and-minimal-context/","/docs/install/","/docs/choose-skills/","/faq/how-do-i-verify-the-native-webgpu-backend/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-visual-validation/SKILL.md"]
---

## Use the machine endpoints for discovery

The HTML site explains the contract to people and crawlers. Agents should use the maintained machine surfaces when they need a compact inventory:

- [`skills.json`](/skills.json) exposes the repository source, install commands, router identity, skill records, coverage summary, demo registry, and methodology URL.
- [`llms.txt`](/llms.txt) provides a plain-text overview and links to skill pages.
- Each installed `skills/<name>/SKILL.md` file supplies the local activation description and technical contract for one owner.

These surfaces overlap intentionally but serve different consumers. `skills.json` is structured discovery data; `llms.txt` is a compact reading surface; `SKILL.md` remains the executable local guidance. Agents should not scrape prose pages to reconstruct a skill inventory that already exists in machine-readable form.

The only Release 1 child of this family is [routing and minimal context](/agents/routing-and-minimal-context/). It defines how to move from discovery to a bounded active skill set.

## Apply source precedence before reasoning from memory

Apply this authority order:

1. Project instructions and project source for application behavior.
2. The resolved Three.js package exports, source, and types for API behavior.
3. The selected installed skill for procedure.
4. Current source-bound evidence records and artifacts for technical claims.

Repository examples, labs, and the published demo catalog show intended paths, but they are not part of the installed skill payload and their presence is not runtime proof. A source-bound accepted evidence record proves only its recorded mechanism, browser/device context, inputs, and evidence contract. General model memory and a nearby Three.js release are useful leads, not authority.

An agent should keep the following facts distinct:

- Required package, renderer, backend, or feature constraints.
- Resolved package version and runtime `THREE.REVISION`.
- Renderer class and actual initialized backend.
- Authored budgets or quality policies.
- Measured results from a named device, resolution, scene state, and method.

Collapsing those facts into `supports WebGPU` or `runs fast` produces an unverifiable claim.

## Route broad work, invoke focused owners directly

Start with `threejs-choose-skills` when a request spans geometry, fields, materials, simulation, camera policy, shared passes, final-image treatment, or sustained performance. The router inventories installed skills, classifies the workload, identifies the earliest missing causal system, and assigns shared ownership. It then hands implementation to the smallest relevant destination set.

When the task already names one bounded mechanism, load its owner directly. Use `threejs-debugging` for a concrete failure or version disagreement, not ordinary scene design. Add `threejs-visual-validation` whenever a route makes quantitative, temporal, adaptive, compute, or sustained-performance claims.

The router must report unsupported concerns. It does not own generic application architecture, DOM UI, accessibility, live-data transport, asset production, deployment, WebXR, or general lighting design. Agents should route those areas to project or official domain guidance and preserve the boundary at the Three.js presentation interface.

## Produce explicit ownership and failure behavior

A composed route must assign one owner to every allocated depth, normal, velocity, identifier, history, tone map, output conversion, and adaptive-quality decision. The same signal name from different cameras, time samples, jitter policies, or coordinate spaces does not make the data shareable.

When a causal owner is absent, reduce scope or return a blocker. Do not invent a skill name, substitute a visual effect for a missing cause, or load the entire pack to hide the gap. When the native WebGPU backend is unavailable, retain the canonical requirement as a blocker unless the user explicitly requests fallback teaching.

Use the installed `skills/threejs-choose-skills/SKILL.md` route-result contract for routing fields and completion conditions. Verify the resulting route against the current project's installed inventory, package revision, initialized backend, ownership graph, acceptance bounds, and project-level checks. For rendering evidence structure, inspect the [native WebGPU validation harness](/demos/webgpu-validation-harness/) only after confirming its source hash, evidence record, and required artifacts.

## Verify before reporting completion

Agents should initialize `WebGPURenderer` before backend and synchronous capability checks. They should record the actual backend and required features, then execute the validation owned by the selected skill or project. Important final and diagnostic images must be opened directly.

For readback, carry the real integer row stride and GPU alignment into encoding. For output, keep a unique tone-map and output-conversion owner. When explicit `renderOutput(...)` owns presentation, set `renderPipeline.outputColorTransform = false`; after changing `renderPipeline.outputNode` or `renderPipeline.outputColorTransform`, set `renderPipeline.needsUpdate = true`. For timing, state whether the result is CPU wall time or GPU timestamp evidence, and do not claim the latter without the required query support.

If the environment cannot provide a required capability or artifact, report the exact missing condition and the narrower claim that remains supportable. A plausible result, passing unrelated test, or nonblank screenshot is not a substitute for the missing evidence.

## Keep agent prompts compact

A good agent request supplies the project goal, protected observable, source state, target constraints, and required evidence. It references installed skills rather than embedding their complete contents. The [minimal-context routing guide](/agents/routing-and-minimal-context/) provides broad and focused prompt patterns that preserve this division.
