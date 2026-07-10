---
name: threejs-particles-trails-and-effects
description: Author workload-selected WebGPU/TSL particles, trails, and real-time effects in Three.js. Use for flow-conforming shells and wakes, reentry plasma, instanced sparks, timed dissolves, GPU particle pools, deterministic compaction, and conditional scene-relative HDR emission signals.
---

# Particles, Trails, and Effects

Use `$threejs-choose-skills` preflight when an effect also needs custom
atmosphere, shadows, camera staging, temporal surfaces, precipitation, or
post-stack architecture. This skill owns object-space plasma, generated wakes,
analytic sparks, pooled debris, lifetime compaction, and scene-relative HDR
emission for effects.

When particles collide with world geometry or exchange physical sources, read
the shared
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Consume a registered `ColliderProxy` with its canonical frame/origin,
topology/pose versions, swept bounds, physics material, residency, and error;
query `SupportSurfaceSample` separately with its descriptor,
`sampleInstant: PhysicsInstant`, footprint, validity, and per-channel error.
Weather-coupled dynamics consume the route's immutable
`EnvironmentForcingSnapshot`; aerodynamic force uses same-frame relative air
velocity plus density, while direction-only visuals make no force claim.
Emit typed `InteractionRecord`
values only to the owning domain. A depth hit, visual spark, or wake ribbon is
not an impulse, mass source, or equal-and-opposite reaction unless that record
and schedule exist.

## Choose Simulation And Compaction Classes First

| State or coupling | Fastest correct representation | Reject |
| --- | --- | --- |
| Motion is a pure function of spawn data and time | Immutable spawn buffer; evaluate position, age, and size analytically in vertex TSL | A compute write of every particle every frame |
| State evolves independently per particle | One compute integration dispatch over a structure-of-arrays hot set | `Object3D` updates or matrix uploads |
| Particles collide with a field or surface | Compute state plus the field/depth representation that owns the collision | CPU readback of positions |
| Neighbor interactions matter | Spatial hash/grid or sort-and-scan before local interaction | An all-pairs `O(N^2)` shader loop |

Choose compaction independently. Stable slots plus an alive bit win when dead
vertex/overdraw cost is below a scan/scatter. When a dense output materially
saves work, use mark -> exclusive scan -> scatter into a second buffer and
write the resulting live/indirect count. Dense-swap is valid only for a
serialized removal queue or a proven atomic protocol with unique source and
destination ownership; naively decrementing a shared tail from many
invocations is a race.

## Architecture First

Start with the architecture selected above, then scale quality inside it:

```text
event envelope + seed
  -> analytic evaluation or compute spawn/update into storage
  -> stable alive slots or mark/scan/scatter compaction when it earns its cost
  -> visible range rendered by SpriteNodeMaterial or instanced NodeMaterial
  -> hull-conforming shell/wake displacement in TSL
  -> scene-linear HDR output; optional selective emissive signal only when required
  -> RenderPipeline bloom/other consumers and final output transform
```

Do not teach CPU-per-object effects at scale. The recurrent high-count path uses
fixed-capacity spatial pages with seeded spawn packets and one draw per visible
compatible representation page.
Static parameters are generated once; analytic motion stays read-only, while
compute updates only state that genuinely recurs. Compaction is optional and
must remove more draw work than its scan/scatter costs.

Use [references/particles-trails-and-effects-system.md](references/particles-trails-and-effects-system.md)
for the full implementation contract: reentry shell/wake representation,
compute pool layout, stable-slot/scan-compaction invariants, depth policy, budgets, diagnostics,
and the replaced techniques from the historical implementation.

Canonical WebGPU lab: `examples/webgpu-pooled-effects/`. It contains prebound
SoA A/B state, ordered mark/two-level exclusive-scan/scatter kernels,
deterministic event expansion, indirect spark/debris render objects, and the
hull-shell/wake stage. Its CPU oracles prove invariants only; canonical
acceptance still requires the native-browser readback/timing evidence named by
`lab.manifest.json`.

