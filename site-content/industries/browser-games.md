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
related_demos: ["creature-habitat","webgpu-procedural-timelines","webgpu-pooled-effects","webgpu-shadow-pipeline-integration"]
related_pages: ["/for/graphics-engineers/","/docs/choose-skills/","/docs/use-in-an-existing-project/","/compare/webgpurenderer-vs-webglrenderer/","/migrate/webglrenderer-to-webgpurenderer/"]
hero_image: /visual-validation/creature-habitat/final.design.png
hero_source: creature-habitat
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/integration-labs/creature-habitat/contract.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/integration-labs/creature-habitat/lab.manifest.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/visual-validation/creature-habitat/evidence-summary.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-camera-controls-and-rigs/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-motion-systems/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md"]
---

## Own the graphics layer without pretending to own the game

The browser-game route begins at the visual boundary. The application owns gameplay rules, authoritative entity state, input, networking, collision policy, physics-engine selection, save state, audio, UI, and asset delivery. The rendering route consumes declared state and turns it into a reproducible visual presentation.

Start with [Choose Skills](/skills/threejs-choose-skills.html). Classify the actual truth, interaction, camera, temporal behavior, scale, entity topology, and deployment matrix. Do not call a workload game-like to justify weaker evidence or stronger hardware assumptions.

## Use a concrete reference workload

The repository's reference workload is [Creature Habitat](/demos/creature-habitat/), not an imaginary shipped game. It uses one world unit per metre, seconds for the shared timebase, an 80 m × 80 m ground plane, a bounded eight-contact registry, one lit scene submission, and one primary MRT with output, normal, emissive, and velocity signals. The scene integrates creatures, vegetation, bounded water, weather, camera state, shadows, and final presentation.

Its accepted correctness evidence covers the current source, native `WebGPURenderer`, the owner graph, contact and subject readbacks, fixed cameras, two deterministic seeds, resource inventories, and lifecycle closure. It does not contain finite GPU timestamp windows, named-adapter performance, input latency, a production asset stream, networking, or a representative player trace. Its declared 16.67 ms tier target is a design gate, not a measured result.

Use the same kind of contract for a real game:

- Positions, distances, bounds, and contact radii use metres in one declared world frame; velocity uses metres per second and time uses seconds.
- Gameplay publishes immutable current and previous entity transforms, stable entity IDs, bounded contact events, and camera intent. Rendering never becomes the authority for collision or reconciliation.
- The representative play trace names the camera path, input sequence, spawn set, weather state, event burst, quality tier, canvas size in physical pixels, DPR, and target browser/device.
- Visual acceptance names what must survive degradation: readable subject silhouette, stable camera control, collision-consistent contact effects, shadow/subject parity, and one correct final output.

## Assign one owner to every visible cause

| Cause or state | Primary owner | Consumes | Must not own |
|---|---|---|---|
| Gameplay, physics, collision, networking, input intent | Game application | Player and server state | Render-only interpolation becoming authoritative truth |
| Camera pose, projection, handoff, jitter, reset | [Camera Controls and Rigs](/skills/threejs-camera-controls-and-rigs.html) | Camera intent, subject bounds, world origin | Gameplay input mapping or collision truth |
| Authored transform sequences | [Procedural Motion Systems](/skills/threejs-procedural-motion-systems.html) | Stable actor ID and authoritative seconds | Network reconciliation or rigid-body simulation |
| Generated creature body, pose, locomotion presentation, contact publication | [Procedural Creatures](/skills/threejs-procedural-creatures.html) | Authoritative entity transform and habitat inputs | Entity authority or gameplay collision |
| Vegetation placement, deformation, and population representation | [Procedural Vegetation](/skills/threejs-procedural-vegetation.html) | World scale, wind, contact snapshot | Terrain, weather, or collision ownership |
| Bounded water state and optical presentation | [Water Optics](/skills/threejs-water-optics.html) | Metres, seconds, wind, contact events | General fluid gameplay or body physics |
| Precipitation, deposition, wetness, snow, shared wind and time | [Rain, Snow, and Wet Surfaces](/skills/threejs-rain-snow-and-wet-surfaces.html) | Receiver contracts and world frame | Global gameplay clock |
| Transient sparks, trails, debris, and shockwaves | [Particles, Trails, and Effects](/skills/threejs-particles-trails-and-effects.html) | Stable event IDs, event frame, scene depth | Damage, hit authority, or unbounded allocation |
| Shadow topology, coverage, filtering, and cache validity | [Scalable Real-Time Shadows](/skills/threejs-scalable-real-time-shadows.html) | Casters, receivers, camera, light | Lighting design or duplicate subject transforms |
| Shared pass signals, histories, graph mutation, tone map, output conversion | [Image Pipeline](/skills/threejs-image-pipeline.html) | Renderable scene state from the causal owners | Reconstructing missing gameplay or scene truth |
| Capture, diagnostics, resource accounting, and claim verdicts | [Visual Validation](/skills/threejs-visual-validation.html) | Frozen workload and acceptance limits | Defining the rendering mechanism it measures |

