---
kind: audience
slug: /for/ai-coding-agent-users/
title: Three.js WebGPU Skills for AI Coding Agents
description: Deterministic routing, minimal context, runnable examples, and explicit evidence contracts for AI agents writing Three.js WebGPU code.
h1: Three.js WebGPU skills for AI coding agents
primary_query: three.js skills for ai coding agents
query_aliases: ["three.js webgpu agent workflow","tsl skills for coding agents"]
summary: The pack gives a coding agent explicit ownership rules, routing decisions, runnable examples, and evidence requirements. It helps the agent load less context, avoid unsupported substitutions, and leave inspectable artifacts.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-visual-validation"]
related_demos: ["debugging-contract-lab"]
related_pages: ["/agents/","/agents/routing-and-minimal-context/","/docs/install-codex/","/docs/install-claude-code/","/compare/threejs-webgpu-skill-pack-vs-general-ai-prompts/","/migrate/raw-threejs-prompts-to-agent-skills/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-debugging/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-visual-validation/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json"]
---

## Give the agent a routing problem it can verify

A broad request such as "make a WebGPU world" can activate geometry, fields, materials, motion, water, weather, camera, shadows, image-pipeline, and validation concerns. Loading every skill immediately makes ownership less clear and consumes context before the causal problem is understood.

Use [Three.js WebGPU/TSL Choose Skills](/skills/threejs-choose-skills.html) as the entry point. The router asks the agent to classify the workload, define the protected observable, identify the earliest missing causal layer, compare algorithms, and select the smallest installed skill intersection.

The installed [Choose Skills contract](/skills/threejs-choose-skills.html) requires the agent to record the installed revision and backend, define the observable and acceptance bounds, choose the earliest missing causal owner, close cross-system handoffs, assign one final-output path, and report unsupported owners as explicit gaps. Verification must test the selected cause in the composed route; compatibility teaching is selected only when the user explicitly requests it.

## Keep active context minimal

The [routing and minimal-context guide](/agents/routing-and-minimal-context/) explains the working pattern. Load the router first, then only the selected domain owners and the references they require. Record omitted skills when they are tempting but unnecessary. Defer downstream consumers until their source signal exists.

This protects against the failure mode where an agent adds geometry, compute, MRT, temporal history, bloom, and grading because each is individually plausible. The route should instead state which observable each system owns and why a cheaper alternative failed.

Use the [agent documentation hub](/agents/) for machine-facing boundaries. Installation is covered separately for [Codex](/docs/install-codex/) and [Claude Code](/docs/install-claude-code/).

## Preserve project ownership

Skills do not replace repository instructions, installed dependencies, current source, tests that encode critical behavior, or user decisions. An agent should inspect the files it will change, preserve unrelated work, and use the project's existing helpers and validation path.

Application architecture, DOM UI, accessibility, data transport, asset preparation, and business logic remain outside the visual-skill pack unless the project supplies an owner. Route-away is a useful result. It prevents the agent from inventing a pseudo-skill for an unsupported system.

## Demand evidence with the right label

The pack distinguishes measured, derived, gated, authored, and unknown quantities. An agent must not turn an authored starting point into a performance result, add unrelated lab timings, or call a page screenshot a render-target diagnostic.

Use [Three.js Visual Validation](/skills/threejs-visual-validation.html) for fixed routes, native WebGPU proof, aligned readback, resource ledgers, diagnostics, lifecycle evidence, and mutation controls. The [validation harness](/demos/webgpu-validation-harness/) documents those artifact types, but its checked summary must be regenerated when its source hash changes. Use [Three.js Debugging](/skills/threejs-debugging.html) and the [debugging contract lab](/demos/debugging-contract-lab/) when version or runtime behavior needs source-backed triage.

The result should be inspectable by a developer who did not watch the agent work. That means exact changed files, commands actually run, artifacts actually opened, limitations, and unresolved evidence gaps.

## Prefer agent skills to raw prompts when the contract matters

The [raw prompts to agent skills migration guide](/migrate/raw-threejs-prompts-to-agent-skills/) explains how to replace repeated prose with versioned, repository-backed operating contracts. The [skill pack versus general AI prompts comparison](/compare/threejs-webgpu-skill-pack-vs-general-ai-prompts/) owns the broader decision.

The advantage is not that a skill makes a model infallible. The advantage is that routing, ownership, failure conditions, and validation expectations are explicit and reviewable.

## What this page does not claim

The pack is not an agent runtime, context manager, autonomous-work guarantee, or benchmark of model quality. It does not prove token savings or implementation correctness merely because a skill was loaded. Generated explanations are not evidence until the relevant source, command, runtime behavior, and artifacts have been inspected.

Project code remains authoritative. Every coding agent can still misunderstand the request, select the wrong owner, or implement a plausible but incorrect mechanism. The purpose of the contracts is to make those decisions falsifiable and easier to review.
