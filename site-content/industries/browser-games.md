---
kind: industry
slug: /industries/browser-games/
title: Three.js WebGPU Skills for Browser Games
description: Build browser-game rendering with Three.js WebGPU using camera, motion, effects, shadows, image pipelines, quality tiers, and reproducible proof.
h1: Three.js WebGPU skills for browser games
primary_query: three.js webgpu skills for browser games
query_aliases: ["webgpu game rendering with three.js","three.js tsl browser game workflow"]
summary: The pack can own the rendering layer of a browser game including camera policy, authored motion, procedural content, event effects, shadows, final-image composition, quality tiers, and visual validation. Game systems remain application responsibilities.
related_skills: ["threejs-choose-skills","threejs-camera-controls-and-rigs","threejs-procedural-motion-systems","threejs-procedural-creatures","threejs-procedural-vegetation","threejs-water-optics","threejs-rain-snow-and-wet-surfaces","threejs-particles-trails-and-effects","threejs-scalable-real-time-shadows","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["webgpu-procedural-timelines","webgpu-pooled-effects","webgpu-shadow-pipeline-integration"]
related_pages: ["/for/graphics-engineers/","/docs/choose-skills/","/docs/use-in-an-existing-project/","/compare/webgpurenderer-vs-webglrenderer/","/migrate/webglrenderer-to-webgpurenderer/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-camera-controls-and-rigs/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-motion-systems/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md"]
---

## Own the graphics layer without pretending to own the game

The browser-game route begins at the visual boundary. The application owns gameplay rules, authoritative entity state, input, networking, collision policy, physics-engine selection, save state, audio, UI, and asset delivery. The rendering route consumes declared state and turns it into a reproducible visual presentation.

Start with [Choose Skills](/skills/threejs-choose-skills.html). Classify the actual truth, interaction, camera, temporal behavior, scale, entity topology, and deployment matrix. Do not call a workload game-like to justify weaker evidence or stronger hardware assumptions.

## Build camera behavior around play and inspection

Use [Three.js Camera Controls and Rigs](/skills/threejs-camera-controls-and-rigs.html) when player follow, orbit, inspection, cutscene handoff, collision response, projection, depth, or floating origin changes the scene contract.

Define the source of input, update order, collision authority, interpolation, reset behavior, and exact handoff between modes. A camera discontinuity must invalidate any velocity or temporal history that depended on the previous projection. Reproducible design and far views are useful for validation, but the project also needs its representative play path.

## Separate gameplay state from authored motion

Use [Three.js Procedural Motion Systems](/skills/threejs-procedural-motion-systems.html) for authored launch phases, recoil, spin, springs, orbiting parts, staged destruction, and deterministic transform sequences. Keep authoritative movement, physics, and network reconciliation in the game layer.

The [procedural timelines demo](/demos/webgpu-procedural-timelines/) provides accepted mechanism evidence for launch, spin, quaternion, interpolation, debris, and compute-storage routes. Its current-adapter GPU timing remains incomplete, so the demo cannot set a frame budget for another game.

## Route world systems by the state they own

Use [Three.js Procedural Creatures](/skills/threejs-procedural-creatures.html) when the visual workload requires generated bodies, semantic rigs, authored locomotion, or repeated creature populations. Keep authoritative entity position, collision, and reconciliation in the game layer.

Vegetation, water, and weather keep separate state and validity contracts. Use [Three.js Procedural Vegetation](/skills/threejs-procedural-vegetation.html) for generated plants and population LOD, [Three.js Water Optics](/skills/threejs-water-optics.html) for bounded or coastal water state and presentation, and [Three.js Rain, Snow, and Wet Surfaces](/skills/threejs-rain-snow-and-wet-surfaces.html) for precipitation, deposition, wetness, and their handoffs. The [Creature Habitat demo](/demos/creature-habitat/) documents an integration of those four domains under shared units, wind, contact snapshots, and output ownership. Its checked summary does not match the live source hash and must be regenerated before citation as current evidence.

## Treat event effects as bounded systems

Use [Three.js Particles, Trails, and Effects](/skills/threejs-particles-trails-and-effects.html) for sparks, debris, trails, plasma, shockwaves, and other transient visual events. Define stable event identity, pool capacity, overflow behavior, dropped-event policy, lifetime, compaction, and the relationship to scene depth.

The [pooled-effects demo](/demos/webgpu-pooled-effects/) shows ordered compute dispatch, stable free-list identity, indirect counts, and captured output. Its overall evidence status remains incomplete because live soft-depth and GPU timestamp claims are not accepted. If the page displays this demo, the incomplete status must remain visible.

## Select shadows for a moving camera

Begin with ordinary light shadows. Add cascaded, tiled, or cached coverage only when the moving camera, world extent, invalidation pattern, and measured target cost require it. Tile shadows solve coverage; they are not evidence of tile-GPU performance.

Use [Three.js Scalable Real-Time Shadows](/skills/threejs-scalable-real-time-shadows.html) for that decision. The [shadow-pipeline integration demo](/demos/webgpu-shadow-pipeline-integration/) has accepted evidence that child shadow targets feed a single final-output graph with one tone-map and output-transform owner.

## Compose one final image graph

Use [Three.js Image Pipeline](/skills/threejs-image-pipeline.html) when multiple consumers need scene color, depth, normals, velocity, emissive data, identifiers, or histories. Allocate only signals with named consumers. An outline or pick path may justify an identifier; bloom alone does not justify an emissive attachment unless selective emission is required.

Keep output conversion single-owned and reset histories after camera cuts, tier transitions, projection changes, or disocclusion conditions defined by the project. The [Creature Habitat demo](/demos/creature-habitat/) documents the intended composition of subject, environment, camera, shadow, and output graph, but its source-mismatched bundle is not current correctness evidence. It is an integration demo, not a game benchmark.

## Build quality tiers from the measured bottleneck

Define named quality tiers only when the project configuration or an owner manifest defines them, and state the primary play observable each tier must preserve. Classify pressure before changing quality. Fill pressure suggests DPR, overdraw, or pass scale. CPU submit pressure suggests culling or representation changes. Compute pressure suggests solver extent or dispatch cadence. Memory pressure suggests attachment, history, or residency changes.

Use [Three.js Visual Validation](/skills/threejs-visual-validation.html) with a fixed input trace, camera path, seed, event sequence, and quality state. Measure the composed frame on named desktop and mobile targets, including sustained behavior. Do not add timings from isolated demos.

## What this page does not claim

The pack is not a game engine. It does not own ECS architecture, networking, anticheat, physics-engine choice, collision truth, audio, UI, accessibility, asset import, compression, build delivery, or browser fallback unless fallback teaching is explicitly requested.

No local demo is a shipped customer game. Even source-matched correctness images do not prove input latency, thermal behavior, device coverage, or production frame time. The project must supply its own target matrix, representative content, play trace, failure controls, and acceptance limits.
