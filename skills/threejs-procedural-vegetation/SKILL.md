---
name: threejs-procedural-vegetation
description: Compile procedural vegetation for Three.js WebGPU/TSL. Use for dense grass and ground-cover populations, structured tree growth and rooted wind, or terrain-aware ecological placement.
---

# Procedural Vegetation

Build vegetation as a compiler: stable environmental causes become immutable
placement/topology records, while wind and interaction remain separately owned
dynamic state. The canonical path uses Three.js r185 `WebGPURenderer`, TSL,
`NodeMaterial`, and workload-selected compute/storage.

## 1. Define the observable and owners

Classify every requested result before selecting APIs:

| Branch | Requested observable | Vegetation owns |
| --- | --- | --- |
| dense population | grass, flowers, ground cover, repeated shrubs/trees | placement identity, pages, representations, deformation bindings |
| tree growth | trunks, roots, branches, foliage, rooted wind | growth hierarchy, geometry, structural response, LOD |
| terrain ecology | populations caused by terrain or site fields | species response, candidate conflicts, stable acceptance |

Name the coordinate frame, world unit, characteristic plant scale, target
cameras/extents, update frequency, output owner, and external field owners.
Terrain, weather, water, contact, and lighting remain with their routed owners;
vegetation consumes versioned samples from them.

This step is complete when every requested observable has one owner and every
external input names its producer, units, frame/chart, support/filter, revision,
validity, error, and update cadence.

## 2. Select representations by population and projected error

| Workload | Default representation |
| --- | --- |
| one or a few close trees | CPU/worker growth compile into indexed buffers |
| repeated trees or shrubs | compatible species variants instanced in spatial pages, then geometry LOD and impostors |
| dense grass or ground cover | shared strip/clump geometry with implicit, compact CPU, or storage-backed placement |
| changing placement or topology | compute only the changing records, followed by bounded compaction |

Choose compute from measured changed-data volume, dispatch cost, traffic, and
residency. Static CPU-generated vegetation can be the lowest-cost GPU result.
For every near/mid/far range, record the representation, transition error,
expanded bound, shadow proxy, static bytes, dynamic bytes, and submitted work.

This step is complete when each visible range has exactly one primary
representation and every transition has an unjittered physical-pixel error
gate, hysteresis/dwell, and simultaneous-memory budget.

## 3. Compile the selected branch

### Dense populations

1. Partition the domain into deterministic chunks with global IDs, fixed seeds,
   half-open ownership, conservative deformed bounds, and a visible bounds/LOD
   diagnostic.
2. Compare implicit reconstruction, clump records, compact CPU attributes, and
   storage records. Count the actual aligned stride, duplicate LOD data, and hot
   vertex reads. In r185, `computeAsync()` waits for initialization before
   enqueue; it is not evidence that GPU work has completed.
3. Keep placement and species identity immutable after spawn. Derive safe
   variation from stable integer hashes; update only wind, touch, wetness, snow,
   or other selected dynamic fields.
4. Cull by spatial page before draw submission. Use near geometry, mid nested
   density thinning, and far cluster/impostor representations. A visibility
   mask that still submits every vertex is an appearance mask, not culling.
5. Expand each page bound by terrain displacement, plant height, and maximum
   active deformation. Display, shadow, and picking consume that same bound.

Dense compilation is complete when equal inputs reproduce equal IDs, chunk
order cannot change owned plants, placement bytes and dynamic bytes are
separate, and invisible pages cease contributing submitted geometry.

### Terrain ecology

When terrain, substrate, exposure, water, disturbance, light, or site assets
affect placement, read
[terrain-ecology-and-placement.md](references/terrain-ecology-and-placement.md).
Apply hard eligibility before suitability, then select either Matérn-II/local
maximum or global priority-greedy semantics explicitly. Preserve chunk halos,
stable winner keys, and nested LOD thinning ranks exactly as that reference
defines them.

Ecology compilation is complete when every accepted plant resolves its field
revisions, eligibility, response factors, candidate/winner identity, asset, and
chunk owner; exclusions and seam checks have zero violations.

### Structured trees

When generating trunks, branches, roots, leaves, or hierarchical wind, read
[tree-growth-and-wind.md](references/tree-growth-and-wind.md). Compile an
iterative growth hierarchy with rotation-minimizing frames, explicit twist,
species allometry, validated junctions, arc-length bark UVs, stable leaf bases,
and shared display/shadow deformation.

