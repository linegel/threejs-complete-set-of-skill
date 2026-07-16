---
kind: hub
slug: /docs/
title: Three.js WebGPU Skill Pack Documentation
description: Install, route, and verify the Three.js WebGPU Skill Pack with task-focused guides for Codex, Claude Code, and existing projects.
h1: Three.js WebGPU Skill Pack documentation
primary_query: threejs webgpu skill pack documentation
query_aliases: ["threejs skills user guide","threejs webgpu pack usage docs"]
summary: Use these docs to install the complete skill pack, choose the smallest relevant skill set, and integrate it without replacing your project's existing rules. Installation makes the guidance available; runtime WebGPU and evidence claims still require explicit verification.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/guides/","/agents/","/migrate/","/faq/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/package.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md"]
---

## Choose the task you need to complete

These pages are operating documentation, not another product tour. Start with the task that is currently blocking adoption:

- [Install the complete skill pack](/docs/install/) to list the available skills, install them, and verify discovery.
- [Install the pack for Codex](/docs/install-codex/) for the Codex-specific command and local-checkout fallback.
- [Install the pack for Claude Code](/docs/install-claude-code/) for the Claude Code command and supported manual folder layout.
- [Choose the smallest skill set](/docs/choose-skills/) when a request crosses rendering systems or ownership boundaries.
- [Use the pack in an existing project](/docs/use-in-an-existing-project/) when application rules, a renderer, and validation commands already exist.

For the contract presented to coding agents, continue to the [agent documentation](/agents/). For an existing renderer, material, or prompt workflow that must change, use the [migration guides](/migrate/).

## Understand how the pack is intended to work

The installable product is the `skills/` tree. Each published `skills/<name>/` directory contains its `SKILL.md`, license, interface metadata, and any reachable self-contained references, scripts, examples, assets, or fixtures it needs. Full examples under top-level `threejs-*/examples/`, plus repository labs, reviews, and generated media, remain repository-only and are not part of the installed payload.

Install the complete pack when you want broad routing. `threejs-choose-skills` selects from the installed inventory, so it is not the recommended standalone installation target. For a focused request with a known owner, invoke that subject skill directly instead of asking the router to rediscover an obvious route.

The current repository targets Three.js r185 and pins the package to `0.185.1`. Canonical implementations use `WebGPURenderer`, TSL, NodeMaterial families, and node-based rendering APIs. Those are source constraints, not proof that an arbitrary browser, device, or existing application already satisfies them.

## Keep project ownership separate from skill ownership

The pack owns specialist Three.js rendering guidance. It does not own a project's framework, router, application state, data transport, accessibility, deployment, or source-asset pipeline. Existing repository instructions remain in force, and a skill must not silently replace them.

When a required capability has no installed specialist owner, the correct result is an explicit gap or reduced scope. The router must not stretch a nearby procedural or image-pipeline skill over unsupported application work merely to produce a complete-looking answer.

## Verify before making technical claims

Installation proves that instruction files are available. It does not prove the native WebGPU backend, a performance envelope, a fixed bug, or a production scene's correctness.

Before implementation, record the resolved Three.js package, runtime `THREE.REVISION`, initialized renderer backend, required capabilities, target devices, and product-defined error or performance gates. After implementation, inspect the relevant final image and diagnostic artifacts directly. Use the demo registry only as a published catalog; current claims require a matching source hash, source-bound evidence record, and required artifacts.

The installed `skills/threejs-choose-skills/SKILL.md` file defines routing fields and completion conditions. Verify each route against the current project's installed inventory and acceptance bounds. The [native WebGPU validation harness](/demos/webgpu-validation-harness/) defines a backend, artifact, resource, lifecycle, and readback evidence shape; confirm its current source-bound record before use. Neither contract substitutes for running the relevant checks inside the project being changed.

## Know the practical requirements

- A coding-agent runtime that can discover local skill folders or follow explicit local-file instructions.
- Node.js for the preferred installer, repository scripts, examples, and installed-source inspection.
- The project's actual Three.js dependency and lockfile, not a remembered version label.
- A browser and device with the required WebGPU capabilities for full canonical runtime validation.
- A reproducible scene state, camera, data input, or seed for any visual acceptance claim.

If one of these requirements is missing, document the narrower result that remains supportable. Do not present fallback behavior or an attractive screenshot as proof of the canonical route.