Legacy WebGL implementation (deprecated, do not extend): `examples/reentry-plasma/reentry-plasma.js`

Historical rename only: `PostProcessing` was renamed to `RenderPipeline`; new
systems use `RenderPipeline`.

## Mandatory Baseline

- Renderer: `WebGPURenderer` from `three/webgpu`; call `await renderer.init()`.
- Materials: TSL from `three/tsl` with `SpriteNodeMaterial`,
  `MeshBasicNodeMaterial`, `MeshStandardNodeMaterial`, or
  `MeshPhysicalNodeMaterial`.
- Compute: TSL `Fn().compute(count)`, queued `renderer.compute()`, `storage()`
  nodes, `StorageInstancedBufferAttribute`
  for instance-visible state, and `StorageTexture` only when the effect is a
  texture field.
- Rendering: `InstancedMesh` or sprite batches backed by storage attributes.
  Stable slots draw a capacity/last-occupied range and reject inactive records;
  dense GPU compaction publishes an indirect instance count through
  `IndirectStorageBufferAttribute` + `geometry.setIndirect()`. Do not read back
  a GPU count to set `mesh.count` in the frame loop.
- Post: `RenderPipeline`, `pass()`, conditional `mrt()`,
  `outputColorTransform` or `renderOutput()`. Full-scene HDR bloom needs no
  emissive MRT; selective bloom allocates it only with a proven consumer,
  transparent blend contract, and tile-traffic A/B.
- Built-ins first: use `BloomNode` for bloom, `TRAANode` when the post stack
  needs temporal reprojection, `GTAONode` for shared scene grounding, and
  `$threejs-scalable-real-time-shadows` for `CSMShadowNode` / `TileShadowNode` decisions.

## Capability Gate

