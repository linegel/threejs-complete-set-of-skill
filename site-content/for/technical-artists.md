---
kind: audience
slug: /for/technical-artists/
title: Three.js WebGPU and TSL Skills for Technical Artists
description: Material, procedural form, motion, camera, and final-image guidance for technical artists working in Three.js WebGPU and TSL.
h1: Three.js WebGPU and TSL skills for technical artists
primary_query: three.js skills for technical artists
query_aliases: ["three.js tsl workflow for technical artists","procedural three.js skills for technical artists"]
summary: Use the pack to translate a visual target into inspectable causes such as silhouette, material response, motion, camera, lighting signals, and final output. Each layer can be authored and diagnosed before downstream effects are added.
related_skills: ["threejs-choose-skills","threejs-procedural-materials","threejs-procedural-geometry","threejs-object-sculptor","threejs-procedural-motion-systems","threejs-camera-controls-and-rigs","threejs-image-pipeline","threejs-visual-validation"]
related_demos: ["webgpu-procedural-timelines"]
related_pages: ["/docs/use-in-an-existing-project/","/compare/threejs-tsl-vs-glsl/","/industries/product-visualization-and-configurators/","/for/graphics-engineers/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-materials/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-procedural-geometry/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-object-sculptor/SKILL.md","https://threejs.org/docs/TSL.html"]
---

## Find the earliest missing visual cause

A visual target can fail at topology, silhouette, material, illumination, motion, camera, or image transformation. Post-processing cannot repair the wrong outline, a broken BRDF, missing shadow transport, or an unstable inspection camera. Use [Choose Skills](/skills/threejs-choose-skills.html) to identify the earliest missing layer before choosing an implementation technique.

This makes iteration more direct. A no-post baseline answers whether the subject already reads. A material diagnostic answers whether albedo, roughness, normal, emission, and footprint data are coherent. A fixed camera answers whether the composition changed or the mechanism changed.

## Author material identity in TSL

Use [Three.js Procedural Materials](/skills/threejs-procedural-materials.html) when the observable is surface identity. Start with the BRDF and material channels, then add filtering, specular antialiasing, atlas or triplanar behavior, wetness, emission, and dissolves only where the target needs them.

Treat material validation as project-specific. Capture the material channels, filtering behavior, shadow parity, and no-post output from the scene being changed rather than attaching an incomplete general material lab as proof.

Read [TSL versus GLSL](/compare/threejs-tsl-vs-glsl/) when deciding how an existing shader concept maps into the node system. The comparison owns that query; this page owns the technical-artist workflow around it.

## Change geometry only when geometry owns the result

Use [Three.js Procedural Geometry](/skills/threejs-procedural-geometry.html) when vertices, indices, normals, UVs, material groups, or generated topology must change. Do not replace an authoritative product, CAD, or scanned silhouette with procedural geometry just because a generator is available.

[Three.js Object Sculptor](/skills/threejs-object-sculptor.html) is appropriate for quality-gated procedural reconstruction from a reference when the requested output is an authored, action-ready procedural object. The [tower-ship sculptor demo](/demos/webgpu-tower-ship-sculptor/) documents a semantic object contract with hierarchy, materials, sockets, and interaction structure. Its checked evidence does not match the live source hash and must be regenerated before citation as proof. It is not a general mesh-repair or asset-import pipeline.

## Stage motion and camera as authored systems

Use [Three.js Procedural Motion Systems](/skills/threejs-procedural-motion-systems.html) for transform phases, springs, rotating frames, launch sequences, and deterministic staging. The [procedural timelines demo](/demos/webgpu-procedural-timelines/) exposes launch, spin, debris, quaternion, interpolation, and compute-storage mechanisms under fixed routes.

Use [Three.js Camera Controls and Rigs](/skills/threejs-camera-controls-and-rigs.html) when framing, orbit, inspection, projection, depth, handoff, or floating origin changes the result. Near, design, profile, and far views should be reproducible rather than adjusted by hand for every screenshot.

## Add final-image work after the source signal exists

Bloom needs HDR emission. AO needs justified depth and normal consumers. Grading needs an explicit exposure and output policy. Use [Three.js Image Pipeline](/skills/threejs-image-pipeline.html) to keep pass and final-output ownership explicit, then use [Three.js Visual Validation](/skills/threejs-visual-validation.html) to compare no-post, diagnostics, final output, fixed views, seeds, and mutation controls.

The goal is not to reject polish. It is to ensure that polish consumes a proven signal and that disabling it reveals a coherent underlying scene.

## What this page does not claim

The skill pack does not own DCC workflows, mesh repair, UV unwrapping, texture baking, compression, source-asset LOD production, or general asset preparation. It also lacks a general expert owner for studio lighting, IBL, PMREM, reflection probes, and authored prop libraries.

Local images are mechanism captures, not customer work, and their provenance must still match the source under review. Object-sculptor captures do not claim pixel-identical reconstruction. Motion correctness does not establish named-device performance when GPU timestamp evidence is absent. A project still needs its own references, acceptance views, target devices, and asset-production decisions.
