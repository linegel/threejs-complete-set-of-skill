---
kind: user-doc
slug: /docs/install/
title: Install the Three.js WebGPU Skill Pack
description: Install the complete Three.js WebGPU Skill Pack with the open skills CLI, verify discovery, and use a manual fallback when needed.
h1: Install the Three.js WebGPU Skill Pack
primary_query: install threejs agent skill pack
query_aliases: ["threejs webgpu skills installation","add threejs skills to ai coding agent"]
summary: List the available skills, then install the complete pack so the router can select from the real installed inventory. After installation, verify that your agent can discover threejs-choose-skills; this does not by itself prove WebGPU availability.
related_skills: ["threejs-choose-skills"]
related_demos: []
related_pages: ["/docs/install-codex/","/docs/install-claude-code/","/docs/use-in-an-existing-project/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills.json","https://github.com/vercel-labs/skills"]
---

## Check the installation prerequisites

The preferred path uses the open `skills` CLI through `npx`. Confirm that Node.js and `npx` are available, then decide whether the pack belongs to one project or to a user's agent configuration. The generic command below lets the installer use its normal project-scoped discovery behavior; the Codex and Claude Code pages provide explicit agent and global-scope commands.

The target agent must be able to discover local skill folders or follow an instruction that names a local `SKILL.md` file. Installing files into an arbitrary directory is not sufficient if the agent never scans or references that directory.

## List the pack before installing it

Run the discovery command first:

```bash
npx skills@latest add linegel/threejs-complete-set-of-skill --list
```

This should list the skills discovered in the repository without asking the agent to route a task. Use the output to confirm the source and the intended inventory. If discovery cannot find valid `SKILL.md` files, stop and correct the source or installer path rather than constructing a partial manual inventory from memory.

## Install the complete pack

Install every published skill:

```bash
npx skills@latest add linegel/threejs-complete-set-of-skill --skill '*'
```

The complete install matters because `threejs-choose-skills` intersects a task with the skills that are actually present. Installing the router alone leaves it unable to hand work to absent subject owners. If you need only one known mechanism and do not need routing, a focused installation can be valid, but the resulting agent must not claim broader pack coverage.

For an explicit agent target, continue with [Codex installation](/docs/install-codex/) or [Claude Code installation](/docs/install-claude-code/).

## Verify discovery, not just command success

Inspect the target agent's project or global skill location and confirm that `threejs-choose-skills` plus the expected subject skills are present. Open at least one installed `SKILL.md` file and verify that its frontmatter contains the matching `name` and a usable `description` trigger.

Then ask the agent for a routing-only result. A useful verification prompt is:

```text
Use $threejs-choose-skills to route a Three.js WebGPU scene that needs a camera,
procedural material, final-image pipeline, and visual validation. Do not write
code. Return the route's selected, deferred, gaps, handoffs, resources, passes,
output, and verification fields, and name the primary causal owner.
```

The installed `skills/threejs-choose-skills/SKILL.md` file defines the current route-result shape and completion conditions. Verify the result against the skills actually installed in the target agent and the current project's acceptance bounds.

## Correct common installation failures

If the agent cannot see the files, inspect the installer-selected directory for that agent and scope. Do not assume a global install is visible to a project-scoped runtime, or the reverse.

If the target runtime does not support the CLI, clone the repository and point the runtime at the required `skills/<name>/` directories. Preserve each complete directory from `skills/`; repository examples, labs, reviews, and generated media remain checkout-only. Keep one authoritative copy when possible. A copied manual installation needs an explicit update process or it will drift from the repository.

If only `threejs-choose-skills` was installed, either install the complete pack or limit the request to routing across the skills that are genuinely available. The router must report owner gaps rather than fabricate coverage.

If installation succeeds but WebGPU is unavailable, installation is still valid. The canonical rendering route is blocked until its backend gate passes. Fallback teaching belongs to a separate skill and only activates when the user explicitly asks how to apply fallback.

## What installation does not include

The pack does not install Three.js into the user's application, select a graphics device, convert existing GLSL, migrate EffectComposer, provide production assets, or validate a target scene. Those are project tasks with their own source, migration, and evidence requirements. Continue to [using the pack in an existing project](/docs/use-in-an-existing-project/) before asking an agent to modify an established codebase.
