---
name: threejs-procedural-creatures
description: Build high-quality procedural and generated creatures in Three.js WebGPU/TSL. Use for spec-driven creature bodies, skeleton/control rigs, SDF blend-shell or generated/hybrid skins, procedural gait/hop/flight/swim locomotion, foot planting and 2-bone IK, verlet tails and ears, squash-and-stretch, toon fauna and NPCs, creature crowds, deterministic creature labs, and genetic creature variation. Not for imported glTF skinned-clip pipelines.
---

# Procedural Creatures

Start with `$threejs-choose-skills` preflight when creatures live inside a
larger scene stack. A creature here is an authored JSON spec compiled into a
posed-primitive control rig whose smooth-min SDF field both skins the body and
drives shading. The render body stays ordinary merged geometry — the TSL vertex
stage snaps a canonical shell onto the field iso-surface. No raymarching, no
imported skinned assets, no `AnimationMixer`: pose is a small primitive buffer
written per fixed simulation step. The skeleton is a semantic control rig
(animation, IK, physics proxies, attachments); the visible skin may be an SDF
blend-shell, a generated mesh, or a hybrid.

For plants and foliage use `$threejs-procedural-vegetation`. For generic
transform timelines, springs, and staging use
`$threejs-procedural-motion-systems`. Imported glTF skinned-clip pipelines
(retargeting, blend trees, VAT crowds) are outside this pack — say so rather
than stretching this skill over them.

## Mandatory Architecture

The production path is latest Three.js `WebGPURenderer` from `three/webgpu`,
TSL from `three/tsl`, storage-buffer pose data, and node materials. Build in
this order; every step ends in something renderable or assertable.

1. **Layering.** Pure core (spec, field math, rig compiler, locomotion) with
   zero `three` imports; a Three/TSL adapter package; a thin scene adapter that
   only feeds world `RigPose` values; a standalone deterministic creature lab
   that imports the package and never the app.
2. **Spec.** A creature is a small JSON `CharacterSpec` (~15–250 lines) of
   round primitives: tapered capsules, spheres, cones, verlet `rope` chains,
   IK `leg` parts. One validation gate; every error names `part.field`,
   because specs are meant to be generated, including by AI.
3. **Rig compile.** Parts map to primitive slots (capsule/cone/sphere = 1,
   rope = `segments`, leg = 2). Fold blend radius `k`/`kCap` per part at
   compile time. Canonicalize part order (sort by stable part id) so the
   sequential smooth-min cannot change with authoring order. Build the blend
   adjacency once from rest-pose capsule AABBs expanded by `r + k`, and store
   a bounded per-vertex candidate set (owner + K neighbours, K = 4–8). The
   K-candidate fold approximates the canonical sequential, order-dependent
   global smooth-min fold; rest-AABB adjacency is only a selection heuristic,
   and the full-field locomotion sweep gate is the acceptance bound (that gate
   runs in the Wave B creature lab — pending, `HANDOFF.md` §3 item 3.9e; until
   it lands, K is an authored default with no passed-evidence claim).
4. **Pose runtime.** The runtime pose is a typed-array SoA buffer
   (`a.xyz|ra`, `b.xyz|rb`, `k|rgb` per slot), not object graphs re-copied
   into per-material vectors. Locomotion advances on a fixed-step accumulator
   (1/60 or 1/120, clamped input dt) and renders interpolated pose — feet
   never pop on frame hitches. Root motion lives in the object transform;
   primitives stay creature-local; world-planted feet convert through the
   inverse root transform for body-frame IK, then write creature-local leg
   slots before storage upload and posed-bounds update. Maintain a real
   per-instance bounding sphere from posed primitive AABBs. Never ship
   `frustumCulled = false`.
5. **Field.** Tapered-capsule distance + pairwise polynomial smooth-min
   (Quilez form). Compute the analytic gradient fused into the same loop —
   per-primitive radial direction minus the cone taper term `s·û`, blended
   `grad = mix(gradA, gradB, h)` through each smin (the exact gradient of the
   polynomial smooth-min, not an approximation) — instead of 6-tap finite
   differences (a ~7× field-evaluation saving); keep central differences only
   as a CPU verification tap. PARITY CONTRACT: the CPU sampler and the TSL
   emitter implement the same formulas and change in the same commit.
6. **Shell.** Canonical capsule geometry per slot per tier with `aPart`,
   `aAxial`, and a radial-angle attribute as stable surface coordinates;
   CPU-verified outward winding; bounded Newton snap onto `d = iso` with a
   residual gate (`< 0.02` of body scale) and early-out when
   `abs(d - iso) < epsilon`.
