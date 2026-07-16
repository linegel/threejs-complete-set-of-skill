---
kind: agent-doc
slug: /agents/routing-and-minimal-context/
title: Route Three.js Agent Skills with Minimal Context
description: Route a Three.js WebGPU request to the smallest installed skill set while preserving source precedence, ownership, capability gates, and gaps.
h1: Route Three.js tasks with minimal context
primary_query: threejs agent skill routing
query_aliases: ["load minimal threejs skill context","threejs choose skills routing contract"]
summary: Enumerate the installed skills, identify the earliest missing causal system, and load only the owners needed to produce and verify it. A route returns minimal selected owners, condition-bound deferred owners, explicit gaps, handoffs, resources, passes, output, and verification.
related_skills: ["threejs-choose-skills","threejs-debugging","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/docs/choose-skills/","/migrate/raw-threejs-prompts-to-agent-skills/","/faq/how-do-i-verify-the-native-webgpu-backend/","/docs/use-in-an-existing-project/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json"]
---

## Intersect the request with the installed inventory

An agent must enumerate the available `threejs-*` skills before composing a broad route. Route only to that intersection. A skill mentioned in an old prompt, documentation page, or model memory is unavailable if it is not installed in the selected source.

Return the current route fields, including only those the request uses:

- `selected`: the minimal installed owners required now.
- `deferred`: skills that become necessary only if a named condition occurs.
- `gaps`: required inputs or owners that are unavailable.
- `handoffs`: ordered producer-consumer contracts.
- `resources` and `passes`: allocated GPU data and execution with named consumers.
- `output`: one final owner, tone map, and conversion path.
- `verification`: evidence that tests the selected cause.

A gap is not an invitation to rename another skill. Block that part of the request, reduce scope, or use official domain guidance while preserving the handoff boundary. Do not produce an exhaustive list of irrelevant installed skills.

## Classify the workload before selecting algorithms

Domain labels such as `game`, `product viewer`, or `scientific scene` are insufficient. Record the intent, truth or style contract, representation, interaction, temporal behavior, scale, topology, view pattern, residency, deployment targets, and permissible error.

Then state the primary observable and earliest missing layer. A useful causal record answers:

- What source or data is authoritative?
- What must a user see or measure?
- Which coordinate frame and units apply?
- What geometry, field, material, transport, motion, camera, or image transform is first missing?
- Which candidate algorithms could produce it?
- What evidence rejects the alternatives?
- What no-post view will expose the mechanism?

Do not select compute, MRT, ray marching, temporal accumulation, or maximal geometry because it sounds advanced. Select it only when the workload and measured or derived cost contract justify it.

## Assign one owner per resource and decision

The route manifest should identify the primary causal owner plus any data, render, and validation owners. Every allocated scene color, depth, normal, velocity, identifier, history, tone map, output transform, and adaptive-quality control needs one owner or an explicit `not used` value.

Load `threejs-image-pipeline` when several image-space consumers genuinely share a scene pass, attachment, history, ordering, or final presentation. Do not create a full MRT layout for one isolated effect. The image-pipeline owner must compare each shared output with reconstruction or a narrow rerender on the actual target.

Load `threejs-visual-validation` whenever a route makes quantitative, temporal, adaptive, compute, or sustained-performance claims. Keep ordinary focused validation with the owning subject skill when a formal cross-system evidence bundle is unnecessary.

## Hand off only the context an owner needs

After routing, pass destination skills a compact manifest rather than the full router body. Include:

```text
installed package, runtime revision, backend, and feature gates
observable, truth contract, units, coordinate frame, and acceptance bounds
primary owner plus selected, deferred, and gap skill IDs
ordered handoffs with producers, consumers, versions, and invalidation
resources, formats, physical extents, lifetimes, and consumers
passes, execution order, histories, and reset policy
final-output owner, tone map, and conversion
verification for every acceptance bound
```

The destination skill can then implement its mechanism without carrying unrelated ocean, vegetation, particle, or post-processing guidance. This keeps the active context auditable and makes accidental cross-owner changes easier to spot.

## Use broad and focused prompt forms deliberately

Broad request:

```text
Use $threejs-choose-skills to route this Three.js WebGPU/TSL scene. Preserve the
project's existing application rules. Record the installed revision and actual
backend, classify the workload, identify the earliest missing cause, and return
selected, deferred, and gap skills with handoffs, resources, passes, output, and verification.
Do not implement until the route and acceptance evidence are explicit.
```

Focused request:

```text
Use $threejs-image-pipeline to audit this existing shared RenderPipeline. Keep
the current scene and no-post baseline. Inventory every pass output, consumer,
format, physical extent, history, disable path, tone map, and output transform.
Do not add an MRT output without comparing it with the narrower alternative.
```

Debug request:

```text
Use $threejs-debugging for this concrete r185 runtime failure. Freeze the failing
configuration, inspect installed source and migration history, preserve the
suspected renderer and material path, and classify the narrowest proven action.
```

## Reject predictable routing failures

Do not route `make it beautiful` directly to bloom, grading, or AO. Identify the missing visual cause first. Do not call a workload game-like to weaken accuracy or hardware assumptions. Do not merge source/world/view/screen spaces without an explicit conversion and owner.

Do not apply two output transforms. Either the pipeline applies its configured color transform, or explicit `renderOutput(...)` owns presentation and `renderPipeline.outputColorTransform = false`. After changing `renderPipeline.outputNode` or `renderPipeline.outputColorTransform`, set `renderPipeline.needsUpdate = true`. Do not share histories or velocities across cameras or time conventions just because their names match.

Do not teach fallback automatically. The pack's canonical route remains native WebGPU. Compatibility guidance activates only after an explicit fallback request and does not redefine the flagship architecture.

## Validate the route itself

Treat the installed `skills/threejs-choose-skills/SKILL.md` route-result shape and completion conditions as the routing contract. Validate each route against the current project's installed inventory, required backend and capabilities, ordered handoffs, resource consumers, output ownership, acceptance bounds, and project-level verification. A route is not proven by documentation prose or a catalog entry.

Routing validation is planning-only and does not render. Rendering claims still need the selected implementation lab or the [native WebGPU validation harness](/demos/webgpu-validation-harness/) applied to the project under test.
