---
kind: faq-answer
slug: /faq/which-threejs-version-does-the-skill-pack-support/
title: Which Three.js Version Does the Skill Pack Support?
description: The pack is verified against Three.js 0.185.1, runtime revision 185. Learn what that guarantee covers and how to detect version drift.
h1: Which Three.js version does the skill pack support?
primary_query: which threejs version does the skill pack support
query_aliases: ["threejs skill pack supported version","threejs webgpu skill pack r185"]
summary: The current pack is verified against Three.js 0.185.1, whose runtime revision is 185. Treat that as the supported target, not as a promise that every later release is compatible. Check both the installed package version and THREE.REVISION before using revision-specific API guidance. If either differs, pin or upgrade the project deliberately, then rerun the relevant examples and evidence checks.
related_skills: ["threejs-choose-skills","threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/docs/install/","/faq/how-do-i-verify-the-native-webgpu-backend/","/faq/does-the-skill-pack-work-with-react-three-fiber/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/package.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/scripts/toolchain-preflight.mjs","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md","https://github.com/mrdoob/three.js/wiki/Migration-Guide","https://github.com/mrdoob/three.js/issues/28898"]
question_source_type: verified-local-failure
question_sources: ["local:scripts/toolchain-preflight.mjs#THREE_REVISION_MISMATCH"]
first_observed: 2026-07-12
last_observed: 2026-07-16
canonical_route: /faq/which-threejs-version-does-the-skill-pack-support/
evidence_status: verified
faq_group: compatibility-and-browser-support
supported_revision: 0.185.1
---

## What supported means

The repository manifest pins `three` to `0.185.1`. The rendering skills target r185, and the toolchain preflight requires the imported module to report `THREE.REVISION === "185"`. Supported means that API names, examples, validators, and published evidence contracts were authored and checked against that package and runtime revision.

Check both values. A package manager can resolve a different dependency than expected, and mixed import paths can load more than one Three.js instance.

```js
import * as THREE from 'three/webgpu';

if (THREE.REVISION !== '185') {
  throw new Error(`Expected Three.js r185; received r${THREE.REVISION}`);
}
```

The repository preflight treats a mismatch as a blocking fact rather than silently applying r185 API literals to another release.

## Evidence

- [`package.json`](https://github.com/linegel/threejs-complete-set-of-skill/blob/main/package.json) declares the exact Three.js dependency.
- [`scripts/toolchain-preflight.mjs`](https://github.com/linegel/threejs-complete-set-of-skill/blob/main/scripts/toolchain-preflight.mjs) rejects package and runtime revision drift.
- The [native WebGPU validation harness](/evidence/webgpu-validation-harness/) records its Three.js revision with its backend and artifact evidence.
- The upstream [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) shows why revision changes require explicit review rather than an assumption of API stability.

## Conditions and limitations

- This is not a compatibility claim for every earlier or later Three.js release.
- A matching revision does not prove browser support, native WebGPU selection, feature availability, correct pixels, or performance.
- A newer release may work, but it remains an unverified target until the affected examples and evidence contracts are checked again.
- Existing projects should pin or upgrade deliberately. They should not change versions solely to make the version check disappear.

Continue with [installation](/docs/install/), verify the [native WebGPU backend](/faq/how-do-i-verify-the-native-webgpu-backend/), or follow the [WebGPURenderer migration guide](/migrate/webglrenderer-to-webgpurenderer/).

## Question provenance

This question comes from a verified local revision-mismatch failure enforced by the repository preflight. It is not presented as a customer question. First observed 2026-07-12; last observed and answer reviewed 2026-07-16.