7. **Rendering at scale.** One shared geometry + material per species/tier.
   Pose lives in storage (`instancedArray` / storage buffer) indexed by
   `instanceIndex * maxParts + slot`; evaluate the field over the bounded
   candidate set, with a dynamic loop bounded by the actual part count, never
   a masked full-budget unroll. Cache material variants by
   `{tier, outline, debugMode, K}`; scalar controls (toon bands, outline
   width, sun, warmth) stay uniform writes, never graph rebuilds.
8. **Shading.** Normals from the field gradient; albedo from proximity-blended
   part colors over the same candidate set; banded toon ramp; SDF self-AO
   (few taps along the normal) so blended limbs read grounded, not inflated.
   For toon hatching or paint-stroke stability that wants texture-space
   evaluation, read [the image-pipeline note](../threejs-image-pipeline/references/production-image-pipeline.md#considered-alternative-texture-space--decoupled-shading); it is an exception path, not a default creature lighting cache.
   Prove shadow parity: the shadow/depth path must consume the same snapped
   position function, verified by a silhouette-vs-shadow test, not assumed.
   Decode authored sRGB colors to linear before any uniform/storage upload.
9. **Outline.** For crowds, one post-process ID/normal edge pass over the
   whole population. The per-creature iso-offset back-face hull is a hero-shot
   variant only — it re-runs the entire snap per vertex and doubles draws.
10. **Locomotion.** Reactive planted gait (feet world-planted, step on lag,
    zero stance drift) + analytic 2-bone IK with a Gram-Schmidt bend hint;
    hopper state machine with volume-preserving squash
    (`sxz = 1/sqrt(squash)`); closed-form flight sampled from sim time;
    fixed-step verlet ropes; buoyancy-spring swim against an injected
    `getWaterHeight(x, z, timeSeconds)` provider. Open seas use
    `threejs-spectral-ocean/examples/webgpu-fft-ocean/createCpuWaterHeightSampler()`;
    bounded pools use
    `threejs-water-optics/examples/webgpu-bounded-water/createBoundedWaterHeightQuery()`
    for the analytic component. The water provider carries the parity-error
    obligation (`estimateTruncationError()` for spectral seas; zero analytic
    error plus a declared StorageTexture residual for bounded water). Creature
    locomotion treats the injected query as authoritative and never performs
    GPU readback. Rope-verlet writes its segment slots after base squash staging,
    after root-yaw target conversion, and after IK writes; the last stage
    touching a slot wins. Everything deterministic: seeded LCG + sim clock
    only — `Math.random`/`Date.now`/`performance.now` are banned in render
    code.
11. **Boot.** All heavy work is init-phase and budgeted: shell geometry once
    per tier (species-independent), rig compile + candidate sets once per
    species (time-sliced ≤ 4 ms/frame or in a worker), storage allocated at
    population cap. `await renderer.compileAsync(...)` every shippable
    material variant — display, depth/shadow, outline — behind the load
    screen. Spawning a creature is validation plus an O(slots) buffer write;
    it never builds geometry, materials, or pipelines.
12. **Lab.** A strict-port standalone lab app with a deterministic driver
    (`seek(t)` must equal `step(t * 60, 1000/60)`), machine-readable
    telemetry, debug modes, foot-drift markers, and seed sweeps. Lab evidence
    proves the package, never the shipping scene.

## Capability Gate

```js
const renderer = new WebGPURenderer({ antialias: true });
await renderer.init();
if (!renderer.backend.isWebGPUBackend) {
  throw new Error('WebGPU backend unavailable for the canonical creature path.');
}
```

Quality tiers inside the one canonical architecture:

| Tier | Use for | Shell | Snap steps | Candidate K | Normals | Outline |
| --- | --- | --- | ---: | ---: | --- | --- |
| Hero | close-ups, protagonists | 12 radial, 3 cap rings/slot | 2 + residual early-out | 8 | analytic gradient, optional fragment-stage | iso-offset hull or post edge |
| Crowd | populated scenes | 10 radial, 2 cap rings | 1–2 | 4–6 | analytic gradient, vertex varying | shared post edge pass |
| Background | distant fauna | 8 radial, 2 cap rings | 1 | 2–4 | analytic gradient, vertex varying | none |

If the user explicitly asks how to apply fallback when WebGPU is unavailable,
route that teaching to `../threejs-compatibility-fallbacks/` instead of adding
it here.

## Performance Budgets

Budget the population before styling it. Per-slot shell vertices (§5):
`V_slot = (2 + 2·capRings)·radialSegments + 2` (hero 98, crowd 62, background
50). Per creature: `V_shell = P · V_slot` where `P` = compiled primitive count
from the spec. Vertex-stage fused field queries per shell vertex (analytic
gradient): `E_vertex = (snapSteps + 1) · K`, plus optional color/self-AO passes
over the same candidate set — never `E_vertex = (snapSteps + 1) · 7 · P` from a
masked full-budget unroll with finite-difference normals. Parameter ratio vs
that forbidden path: `(7 · P) / K` at equal snap depth. Prove ms budgets in the
lab; do not copy population or slot-budget constants from any external codebase.

| Target | Population | Draws | Pose upload | Frame budget |
| --- | --- | ---: | --- | ---: |
| Desktop discrete | 50–200 creatures, 3–6 species | 1 per species/tier (+1 shared outline pass) | one contiguous storage write per frame | 0.5–1.5 ms |
| Desktop integrated | 20–80 creatures | 1 per species/tier | one storage write | 1.0–2.5 ms |
| Mobile WebGPU | 5–30 creatures | 1–2 total | one storage write | 1.5–3.0 ms |

CPU side: rig update writes straight into the mapped typed array; zero
per-frame allocation; ordinary locomotion is O(slots) per creature per fixed
step, while rope-verlet CPU cost is
`ropeSubsteps * ropeRelaxationPasses * ropeSegments`, not O(slots).

Boot side: all shippable material variants `compileAsync`-warmed before
reveal; species build work time-sliced (≤ 4 ms/frame) or off-thread; storage
allocated at population cap. Per-creature spawn ≤ 0.25 ms with zero
allocations and zero pipeline compiles; first revealed frame ≤ 1.5× the
steady-state frame time.

## Color And Output

- Authored part colors are sRGB hex; decode to linear
  (`c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`) before upload. Storage
  and uniform pose data is `NoColorSpace` linear data.
- Genome/color mutation operates in perceptual space (OKLab/HSL on the sRGB
  hex), never on decoded linear floats.
- The scene node pipeline owns tone mapping and output conversion; creature
  materials must not double-convert.

## Reference

Read [references/creature-body-systems.md](references/creature-body-systems.md)
for the exact build contract: spec schema, field formulas and constants, rig
compiler rules, locomotion constants and gates, scale architecture, the
quality ladder toward skinned-look results, the creature-lab contract, the
boot/compile/spawn contract, and the numeric gate table.

Canonical runnable example: not yet included. The next required artifact is a
self-verifying `examples/` lab that proves CPU/TSL parity, determinism,
culling, snap residuals, stance drift, boot gates, and tier budgets against
the reference's numeric gate table.

## Failure Conditions

- the field is evaluated with masked full-budget unrolled loops over the slot budget instead of
  bounded candidate sets and a part-count loop;
- normals come from 6-tap finite differences in the shader when the analytic
  gradient is available in the same loop;
- pose is per-creature material uniforms (one material per creature instead of per-species), so same-species creatures cannot
  batch and every creature is its own draw call;
- `frustumCulled = false` instead of per-instance posed bounds;
- locomotion consumes raw render dt, so foot plants and hop phases pop under
  frame hitches;
- smooth-min result depends on authoring order of parts and nobody
  canonicalized or made the blend topology explicit;
- shadows silently use a different position path than the visible snapped
  surface;
- the outline doubles the full snap cost per creature in a crowd scene;
- debug/tier/band changes rebuild materials and meshes per creature instead of
  hitting a variant cache and uniforms;
- geometry cache keys omit schema/compiler versions or rely on a 32-bit hash
  alone;
- sRGB hex is uploaded as-is (washed-out creatures) or decoded twice (dark
  creatures);
- snap residual, stance drift, and CPU/GPU parity are eyeballed instead of
  gated numerically;
- creature motion calls `Math.random` or wall-clock time anywhere in the
  render path.

## Routing Boundary

Use `$threejs-procedural-motion-systems` for generic transform timelines,
springs, staging, and rotating frames; this skill owns creature bodies, rigs,
and creature locomotion. Use `$threejs-procedural-geometry` for general
semantic mesh writers; this skill owns the canonical snapped shell. Use
`$threejs-procedural-vegetation` for plants. Use `$threejs-visual-validation`
for evidence bundles the creature lab emits. Imported skinned-asset character
pipelines (glTF clips, retargeting, VAT crowds) are an explicit gap in this
pack — do not stretch this skill over them.
