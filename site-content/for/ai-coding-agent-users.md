---
kind: audience
slug: /for/ai-coding-agent-users/
title: Three.js WebGPU Skills for AI Coding Agents
description: Explicit routing, minimal context, runnable examples, and evidence contracts for AI agents writing Three.js WebGPU code.
h1: Three.js WebGPU skills for AI coding agents
primary_query: three.js skills for ai coding agents
query_aliases: ["three.js webgpu agent workflow","tsl skills for coding agents"]
summary: The pack gives a coding agent explicit ownership rules, routing decisions, runnable examples, and evidence requirements. It helps the agent load less context, avoid unsupported substitutions, and leave inspectable artifacts.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-visual-validation"]
related_demos: ["debugging-contract-lab","webgpu-validation-harness"]
related_pages: ["/agents/","/agents/routing-and-minimal-context/","/docs/install-codex/","/docs/install-claude-code/","/compare/threejs-webgpu-skill-pack-vs-general-ai-prompts/","/migrate/raw-threejs-prompts-to-agent-skills/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-debugging/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-visual-validation/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json"]
---

This pack is a strong fit when an AI coding agent edits a real Three.js repository and must make its routing, ownership, implementation, and evidence decisions reviewable. It supplies operating contracts; it does not make the agent infallible.

## Strong fit

- The agent can read repository instructions, installed source, and project code, then run the project's commands and inspect artifacts.
- A broad WebGPU/TSL task needs the smallest causal skill set instead of one giant prompt or every available skill.
- The developer expects exact changed files, evidence labels, limitations, and unresolved gaps that can be reviewed after the agent finishes.

## Poor fit

- You want generic prompt snippets, a chat-only answer with no repository access, no-code 3D, or beginner JavaScript instruction.
- You expect a skill to provide an agent runtime, context manager, autonomous-work guarantee, or model-quality benchmark.
- The requested owner is application architecture, DOM UI, accessibility, data transport, asset preparation, or business logic and the project supplies no separate contract for it.

## Three recurring jobs

1. **Route the smallest causal context — [`threejs-choose-skills`](/skills/threejs-choose-skills.html).** Define the protected observable, earliest missing cause, candidate mechanisms, installed skill intersection, cross-system handoffs, and one final-output owner.
2. **Triage exact runtime or revision failures — [`threejs-debugging`](/skills/threejs-debugging.html).** Reproduce the recorded environment, inspect installed source, isolate the first failed contract, and classify upstream evidence without turning issue folklore into a fix.
3. **Leave falsifiable evidence — [`threejs-visual-validation`](/skills/threejs-visual-validation.html).** Freeze the run, capture the producing mechanism, use native-domain metrics and mutation controls, and label each number authored, derived, measured, gated, or unknown.

The [routing and minimal-context guide](/agents/routing-and-minimal-context/) owns the detailed context-loading procedure. The [skill pack versus general AI prompts comparison](/compare/threejs-webgpu-skill-pack-vs-general-ai-prompts/) owns that choice; this page owns fit for agent users.

## Representative workflow: route a broad WebGPU request to verified evidence

1. Receive “add a WebGPU world with water, weather, motion, and final-image polish,” then read the repository rules and inspect the installed skills before proposing systems.
2. Record Three.js `0.185.1`/r185, renderer imports, initialized backend, agent harness, browser/GPU, scene authority, units, fixed camera path, target observable, and acceptance bounds.
3. Use the router to select only owners required by the earliest missing cause and its handoffs. Record tempting but unnecessary skills and unsupported owners as explicit omissions.
4. Implement the smallest composed route with project helpers. Defer bloom, histories, MRT, or grading until their source signals and consumers are named.
5. Capture the no-post baseline, required mechanism diagnostics, aligned output or timing evidence, lifecycle state, and mutation control. Report exact changed files, commands run, artifacts inspected, and any bound that remains unproven.

The [native WebGPU validation harness](/demos/webgpu-validation-harness/) has source-matched accepted evidence for aligned readback, resource inventory, diagnostics, timing, lifecycle, and artifact-validation mechanics. It does not prove the agent's separate composition. The [debugging contract lab](/demos/debugging-contract-lab/) remains a useful diagnostic demo, but its live source and published evidence manifest currently differ, so it is not current proof.

## Constraints

| Constraint | Required boundary |
| --- | --- |
| Renderer | Canonical claims require `WebGPURenderer` from `three/webgpu` and a confirmed native WebGPU backend. Fallback enters the route only when the user explicitly requests it. |
| Three.js revision | The pack targets r185 and this repository resolves `three@0.185.1`; the installed package, imports, and runtime `THREE.REVISION` remain authoritative. |
| Agent | The harness must let the agent read files, edit the repository, run commands, and inspect artifacts. Codex and Claude Code have documented install paths; loading a skill alone proves nothing. |
| Browser and device | Record the exact browser, OS, GPU, viewport, DPR, required WebGPU features, and timing availability for every runtime claim. |
| Expertise | The reviewing developer should understand TypeScript/JavaScript, Three.js, repository workflows, and the relevant rendering concepts well enough to challenge the agent's causal and evidence claims. |

Project instructions, dependencies, current source, and user decisions remain authoritative. A route-away result is correct when the pack does not own the requested system.

## Start here

Use the [Codex installation guide](/docs/install-codex/) to add the skills to Codex, then invoke `threejs-choose-skills` for the first multi-system Three.js task.
