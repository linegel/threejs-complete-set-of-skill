# Native WebGPU Pooled Effects Lab

Canonical source for recurrent sparks, dissolving debris, a hull-conforming
reentry shell, generated wake volumes, GPU compaction, and indirect rendering.
The older `EffectPool` remains a serialized CPU oracle. It is not the runtime
path used by `lab.mjs`.

## Executable graph

Each spark/debris class owns two prebound SoA state sets. A frame enqueues:

```text
reset counters
clear the complete destination state and reverse map
integrate exact constant-acceleration linear drag + mark survivors
Blelloch exclusive scan inside each workgroup
exclusive scan of workgroup totals
scatter motion, appearance, and stable-identity lanes A -> B or B -> A
return expired IDs to an atomic GPU free stack
expand one bounded, integer-hashed event packet
atomically pop a unique stable ID for every spawned record
publish indexed indirect instanceCount
```

The render path uses `BufferGeometry.setIndirect()` and
`IndirectStorageBufferAttribute`. It never reads the live count to set a JS
mesh count and never iterates particles on the CPU. `entityId` is a persistent
integer state lane: survivors retain it across dense compaction, expired IDs
are returned to a bounded GPU free stack, and spawn invocations atomically pop
unique IDs. A separate scatter rebuilds `entityToIndex`. Destination clearing
keeps every lane outside `[0, liveCount)` `DEAD`, preventing stale records from
resurrecting on the next A/B swap. Splitting motion, appearance, and identity
scatter also caps every compute entry point at seven storage-buffer bindings,
below WebGPU's guaranteed limit of eight. The A/B render vertex stage consumes
exactly eight storage buffers and is checked against the adapter limit after
renderer initialization.

Each pool installs a conservative analytic event-envelope sphere on its
indirect render geometry and keeps normal frustum culling enabled. The bound
unions every queued event, ignores drag to remain conservative, and is cleared
only with the GPU pool reset. No CPU particle position readback drives culling.

`createReentryEffectVisuals()` derives the wake origin from the maximum
transformed hull dot product along the normalized downstream flow vector. The
hull shell, wake core, haze, and shear lobe are actual depth-tested node
materials. Raw scene-linear emission is published to the shared MRT; the
beauty path remains visible when bloom is bypassed.

## Routes

Mechanisms:

- `mechanism/reentry-shell-and-wake/`
- `mechanism/impact-sparks/`
- `mechanism/debris-dissolve/`
- `mechanism/gpu-pool-and-compaction/`
- `mechanism/indirect-draws/`
- `mechanism/hdr-emissive-and-depth/`
- `mechanism/tier-benchmark/`

Locked tiers:

- `tier/ultra/`
- `tier/high/`
- `tier/medium/`

All wrappers import `lab.mjs`; they do not fork the solver.

## Runtime ownership

The standalone lab owns one `WebGPURenderer`, one `RenderPipeline`, one scene
pass, and one explicit `renderOutput()` conversion. The scene MRT contains
`output`, `normal`, and `emissive`. `outputColorTransform` is false because
`renderOutput()` owns the conversion. Mode changes assign a real output node
and set `renderPipeline.needsUpdate = true`.

The runtime graph also records the directional shadow scene submission,
shadow color/depth targets, BloomNode high-pass, five horizontal and five
vertical blur passes, composite pass, eleven RGBA16F bloom targets, and the
final presentation pass. Bloom targets remain resident when a diagnostic mode
bypasses bloom, but bypassed Bloom passes are not reported as reachable work.

`GPUCompactionEffectPool` and `createReentryEffectVisuals()` are reusable stage
factories: an integration scene supplies the renderer, scene, camera, and final
pipeline owner.

## Validation state

The Node suite proves exact-drag schedule invariance, stable exclusive-scan
order, all-lane scatter, identity-map bijection, transformed-hull support
points, right-handed event frames, indirect command layout, column-major
translation, and mutation rejection. These checks do not prove GPU execution.

`lab.manifest.json` therefore remains `incomplete` until the browser capture
runner records native-WebGPU backend identity, ordered dispatch readback,
stable-ID/free-list bijection, one-step GPU/f64 trajectory parity, indirect
count, render-target images, resource inventory, lifecycle evidence,
and current-adapter timestamps. Missing timing is
`INSUFFICIENT_EVIDENCE`, never zero cost.

Pool readback can pass only the pool, identity, and indirect-count claims.
Indirect draw consumption, hull conformity, dissolve/shadow parity, soft-depth
occlusion, and emissive isolation retain independent verdicts until their own
runtime gates exist. Capture readback byte totals are not a runtime bandwidth
model and remain `INSUFFICIENT_EVIDENCE`. Every capture profile performs 50
host-stage create/step/render/dispose cycles while also varying controller
resize, mode, and tier under one initialized renderer.

## Commands

```sh
npm run check
npm run validate:unit
npm run test:mutations
npm run validate:quick
npm run capture
npm run validate:artifacts
npm run validate:full
```