## Build camera behavior around play and inspection

Use [Three.js Camera Controls and Rigs](/skills/threejs-camera-controls-and-rigs.html) when player follow, orbit, inspection, cutscene handoff, collision response, projection, depth, or floating origin changes the scene contract.

Define the source of input, update order, collision authority, interpolation, reset behavior, and exact handoff between modes. A camera discontinuity must invalidate any velocity or temporal history that depended on the previous projection. Reproducible design and far views are useful for validation, but the project also needs its representative play path.

## Separate gameplay state from authored motion

Use [Three.js Procedural Motion Systems](/skills/threejs-procedural-motion-systems.html) for authored launch phases, recoil, spin, springs, orbiting parts, staged destruction, and deterministic transform sequences. Keep authoritative movement, physics, and network reconciliation in the game layer.

The [procedural timelines demo](/demos/webgpu-procedural-timelines/) has a current-source passing mechanism verdict for launch, spin, quaternion, interpolation, debris, and compute-storage routes. Visual correctness and lifecycle remain insufficient and GPU timing is not claimed, so it cannot set a frame budget for another game.

## Route world systems by the state they own

Use [Three.js Procedural Creatures](/skills/threejs-procedural-creatures.html) when the visual workload requires generated bodies, semantic rigs, authored locomotion, or repeated creature populations. Keep authoritative entity position, collision, and reconciliation in the game layer.

Vegetation, water, and weather keep separate state and validity contracts. Use [Three.js Procedural Vegetation](/skills/threejs-procedural-vegetation.html) for generated plants and population LOD, [Three.js Water Optics](/skills/threejs-water-optics.html) for bounded or coastal water state and presentation, and [Three.js Rain, Snow, and Wet Surfaces](/skills/threejs-rain-snow-and-wet-surfaces.html) for precipitation, deposition, wetness, and their handoffs. [Creature Habitat](/demos/creature-habitat/) has source-matched accepted evidence for integrating those four domains under shared units, wind, contact snapshots, and output ownership.

The composed cause-to-image path is:

```text
authoritative game state in metres and seconds
  -> current/previous creature pose, bounds, and bounded contact snapshot
  -> vegetation deformation + water ripples + weather receiver state
  -> camera pose/projection + one shadow owner
  -> one lit scene submission into output/normal/emissive/velocity signals
  -> admitted outline, temporal, and presentation consumers
  -> one tone-map and one output conversion
  -> physical canvas pixels
```

Every arrow needs a producer, consumer, units, frame or origin, sample time, version, reset condition, and lifetime owner. A contact event may affect water and grass, but it must remain the same frozen event snapshot rather than being independently rediscovered by each renderer.

## Treat event effects as bounded systems

Use [Three.js Particles, Trails, and Effects](/skills/threejs-particles-trails-and-effects.html) for sparks, debris, trails, plasma, shockwaves, and other transient visual events. Define stable event identity, pool capacity, overflow behavior, dropped-event policy, lifetime, compaction, and the relationship to scene depth.

The [pooled-effects demo](/demos/webgpu-pooled-effects/) shows ordered compute dispatch, stable free-list identity, indirect counts, and captured output. Its overall evidence status remains incomplete because live soft-depth and GPU timestamp claims are not accepted. If the page displays this demo, the incomplete status must remain visible.

## Select shadows for a moving camera

Begin with ordinary light shadows. Add cascaded, tiled, or cached coverage only when the moving camera, world extent, invalidation pattern, and measured target cost require it. Tile shadows solve coverage; they are not evidence of tile-GPU performance.

Use [Three.js Scalable Real-Time Shadows](/skills/threejs-scalable-real-time-shadows.html) for that decision. The [shadow-pipeline integration demo](/demos/webgpu-shadow-pipeline-integration/) has accepted evidence that child shadow targets feed a single final-output graph with one tone-map and output-transform owner.

## Compose one final image graph

Use [Three.js Image Pipeline](/skills/threejs-image-pipeline.html) when multiple consumers need scene color, depth, normals, velocity, emissive data, identifiers, or histories. Allocate only signals with named consumers. An outline or pick path may justify an identifier; bloom alone does not justify an emissive attachment unless selective emission is required.

Keep output conversion single-owned and reset histories after camera cuts, tier transitions, projection changes, or disocclusion conditions defined by the project. [Creature Habitat](/demos/creature-habitat/) provides current accepted evidence for its subject, environment, camera, shadow, and output composition. It is an integration demo, not a game benchmark, latency test, or target-device performance claim.

## Trade quality against named resources

Define named quality tiers only when the project configuration or an owner manifest defines them, and state the primary play observable each tier must preserve. Classify pressure before changing quality. Fill pressure suggests DPR, overdraw, or pass scale. CPU submit pressure suggests culling or representation changes. Compute pressure suggests solver extent or dispatch cadence. Memory pressure suggests attachment, history, or residency changes.

Creature Habitat exposes three executable configurations. These are reference resource policies, not measured hardware classes:

