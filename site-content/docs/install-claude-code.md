---
kind: user-doc
slug: /docs/install-claude-code/
title: Install Three.js WebGPU Skills for Claude Code
description: Install the complete Three.js WebGPU Skill Pack for Claude Code, verify skill discovery, and preserve project-specific instructions.
h1: Install the Three.js skill pack for Claude Code
primary_query: install threejs skills for claude code
query_aliases: ["threejs webgpu skills claude code setup","add threejs agent skills to claude code"]
summary: Use the agent-specific skills CLI command to request a global Claude Code installation of the complete pack. The manual fallback is to place or link the required `skills/<name>/` directories under a Claude Code skill directory and verify discovery from an actual project.
related_skills: ["threejs-choose-skills","threejs-debugging"]
related_demos: []
related_pages: ["/docs/install/","/docs/choose-skills/","/agents/routing-and-minimal-context/","/docs/use-in-an-existing-project/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills.json","https://github.com/vercel-labs/skills"]
---

## Install the complete pack for Claude Code

Run the agent-specific command published by the repository:

```bash
npx skills@latest add linegel/threejs-complete-set-of-skill --skill '*' -g -a claude-code -y
```

This requests every skill, global scope, the Claude Code target, and non-interactive installation. Inspect the command output and the actual Claude Code skill directory after it finishes. A successful package command does not prove that the current agent session discovered the installed files.

Install the complete pack when broad routing is required. `threejs-choose-skills` chooses from the installed skill inventory and should not be treated as a replacement for its destination skills.

## Use the supported manual folder layout

For a manual personal installation, clone the repository and symlink or copy the required `skills/<name>/` directories into `~/.claude/skills/`. For a project-specific installation, use the project's `.claude/skills/` directory.

A symlink keeps one maintained source, while a copied folder becomes an independent version that needs an update policy. Preserve each complete directory from `skills/` rather than extracting only `SKILL.md`; bundled references and agent metadata may be required. Repository examples, labs, reviews, and generated media stay in the checkout and are not installed skill payload.

Do not paste the full pack into `CLAUDE.md`. Project instructions should state when and where to load skills, while the skill folders retain the detailed technical contract. Existing project rules continue to own generic application architecture and repository workflow.

## Verify discovery with broad and focused requests

First test the router without asking for code:

```text
Use $threejs-choose-skills to route a Three.js WebGPU/TSL product viewer that
needs an inspection camera, procedural material response, shadows, final output,
and visual validation. Return selected, deferred, gaps, handoffs, resources,
passes, output, and verification fields used by the route.
```

Then test one direct owner:

```text
Use $threejs-camera-controls-and-rigs to audit the existing product-inspection
camera. Preserve application UI ownership and report projection, depth,
interaction, and lifecycle assumptions before proposing changes.
```

The broad result should select the smallest useful skill intersection and report gaps without inventory padding. The focused result should not require the router to rediscover an already-known owner.

## Correct common discovery problems

- Files exist but the skill is invisible: verify the actual global or project skill path used by the current Claude Code setup.
- Only the router was installed: install the complete pack or reduce the requested scope to installed owners.
- Manual copy is stale: compare its revision and files with the intended repository source.
- Existing instructions conflict: resolve the project authority explicitly instead of concatenating two incompatible rule sets.
- The agent loads every skill: require a routing result first and pass only selected owner contracts into implementation.

The installed skill pack does not prove native WebGPU support. Record the resolved package, initialize `WebGPURenderer`, and verify the actual backend before making a canonical WebGPU claim. If WebGPU is unavailable, report the blocker unless the user explicitly asks for fallback teaching.

## Know what this setup does not provide

The pack does not include a Claude subscription, hosted runtime, managed support, production assets, or a finished renderer migration. It also does not guarantee that an external installer and every Claude Code release use an identical directory policy. The verification step is therefore part of installation, not optional troubleshooting.
