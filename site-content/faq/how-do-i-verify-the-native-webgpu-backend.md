---
kind: faq-answer
slug: /faq/how-do-i-verify-the-native-webgpu-backend/
title: How Do I Verify the Native WebGPU Backend?
description: Initialize WebGPURenderer and inspect its selected backend. The renderer class and navigator.gpu alone are not native WebGPU proof.
h1: How do I verify the native WebGPU backend?
primary_query: how to verify threejs native webgpu backend
query_aliases: ["renderer backend iswebgpubackend","check webgpurenderer is really using webgpu"]
summary: Initialize the renderer, then check renderer.backend.isWebGPUBackend === true. renderer.isWebGPURenderer only identifies the universal renderer class; it does not prove which backend was selected, because WebGPURenderer can fall back to WebGL 2. Record THREE.REVISION, the backend flag, compatibilityMode, output buffer type, and device limits. If the backend flag is false, classify the run as fallback or blocked and do not publish native WebGPU claims.
related_skills: ["threejs-choose-skills","threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/migrate/webglrenderer-to-webgpurenderer/","/faq/which-threejs-version-does-the-skill-pack-support/","/faq/why-does-my-webgpu-png-have-striped-rows/"]
hero_image: /visual-validation/webgpu-validation-harness/diagnostics.mosaic.png
hero_source: webgpu-validation-harness
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://threejs.org/manual/en/webgpurenderer","https://threejs.org/docs/pages/WebGPURenderer.html","https://github.com/mrdoob/three.js/issues/28898","https://github.com/mrdoob/three.js/issues/31381","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/scripts/capture-via-cdp.mjs"]
question_source_type: derived-upstream-issue
question_sources: ["https://github.com/mrdoob/three.js/issues/31381"]
first_observed: 2025-07-07
last_observed: 2026-07-16
canonical_route: /faq/how-do-i-verify-the-native-webgpu-backend/
evidence_status: verified
faq_group: compatibility-and-browser-support
supported_revision: 0.185.1
---

## Verify the initialized renderer

The official WebGPURenderer manual states that the renderer can select WebGPU or fall back to a WebGL 2 backend. `navigator.gpu` shows that the browser exposes WebGPU, but it does not show which backend a particular renderer instance selected. `renderer.isWebGPURenderer` identifies the renderer class, not the active backend.

For the supported r185 target, initialize before inspecting the backend:

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({ antialias: false });
await renderer.init();

const backendManifest = {
  revision: THREE.REVISION,
  isWebGPUBackend: renderer.backend.isWebGPUBackend === true,
  compatibilityMode: renderer.backend.compatibilityMode,
  outputBufferType: renderer.getOutputBufferType(),
  samples: renderer.samples,
  deviceLimits: renderer.backend.device?.limits ?? null,
  rendererInfo: renderer.info
};

if (!backendManifest.isWebGPUBackend) {
  throw new Error('This route requires the native WebGPU backend.');
}
```

Record the result with the browser, device, installed package version, output format, and required features. A boolean without its environment is weak evidence because it cannot explain later capability or device-specific failures.

## Proof

- The [official WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer) documents automatic WebGL 2 fallback and asynchronous initialization.
- Upstream issue [#31381](https://github.com/mrdoob/three.js/issues/31381) documents the community confusion created by a renderer class that can target different backends.
- The repository's [validation harness evidence](/evidence/webgpu-validation-harness/) records native backend identity with its capture artifacts.
- [`scripts/capture-via-cdp.mjs`](https://github.com/linegel/threejs-complete-set-of-skill/blob/main/scripts/capture-via-cdp.mjs) rejects a capture session that lacks native WebGPU backend proof.

## What the flag does not prove

- It does not prove that every feature required by the scene is available.
- It does not prove correct pixels, lifecycle stability, GPU timing, or performance on another device.
- Compatibility mode must be classified separately when its limits affect the workload.
- Backend access and field names are revision-sensitive. This answer is reviewed for Three.js 0.185.1.

If the flag is false, follow the [WebGPURenderer migration guide](/migrate/webglrenderer-to-webgpurenderer/) and report the fallback or blocker accurately. Then confirm the [supported revision](/faq/which-threejs-version-does-the-skill-pack-support/) and use the [readback troubleshooting answer](/faq/why-does-my-webgpu-png-have-striped-rows/) only after backend identity is known.

## Question provenance

This operational question is derived from upstream issue #31381, which documents confusion about WebGPURenderer's multi-backend behavior but does not ask for this exact verification procedure. Issue #28898 is technical background only. This is upstream engineering evidence, not customer evidence. Source first observed 2025-07-07; last checked and answer reviewed 2026-07-16.
