---
name: threejs-bloom
description: Implement production bloom in advanced Three.js WebGPU/TSL scenes. Use for RenderPipeline HDR signal ordering, MRT emissive-output selective bloom, BloomNode controls, scene-relative emissive hierarchy, resolution-scale budgets, and effect-isolation diagnostics.
---

# Bloom

Bloom is a camera/display response to bright HDR signal. Teach it as one
node-pipeline effect fed by authored scene luminance, not as the only visible
form of an object or effects.

## Architecture First

The production path is latest Three.js `WebGPURenderer` from `three/webgpu`,
TSL from `three/tsl`, `RenderPipeline`, `pass()`, `mrt({ output, emissive })`,
and `BloomNode` from `bloom()`.

Build selective bloom from the scene pass MRT emissive output:

```text
scene pass with MRT output + emissive
  -> scene color texture node
  -> emissive contribution texture node
  -> bloom(emissive).setResolutionScale(...)
  -> scene color + bloom
  -> single renderOutput / outputColorTransform owner
```

This is the top-tier architecture for this skill: one scene render, direct
MRT-selective contribution, HDR signal preserved until the final output
transform, and per-pass resolution scaling for the expensive blur work.

Read [references/hdr-bloom-system.md](references/hdr-bloom-system.md) for the
r185-era WebGPU/TSL skeleton, capability gate, quality tiers, budgets, color
rules, diagnostics, and replacement notes.

Canonical WebGPU/TSL example: [examples/node-selective-bloom/](examples/node-selective-bloom/).

## Workflow

1. Run `$threejs-choose-skills` preflight when bloom is part of a larger image
   pipeline.
2. Author emissive contribution with `NodeMaterial` materials and route it to
   MRT `emissive`.
3. Feed `BloomNode` from the emissive texture node, not from a separate scene
   render.
4. Tune `strength`, `radius`, `threshold`, `smoothWidth`, and
   `setResolutionScale()` in pre-tone-map HDR.
5. Keep exactly one tone-map and output conversion owner.
6. Validate base, emissive contribution, bloom-only, and final output views at
   desktop-discrete, desktop-integrated, and mobile budgets.

## Capability Gate

Any implementation using MRT or storage resources must gate after renderer
initialization:

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  // Full tier: MRT emissive-output selective bloom through RenderPipeline.
} else {
  // Reduced tier: smaller authored contribution maps, static glow assets,
  // lower bloom resolution, or bloom disabled. Do not build a parallel renderer.
}
```

## Failure Conditions

- bloom creates the only visible form of an effect;
- ordinary albedo or lit surfaces leak into the emissive contribution target;
- all bright materials share one arbitrary emission multiplier;
- threshold is tuned after tone mapping or display conversion;
- multiple systems own tone mapping or output color conversion;
- the bloom pass runs full resolution by default on bandwidth-limited devices;
- resize paths omit `setSize()` or resolution-scale validation;
- highlights become gray because HDR energy is clamped before bloom.

## Routing Boundary

Use `$threejs-exposure-color-grading` for metering, adaptation, tone mapping,
and LUTs. Use `$threejs-image-pipeline` when bloom must share depth, normals,
AO, TAA, or other image-space resources. Use `$threejs-visual-validation` for
fixed-view pass diagnostics and GPU timing evidence.
