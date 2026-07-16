---
kind: hub
slug: /faq/
title: Three.js WebGPU Skill Pack FAQ
description: Sourced answers about Three.js r185 support, skill routing, native WebGPU proof, ISC licensing, readback stripes, and double tone mapping.
h1: Three.js WebGPU Skill Pack FAQs
primary_query: threejs webgpu skill pack faq
query_aliases: ["three.js webgpu skill pack questions","threejs agent skills questions"]
summary: These sourced answers cover version support, skill routing, native WebGPU proof, licensing, readback alignment, and final-image ownership. Each answer states where the question came from, what evidence supports the response, and what the response does not prove.
related_skills: ["threejs-choose-skills","threejs-visual-validation"]
related_demos: []
related_pages: ["/guides/","/docs/","/migrate/","/pricing/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json"]
---

## Sourced community and engineering questions, plus verified failures

These answers combine sourced community and engineering questions with verified local failures. Each answer names its provenance, supporting evidence, and limits. Community questions are not customer evidence, and verified local failures are not attributed to a user.

### [Which Three.js version does the skill pack support?](/faq/which-threejs-version-does-the-skill-pack-support/)

The current pack is verified against Three.js 0.185.1, whose runtime revision is 185. Treat that as the supported target, not as a promise that every later release is compatible. Check both the installed package version and THREE.REVISION before using revision-specific API guidance. If either differs, pin or upgrade the project deliberately, then rerun the relevant examples and evidence checks.

### [Which Three.js skill should I use first?](/faq/which-threejs-skill-should-i-use-first/)

Use threejs-choose-skills first only when a request spans multiple rendering systems or ownership is unclear. It selects the smallest causal set and returns the current route fields: primaryOwner, selected, deferred, gaps, handoffs, resources, passes, output, and verification. For a focused task such as bloom, camera control, or ocean simulation, load that domain skill directly. Install the pack before using the router because its selected domain skills must be available.

### [How do I verify the native WebGPU backend?](/faq/how-do-i-verify-the-native-webgpu-backend/)

Initialize the renderer, then check renderer.backend.isWebGPUBackend === true. renderer.isWebGPURenderer only identifies the universal renderer class; it does not prove which backend was selected, because WebGPURenderer can fall back to WebGL 2. Record THREE.REVISION, the backend flag, compatibilityMode, output buffer type, and device limits. If the backend flag is false, classify the run as fallback or blocked and do not publish native WebGPU claims.

### [Is the Three.js skill pack free for commercial use?](/faq/is-the-threejs-skill-pack-free-for-commercial-use/)

Yes. Repository-authored work is licensed under the root ISC license, which permits use, copying, modification, and distribution for any purpose, with or without fee, when copies retain its copyright and permission notice. The repository also incorporates Object Sculptor material with its own MIT notice, which must remain with affected copies. Assets, third-party dependencies, agent runtime, hosting, and support may have separate terms or costs. This is a reading of the published files, not legal advice.

### [Why does my WebGPU PNG have striped rows?](/faq/why-does-my-webgpu-png-have-striped-rows/)

Usually, padded GPU rows are being encoded as tightly packed pixels. WebGPU texture-to-buffer copies use a bytesPerRow aligned to 256 bytes, while a PNG encoder expects width times bytesPerPixel bytes per row. Carry the actual integer stride through capture, then copy only the logical pixels from each row into a compact buffer before encoding. Do not infer stride from total buffer length divided by height.

### [Why does my TSL post-processing look double tone-mapped?](/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/)

Your final color is probably being transformed twice. In a TSL RenderPipeline, assign exactly one tone-map owner and one output-color conversion owner. If outputNode already calls renderOutput(...), set renderPipeline.outputColorTransform = false, then set renderPipeline.needsUpdate = true. If the pipeline owns automatic output conversion, do not add explicit renderOutput(). Also verify the LUT domain: a tone-mapped-linear LUT belongs after toneMapping() and before output conversion.

## How provenance works here

Each long-form answer owns one exact question and carries its own source type, source references, first-observed date, last-observed date, canonical route, and evidence status. This hub deliberately does not pretend that six differently sourced questions share one provenance type. Its visible answers are the same summary text used by the standalone pages and their machine-readable Question entities.

The [Guides hub](/guides/) organizes broader decisions. The [documentation hub](/docs/) owns operating instructions, the [migration hub](/migrate/) owns transition procedures, and [pricing](/pricing/) separates the free license from real project costs.
