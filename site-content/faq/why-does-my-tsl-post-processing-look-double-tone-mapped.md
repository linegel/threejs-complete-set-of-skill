---
kind: faq-answer
slug: /faq/why-does-my-tsl-post-processing-look-double-tone-mapped/
title: Why Does My TSL Post-Processing Look Double Tone-Mapped?
description: TSL output looks dark or compressed when two stages own tone mapping or color conversion. Assign one final-output owner and rebuild the graph.
h1: Why does my TSL post-processing look double tone-mapped?
primary_query: why does my tsl post processing look double tone mapped
query_aliases: ["threejs tsl double tone mapping","renderpipeline double output transform"]
summary: Your final color is probably being transformed twice. In a TSL RenderPipeline, assign exactly one tone-map owner and one output-color conversion owner. If outputNode already calls renderOutput(...), set renderPipeline.outputColorTransform = false, then set renderPipeline.needsUpdate = true. If the pipeline owns automatic output conversion, do not add explicit renderOutput(). Also verify the LUT domain: a tone-mapped-linear LUT belongs after toneMapping() and before output conversion.
related_skills: ["threejs-image-pipeline","threejs-exposure-color-grading"]
related_demos: ["webgpu-exposure-color-pipeline"]
related_pages: ["/compare/renderpipeline-vs-effectcomposer/","/faq/why-does-my-webgpu-png-have-striped-rows/","/faq/how-do-i-verify-the-native-webgpu-backend/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://threejs.org/docs/TSL.html","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-image-pipeline/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-exposure-color-grading/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/threejs-image-pipeline/examples/webgpu-image-pipeline/validateImagePipelineConfig.js","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline/validate-exposure.js"]
question_source_type: verified-local-failure
question_sources: ["local:threejs-image-pipeline/examples/webgpu-image-pipeline/validateImagePipelineConfig.js#double-output-transform"]
first_observed: 2026-07-11
last_observed: 2026-07-16
canonical_route: /faq/why-does-my-tsl-post-processing-look-double-tone-mapped/
evidence_status: verified
faq_group: troubleshooting
supported_revision: 0.185.1
---

## One final-image owner

Tone mapping compresses scene-linear HDR values into a displayable range. Output conversion maps the working color representation to the output color space. Applying either transformation twice can darken midtones, flatten highlights, shift saturation, or make a LUT look much stronger than authored.

A TSL pipeline needs one explicit ownership pattern:

1. Let the `RenderPipeline` apply its automatic output transform and do not place another explicit `renderOutput()` in the graph.
2. Let the graph own presentation with `renderOutput()` and set `renderPipeline.outputColorTransform = false`.

When exposure, tone mapping, and a tone-mapped-linear LUT are explicit, the expected order is:

```text
scene-linear HDR
-> exposure
-> toneMapping()
-> tone-mapped-linear LUT
-> renderOutput(..., NoToneMapping, renderer.outputColorSpace)
```

After changing `outputNode` or output ownership, invalidate the graph:

```js
renderPipeline.outputColorTransform = false;
renderPipeline.outputNode = finalNode;
renderPipeline.needsUpdate = true;
```

Keep `renderer.toneMappingExposure` neutral when dynamic exposure is already applied explicitly. Otherwise exposure also gains two owners even if the tone-map operator itself appears only once.

## Source checks and evidence status

The image-pipeline source validator includes a negative control named `double-output-transform`. It deliberately combines explicit `renderOutput()` ownership with automatic output conversion, and the validator must reject it. The exposure validator independently rejects `outputTransformOwner === "renderOutput"` when `outputColorTransform` is not false.

The published [image-pipeline evidence report](/evidence/webgpu-image-pipeline/) and [exposure and grading report](/evidence/webgpu-exposure-color-pipeline/) are accepted and match their current source hashes. They demonstrate the output-ownership and diagnostic contracts in those captured graphs. They do not prove that an unrelated application has the same cause; inspect that application's graph, exposure state, LUT domain, and final output before assigning the failure.

## Diagnose before changing the graph

Compare the no-post, pre-tone-map, post-tone-map, LUT, and final outputs. A similar appearance can come from:

- color textures with wrong color-space metadata;
- a display-encoded LUT sampled as tone-mapped-linear data;
- a scene-linear LUT used without its required shaper;
- non-neutral renderer exposure in addition to explicit EV adaptation;
- a stale graph after changing `outputNode` without setting `needsUpdate`;
- an output image or canvas that is interpreted under the wrong transfer function.

This answer is verified against Three.js 0.185.1. Recheck the ownership APIs when upgrading. Compare [RenderPipeline and EffectComposer](/compare/renderpipeline-vs-effectcomposer/), verify the [native backend](/faq/how-do-i-verify-the-native-webgpu-backend/), or use the [striped-row answer](/faq/why-does-my-webgpu-png-have-striped-rows/) when the artifact is spatial corruption rather than color compression.

## Question provenance

This question comes from a verified local failure control that reproduces duplicate output conversion and requires validation to reject it. It is not presented as a customer question. First observed 2026-07-11; last observed and answer reviewed 2026-07-16.
