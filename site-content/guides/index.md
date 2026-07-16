---
kind: hub
slug: /guides/
title: Three.js WebGPU Skill Pack Adoption Guides
description: Decision and adoption guides for choosing, installing, migrating, and verifying the Three.js WebGPU skill pack with repository-backed evidence.
h1: Three.js WebGPU skill-pack guides, organized by the decision you need to make
primary_query: three.js webgpu skill pack adoption guides
query_aliases: ["three.js agent skill decision guides","three.js webgpu skill pack guides"]
summary: Start here when you know the decision you need to make but not the page you need. Choose a path for installation, skill routing, migration, implementation, agent use, or troubleshooting.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/for/","/docs/","/migrate/","/compare/","/faq/","/pricing/"]
hero_image: /visual-validation/webgpu-validation-harness/final.design.png
hero_source: webgpu-validation-harness
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json"]
---

## Start with the decision, not the folder name

The skill pack covers rendering architecture, procedural systems, final-image work, and validation. That breadth is useful only when the first decision is clear. This hub separates adoption questions from implementation questions so that a developer or coding agent can load the smallest relevant context.

If you are still deciding whether the pack fits your work, start with [who the pack is for](/for/). Graphics engineers can follow the [rendering architecture path](/for/graphics-engineers/). Technical artists can follow the [materials and procedural-art path](/for/technical-artists/). Existing Three.js developers can use the [WebGPU adoption path](/for/threejs-developers-moving-to-webgpu/). Teams operating coding agents can begin with [the agent-user path](/for/ai-coding-agent-users/).

## Install and use the pack

Use the [documentation hub](/docs/) for operating instructions rather than product comparisons.

- [Install the skill pack](/docs/install/) for the supported installation model.
- [Install for Codex](/docs/install-codex/) for a Codex-specific path.
- [Install for Claude Code](/docs/install-claude-code/) for a Claude Code-specific path.
- [Choose the smallest skill set](/docs/choose-skills/) before loading domain skills.
- [Use the pack in an existing project](/docs/use-in-an-existing-project/) when project source and conventions already exist.

Agent-facing contracts have their own surface. Read the [agent documentation hub](/agents/) for the division between project ownership and skill ownership, then use [routing and minimal context](/agents/routing-and-minimal-context/) to keep the active context narrow.

## Migrate an existing workflow

Migration pages own step-by-step transition queries. The [migration hub](/migrate/) explains how the individual paths fit together.

- [Move from WebGLRenderer to WebGPURenderer](/migrate/webglrenderer-to-webgpurenderer/).
- [Move from GLSL ShaderMaterial to TSL](/migrate/glsl-shadermaterial-to-tsl/).
- [Move from raw Three.js prompts to agent skills](/migrate/raw-threejs-prompts-to-agent-skills/).

These guides do not assume that changing an import completes a migration. Renderer initialization, material semantics, pass ownership, output conversion, readback, and evidence all need explicit checks against the installed Three.js revision.

## Compare approaches before committing

Use the [comparison hub](/compare/) when the decision involves two named approaches.

- [Skill pack versus official Three.js documentation](/compare/threejs-webgpu-skill-pack-vs-official-threejs-docs/)
- [Skill pack versus general AI prompts](/compare/threejs-webgpu-skill-pack-vs-general-ai-prompts/)
- [Skill pack versus Three.js Game Skills](/compare/threejs-webgpu-skill-pack-vs-threejs-game-skills/)
- [Skill pack versus the Three.js Skill Plugin](/compare/threejs-webgpu-skill-pack-vs-threejs-skill-plugin/)
- [Agent skills versus Three.js MCP tools](/compare/agent-skills-vs-threejs-mcp-tools/)
- [TSL versus GLSL](/compare/threejs-tsl-vs-glsl/)
- [WebGPURenderer versus WebGLRenderer](/compare/webgpurenderer-vs-webglrenderer/)
- [RenderPipeline versus EffectComposer](/compare/renderpipeline-vs-effectcomposer/)

If the question is broader than one named competitor, use the [alternatives hub](/alternatives/), [alternatives to Three.js agent skills](/alternatives/threejs-agent-skills/), or [alternative Three.js WebGPU learning resources](/alternatives/threejs-webgpu-learning-resources/).

## Apply the pack to a concrete workload

Industry pages are workload maps, not decorative persona pages. Start with [industry workflows](/industries/), then choose [browser-game rendering](/industries/browser-games/) or [product visualization and configurators](/industries/product-visualization-and-configurators/). Each page states what the graphics skills can own and which application concerns remain outside the pack.

The pack itself costs nothing to license. The [pricing page](/pricing/) separates that fact from the real costs of engineering time, target devices, assets, tooling, and hosted services.

## Resolve a concrete question

The [FAQ hub](/faq/) is an index of questions observed in real documentation, repository, and community work. Each answer has its own canonical route.

- [Which Three.js version does the skill pack support?](/faq/which-threejs-version-does-the-skill-pack-support/)
- [Does the skill pack work with React Three Fiber?](/faq/does-the-skill-pack-work-with-react-three-fiber/)
- [How do I verify the native WebGPU backend?](/faq/how-do-i-verify-the-native-webgpu-backend/)
- [Is the skill pack free for commercial use?](/faq/is-the-threejs-skill-pack-free-for-commercial-use/)
- [Why does a WebGPU PNG have striped rows?](/faq/why-does-my-webgpu-png-have-striped-rows/)
- [Why does TSL post-processing look double tone-mapped?](/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/)

## What this hub does not claim

This page is navigation, not proof that every Three.js workload is covered. The installed package, current Three.js source, project requirements, and evidence bundles whose recorded source hashes still match remain authoritative. A lab can establish a mechanism under its declared capture contract, but it cannot establish performance on an unnamed device or success in an unrelated production scene.

The installed [Choose Skills contract](/skills/threejs-choose-skills.html) defines the routing inputs, causal-owner selection, cross-system handoffs, output ownership, explicit gaps, and verification result. The [native WebGPU validation harness](/demos/webgpu-validation-harness/) documents the intended rendering-evidence structure, but its checked summary must be regenerated when its source hash changes. Neither contract is a substitute for running the relevant checks in the project being changed.