Tree compilation is complete when the queue terminates inside declared budgets,
all branch IDs are unique, frames and junctions pass their continuity/mesh
gates, and foliage roots, normals, UVs, and bounds are finite and reproducible.

## 4. Bind dynamic state and handoffs

When wind, water, weather, contacts, loading, or another simulation owner feeds
vegetation, define a handoff with units, frame/origin, interval or sample
instant, cadence/sample phase, producer/consumer/version, footprint/filter,
validity/staleness/error, and rate-versus-integrated semantics.

Vegetation owns structural response: root constraints, analytic bend or modal
state, leaf flutter, touch/load state, bounds, and LOD projection. It does not
own the air/water/contact cause. Recurrent state advances at a fixed step or at
the routed simulation stage; render samples immutable previous/current states
for one stable plant/page identity. Presentation transforms those states into
the current view without mutating placement.

One-way visual deformation consumes a source and returns no physical reaction.
A two-way route sends reactions through the authoritative solver named by the
handoff. GPU-resident state remains GPU-resident through frame-critical work;
CPU decisions use an analytic mirror, compact dirty ranges, or conservative
bounds with declared age/error.

This step is complete when each dynamic field has one state owner, a precise
sample/application time, a stable identity/version, a bounded update domain,
and an explicit reset rule for creation, removal, teleport, slot reuse,
topology change, LOD discontinuity, provider discontinuity, and resize.

## 5. Render and present once

Initialize before allocating WebGPU resources:

```js
import { WebGPURenderer } from 'three/webgpu';

const renderer = new WebGPURenderer({ antialias: false });
await renderer.init();
if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('WebGPU backend unavailable for the canonical vegetation path.');
}
```

- Use `MeshStandardNodeMaterial` for grass and bark; use
  `MeshPhysicalNodeMaterial` when leaf transmission/wax response is required.
- Use `alphaTest` or `alphaHash` for foliage. `forceSinglePass` is appropriate
  when a validated double-sided card does not need separate back-face lighting.
- Decode color/albedo as sRGB. Normal, roughness, density, alpha, wind, LUT, and
  other data fields remain linear/`NoColorSpace`.
- Keep leaf/grass roots fixed in the position function. Reuse that function for
  visible and cast-shadow geometry.
- Cull and reduce geometry/alpha coverage before adding AO, bloom, or temporal
  filtering. Request only MRT signals a consumer uses.
- Keep HDR buffers linear until the one tone-map/output-conversion owner
  presents the frame.

This step is complete when visible, shadow, depth, and motion paths resolve the
same plant identity and deformation state, all colors/data use the declared
spaces, and exactly one component owns tone mapping and output conversion.

## 6. Verify causes, cost, and lifecycle

Inspect final/no-post output plus branch-specific diagnostics:

```text
dense: chunk bounds, submitted pages, density rank, LOD/impostor state,
       static versus dynamic storage, projected alpha layers
ecology: input fields, exclusions, response factors, candidate conflicts,
         chunk halo/ownership, accepted and rejected causes
trees: branch levels/frames/junctions, bark UVs, leaf roots/normals,
       wind displacement, swept bounds, shadow parity
```

Record visible/submitted pages and instances, rejected-but-processed vertices,
mean/p95 alpha layers, shadowed work, aligned storage bytes, dynamic-field
traffic/cadence, compile/update time, whole-frame and paired-marginal CPU/GPU
p50/p95, peak live bytes, and sustained target behaviour.

Exercise fixed-seed replay, changed chunk order, camera traversal, LOD
transitions, wind/contact impulses, provider discontinuity, resize, slot reuse,
and disposal. Failure signatures include habitat moving with render LOD,
species changes from seed variation, roots drifting, frame helices, flat card
normals, placement regenerating per frame, offscreen pages dominating
submission, shadow deformation diverging, or resources/state surviving their
owner's disposal.

Verification is complete when every selected branch passes its causal,
determinism, geometry, transition, output, budget, reset, and disposal checks;
unselected branches require no payload or evidence.

## Routing boundary

Use `$threejs-procedural-fields` for shared environmental fields,
`$threejs-procedural-geometry` for generic mesh emission,
`$threejs-procedural-materials` for reusable PBR identities,
`$threejs-scalable-real-time-shadows` for custom shadow systems, and
`$threejs-image-pipeline` for final HDR/post/output ownership. This skill owns
vegetation placement, growth topology, foliage, population representations,
and rooted structural response.