| Policy | Declared configuration | Resource cost changed | Invariant preserved |
|---|---|---|---|
| Hero | 4 hero creatures; high vegetation; full-scale ultra water; high weather; 2048² shadow map; DPR cap 2 | Highest creature detail, water grid work, precipitation state, shadow texels, physical pixels, and attachment fill | Shared units and wind, frozen contacts, subject consistency, one final owner |
| Balanced | 10 of 12 crowd-capacity creatures; medium vegetation; 0.5 water scale; medium weather; 1024² shadow map; DPR cap 1.5 | Reduces water cells, shadow texels, vegetation/weather work, and maximum physical pixels | Same ownership and contact semantics |
| Budgeted | 16 of 20 background-capacity creatures; low vegetation; 0.375 water scale; budgeted weather; 512² shadow map; 0.85 scene scale; DPR cap 1 | Reduces per-subject detail, water cells, shadow texels, precipitation work, and scene pixels while allowing a larger low-detail population | Same authoritative locomotion, contacts, ownership, and final-output contract |

Account for each lever explicitly:

| Lever | Named resource cost | Valid degradation test |
|---|---|---|
| DPR and scene scale | Physical pixel count grows with `(CSS width × DPR × scene scale) × (CSS height × DPR × scene scale)`; color, depth, MRT, bandwidth, and fill follow | Subject readability and control feedback remain acceptable on the representative camera path |
| MRT attachment | One texture allocation and write bandwidth per admitted output, plus any history copy; Creature Habitat admits output, normal, emissive, and velocity because each has a named consumer | Remove an attachment only when its consumer is also removed |
| Shadow-map side length | One depth allocation grows with side length squared, plus caster vertex and fragment work | Preserve required receiver coverage, contact stability, and caster/visible deformation parity |
| Creature representation and population | Geometry/storage residency, animation or deformation work, culling, visible and shadow submissions | Change representation before silently changing authoritative population |
| Water scale | Heightfield storage, fixed-step compute, normal/caustic reconstruction, and water mesh density | Preserve contact location, bounded surface behavior, and optical continuity |
| Weather branch | Particle/storage capacity, recurrent compute when selected, impact aging/spawn, transparency and overdraw | Analytic degradation must preserve weather direction and receiver-state meaning |
| Event pool | Storage lanes, compaction/indirect-count work, transparent overdraw, and scene-depth sampling | Apply a declared overflow and dropped-event policy; never allocate without a bound |

Use [Three.js Visual Validation](/skills/threejs-visual-validation.html) with a fixed input trace, camera path, seed, event sequence, and quality state. Measure the composed frame on named desktop and mobile targets, including sustained behavior. Do not add timings from isolated demos.

## Close deployment and interaction constraints

- **Browser and device:** initialize `WebGPURenderer` asynchronously and prove the native WebGPU backend on every claimed browser/device class. Define physical canvas size, DPR cap, GPU memory ceiling, sustained power/thermal observation window, and behavior when WebGPU is unavailable. Creature Habitat deliberately blocks fallback; it cannot prove a WebGL route.
- **Assets and delivery:** the game owns mesh, animation, texture, audio, compression, streaming, cache, and license policy. Record source scale, coordinate conversion, LOD bounds, texture encodings, upload peaks, and the state shown while assets are missing or evicted.
- **Controls:** provide one input-to-intent layer for mouse, keyboard, touch, gamepad, pointer lock, and focus changes. Only the active camera owner writes the pose. Pause or resynchronize on lost focus instead of integrating a large wall-clock delta.
- **Lifecycle:** define resize and DPR transactions, quality-tier rebuilds, camera-cut and respawn resets, background-tab behavior, route teardown, device-loss recovery, and disposal of render targets, storage, listeners, controls, and animation loops.
- **Accessibility:** expose instructions, status, menus, and critical game state in DOM or another assistive channel; support keyboard and remappable controls; do not encode essential state only through color, particles, camera shake, or audio; honor reduced-motion needs for shake, flashes, trails, and weather intensity. These remain application responsibilities.

## Know when this route is a poor fit

Choose a full game engine when the primary need is an editor, physics, navigation, networking, console deployment, asset cooking, or an integrated gameplay framework. Choose a simpler Three.js/WebGL or 2D/DOM/Canvas route when the target browser matrix cannot require WebGPU or the workload does not need the specialist rendering systems. Prefer baked animation, sprite sheets, or authored assets when runtime procedural generation adds cost without required variation. Use a dedicated physics or simulation library when visual motion must affect authoritative collisions.

## What this page does not claim

The pack is not a game engine. It does not own ECS architecture, networking, anticheat, physics-engine choice, collision truth, audio, UI, accessibility, asset import, compression, build delivery, or browser fallback unless fallback teaching is explicitly requested.

No local demo is a shipped customer game. Even source-matched correctness images do not prove input latency, thermal behavior, device coverage, or production frame time. The project must supply its own target matrix, representative content, play trace, failure controls, and acceptance limits.
