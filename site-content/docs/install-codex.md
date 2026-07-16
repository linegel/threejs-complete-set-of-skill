---
kind: user-doc
slug: /docs/install-codex/
title: Install Three.js WebGPU Skills for Codex
description: Install the complete Three.js WebGPU Skill Pack for Codex, verify skill discovery, and route broad graphics tasks through the in-pack router.
h1: Install the Three.js skill pack for Codex
primary_query: install threejs skills for codex
query_aliases: ["threejs webgpu skills codex setup","add threejs agent skills to codex cli"]
summary: Use the agent-specific skills CLI command to request a global Codex installation of the complete pack. If that installation is not discoverable, keep the repository local and add a narrow AGENTS.md rule that points Codex to the matching skill files.
related_skills: ["threejs-choose-skills","threejs-debugging"]
related_demos: []
related_pages: ["/docs/install/","/docs/choose-skills/","/agents/routing-and-minimal-context/","/docs/use-in-an-existing-project/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills.json","https://github.com/vercel-labs/skills"]
---

## Install the complete pack for Codex

Run the command published by the repository's machine-readable catalog:

```bash
npx skills@latest add linegel/threejs-complete-set-of-skill --skill '*' -g -a codex -y
```

The flags request all skills, global scope, the Codex target, and non-interactive confirmation. They do not prove where a particular Codex build reads skills, so inspect the installer output and the resulting agent directory instead of treating exit status as discovery proof.

The full-pack selection is intentional. `threejs-choose-skills` is an in-pack router for broad requests, not the recommended standalone installation target. A router cannot hand a material, camera, water, shadow, or validation task to a destination skill that was never installed.

## Use a local-checkout fallback when needed

If the installed skills are not visible to Codex, clone or retain a local checkout of the repository and add a narrow project instruction. For example:

```text
For Three.js WebGPU work, read the matching skills/threejs-*/SKILL.md file from the
configured skill-pack checkout. When a task spans multiple rendering systems,
read skills/threejs-choose-skills/SKILL.md first and then only the skills it selects.
```

Put repository-specific authority in the project's existing `AGENTS.md` rather than copying the complete skill text into that file. The local checked-in project instructions continue to own workflow, architecture, safety, and verification. The graphics pack owns only the Three.js concerns within its declared scope.

When both a project-local skill and an older global copy exist, use the source selected by the project's instructions. Do not merge instructions from two revisions into one route.

## Verify that Codex can route to installed owners

Use a routing-only prompt before authorizing implementation:

```text
Use $threejs-choose-skills to plan a Three.js WebGPU/TSL scene with a bounded
water surface, inspection camera, exposure, and visual validation. Report the
installed revision and backend checks required, then return selected, deferred,
gaps, handoffs, resources, passes, output, and verification fields used by the
route. Do not write implementation code.
```

The result should distinguish routing from execution. `threejs-choose-skills` should identify the smallest installed intersection; destination skills should own their mechanisms. It should also identify unsupported application work instead of assigning it to a graphics skill.

For a known focused task, bypass broad routing:

```text
Use $threejs-debugging to diagnose this version-dependent WebGPURenderer
initialization failure. Preserve the existing renderer path and build a minimal
reproduction before recommending an upgrade or workaround.
```

## Diagnose setup failures precisely

- Skill not found: inspect the Codex directory and scope reported by the installer.
- Global copy ignored: use project-scoped installation or an explicit local-checkout rule supported by the current Codex setup.
- Skill text is stale: compare the selected file with the intended repository revision before debugging Three.js behavior.
- Router returns owner gaps: install the complete pack or accept the reduced scope; do not rename a nearby skill.
- Codex loads the whole repository: tighten the instruction to the router and selected destination skills.

Installation does not verify the native backend. A `WebGPURenderer` instance can use another backend, while the pack's canonical routes require an initialized native-WebGPU check. Use the [skill-selection guide](/docs/choose-skills/) for that preflight and the [existing-project guide](/docs/use-in-an-existing-project/) before changing an established application.

## Preserve an honest support boundary

This setup does not provide a hosted Codex runtime, model subscription, managed migration, or guaranteed compatibility with every Codex release. The current installer and Codex environment remain external dependencies. When their behavior differs from the checked-in command, record the observed path and use the narrow local-file fallback rather than claiming that an unverified global install works.
