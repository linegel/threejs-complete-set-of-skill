---
kind: hub
slug: /industries/
title: Three.js WebGPU Workflows by Industry
description: Explore concrete Three.js WebGPU workflows for browser games and product configurators, including what the skill pack does and does not own.
h1: Three.js WebGPU workflows by industry
primary_query: three.js webgpu industry use cases
query_aliases: ["three.js webgpu applications by industry","industries for three.js agent skills"]
summary: These pages map recurring industry workloads to concrete rendering owners, evidence, and boundaries. Choose the workload whose truth contract matches the product, not the page with the closest visual style.
related_skills: ["threejs-choose-skills","threejs-image-pipeline","threejs-exposure-color-grading","threejs-visual-validation"]
related_demos: []
related_pages: ["/industries/browser-games/","/industries/product-visualization-and-configurators/","/for/","/docs/choose-skills/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/references/router-recipes.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json"]
---

## Industry pages begin with different product truths

A browser game and a product configurator can use the same renderer while requiring very different decisions. The game may protect response, stable player state, deterministic events, and quality under a moving camera. The configurator must protect authoritative part identity, material response, inspection behavior, and color across every variant.

That difference changes the representation, owners, failure conditions, and validation matrix. The industry pages therefore describe actual jobs to be done rather than swapping a persona name into the same template.

## Browser games

Use the [browser-games workflow](/industries/browser-games/) when Three.js owns the visual layer of an interactive game. The route covers player and inspection cameras, authored motion, procedural subjects, event effects, moving-camera shadows, shared image signals, quality tiers, and reproducible validation.

The graphics pack does not become a game engine. Gameplay rules, ECS decisions, networking, physics-engine selection, collision authority, audio, DOM UI, save state, and asset delivery remain outside the route. The page makes that boundary explicit so an agent does not bury application responsibilities inside render callbacks.

[Creature Habitat](/demos/creature-habitat/) has source-matched accepted evidence for a composed world with subject, vegetation, water, weather, camera, shadows, and final-image ownership. It is not a shipped game, a customer case, or proof of performance on an unnamed device.

## Product visualization and configurators

Use the [product-visualization and configurator workflow](/industries/product-visualization-and-configurators/) when the imported product hierarchy, part IDs, variants, materials, and presentation color are authoritative.

The route preserves the imported silhouette and changes material or visibility state without procedurally replacing the product. It covers material-channel proof, inspection cameras, minimal pass ownership, fixed variant sweeps, and color-managed output. It also identifies gaps such as source-asset preparation, compression, studio lighting, reflections, picking UI, product data, and commerce logic.

The [exposure and color pipeline demo](/demos/webgpu-exposure-color-pipeline/) has source-matched accepted evidence for its metering, adaptation, tone-map, LUT, and output mechanisms. Named-adapter GPU timing and lifecycle remain insufficient. It is not a complete configurator, a material-accuracy study, or evidence of commercial results.

## Choose the workload before the skills

Start with [Choose Skills](/docs/choose-skills/) and declare the product's source of truth, primary observable, interaction, temporal behavior, scale, topology, view pattern, deployment matrix, and permissible error. Only then load the domain owners.

Some scenes do not fit either initial industry route. A scientific display, AEC viewer, digital twin, or cinematic world has a different truth contract. Use the [audience hub](/for/) for role-specific entry points, or the [guides hub](/guides/) to find migration, comparison, documentation, and FAQ surfaces. Do not force a workload into the closest visual category.

## Evidence must match the product claim

Source-matched mechanism evidence can establish that a material diagnostic, camera route, shadow integration, readback path, or output graph works under its declared lab contract. Product acceptance requires more. The target project must supply representative content, input traces, fixed views, target browsers and devices, interaction states, and failure controls.

A game needs deterministic event and camera replays plus sustained target-device behavior. A configurator needs a part and variant correspondence sweep plus material and color gates. Neither can borrow a screenshot from the other as acceptance evidence.

## What this hub does not claim

Release 1 contains two industry workflows, not universal coverage. These pages are based on checked-in contracts and local mechanism captures; any bundle with a mismatched source hash is not current evidence. They are not customer case studies, testimonials, adoption statistics, revenue claims, or proof that the pack fits every production pipeline.

Where the pack lacks an expert owner, the page says so and routes the concern to official Three.js guidance or the project layer. That boundary is a useful result because it prevents attractive rendering examples from implying ownership of data, assets, application logic, or business outcomes.