Every compute/storage/MRT particle-and-effect system includes this gate:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical particle/effect path; route explicit fallback teaching to threejs-compatibility-fallbacks.'
  );
}
```

Quality tiers preserve the effect mechanism and change representation:

| Tier | State | Shell/wake | Field/post policy |
| --- | --- | --- | --- |
| `full` | analytic or recurrent as required | all mechanism layers that pass isolation tests | keep only sampled field bands; post follows authored HDR signal |
| `balanced` | same dynamics with bounded active windows/cadence | merge layers below the image-error gate | lower field/history extent after temporal tests |
| `budgeted` | prefer analytic state and stable slots | one primary representation plus necessary transients | omit optional recurrent fields/post |
| `minimum` | immutable/analytic where possible | primary silhouette/emission cue | no optional per-frame field update |

Pool cap, layers, bands, and post scale are workload outputs. They remain
Authored trials until target-context measurement and the visual contract admit
them; no count maps universally to a device class.

## Build Order

1. Checkpoint: event envelope and seed.
   Expected: spawn window, normalized lifetime, transform, flow direction,
   luminance scale, and effect class are logged in the validation report.
   If you see nondeterministic captures, remove `Math.random` from spawn paths.
2. Checkpoint: storage-backed pools per visual class.
   Expected: sparks, debris, wake cards, and shock flecks allocate
   structure-of-arrays storage once.
   If you see per-frame object churn, the system has fallen back to emitters.
3. Checkpoint: static attributes.
   Expected: random phase, local anchor, base radius, color family, mesh
   variant, and material flags are generated once.
   If you see upload spikes, cold fields are being rewritten in the frame loop.
4. Checkpoint: update and visibility policy.
   Expected: analytic particles change without hot writes; simulated particles
   update once; stable-slot or mark/scan/scatter invariants are explicit.
   If parallel dense-swap can claim one tail record twice, the compaction
   policy is invalid even when a short capture looks correct.
5. Checkpoint: dense live rendering.
   Expected: `SpriteNodeMaterial` handles camera-facing sparks and instanced
   NodeMaterial meshes handle debris and hull-conforming shells.
   If you see WebGPU point-size artifacts, replace point primitives with sprites
   or instanced quads.
6. Checkpoint: hull shell and wake fields.
   Expected: flow-facing masks, support-point wake origin, capsule wake/lobe
   meshes, and analytic filament fields share one event frame.
   If you see a detached aura, rebuild the shell from local hull samples.
7. Checkpoint: HDR signal and bloom-off proof.
   Expected: full-scene bloom reads the HDR scene color with no contribution
   attachment. If selective bloom was explicitly selected, HDR contribution
   writes to the proven MRT `emissive` contract and bloom reads that texture.
   In either route the beauty path stays legible when bloom is disabled.
   If you see bloom-only shape, fix material emission before post tuning.
8. Checkpoint: diagnostics and budgets.
   Expected: pool occupancy, spawn count, compact count, overdraw heat, layer
   masks, raw HDR, bloom contribution, depth policy, and per-tier GPU time are
   visible.
   If you see a missed budget, lower live cap, layer count, field octaves, or
   bloom scale before changing the architecture.

## Performance Contract

| Work | Cost model and required counter |
| --- | --- |
| analytic instances | immutable seed/parameter bytes; zero simulation dispatch and hot writes |
| independent recurrent state | `N_live * dynamicStrideBytes` hot state and `ceil(N_active/workgroupSize)` invocations per solver stage |
| deterministic compaction | mark + exclusive scan + scatter traffic, or stable inactive slots; record holes, moved records, and scan bytes |
| rendering | one draw per geometry/material/depth/blend class after actual batching; record submitted and visible instances |
| transparent effects | covered pixels times mean/p95 layers per pixel; triangle or instance count alone is insufficient |
| post | exact bloom/history extent, mip chain, format, reads/writes, and peak live slots |

Use chunked bounds and per-patch visibility for large fields. Avoid a single
unculled monolith unless the effect is camera-attached and its bounds are
explicitly validated.

Record the workload tuple `{N_active, strideBytes, solverStages,
compactionMode, coveredPixels, layersPerPixel, drawClasses, postExtent}` and
measure contemporaneous whole-frame p50/p95 plus paired marginal A/B cost on
the named target. Include scan/scatter, transparent fragments, attachment
traffic, peak live memory, and sustained thermal behavior. Choose the largest
workload whose visual-error gates and complete scene allocation both pass.

## Color And Output

- LDR color textures encoded as sRGB use `SRGBColorSpace`; HDR/EXR radiance
  remains loader-declared linear. Data textures, masks, noise, LUTs, and
  storage-generated fields use `NoColorSpace`/linear.
- Keep HDR in `HalfFloatType` working buffers until the final transform.
- There is one tone-map owner and one output conversion owner: the node
  pipeline via `outputColorTransform`, or explicit `renderOutput()` when a
  late post node needs transformed input.
- Material emission is scene-relative. Preserve hierarchy, then calibrate:
  short transient flash > powered emitter core > persistent emitter > ordinary surface.
- Bloom is a response to authored HDR emission, not the primary shape. Always
  verify a bloom-disabled baseline.

## Rules

- Every layer must earn its cost through silhouette, motion, illumination, or
  residue.
- Use normalized lifetime curves and seeded randomness.
- Derive secondary motion from the same event direction, flow field, or impact
  frame.
- Keep spawn, analytic evaluation or simulation, compaction, draw, overdraw,
  and post costs measurable per tier.
- Expose raw debug views for masks, age, velocity, live indices, overdraw,
  luminance, optional selective MRT contribution, and bloom.
- Treat old constants as scene-relative evidence, not portable defaults.

## Routing Boundary

Use `$threejs-dynamic-surface-effects` only for screen-space frost, thaw, and
touch-history masks. Use `$threejs-rain-snow-and-wet-surfaces` for falling rain or
snow, splash flipbooks, and weather events that alter ground materials. Use
`$threejs-procedural-motion-systems` for authored motion timelines, staging debris,
and event kinematics. Use `$threejs-camera-controls-and-rigs` for camera-relative
readability and velocity framing. Use `$threejs-bloom` and
`$threejs-image-pipeline` when the shared post stack or exposure path is the
primary task.
