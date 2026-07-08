# Creature Body Systems — build contract

Exact contract for spec-driven SDF blend-shell creatures on WebGPU/TSL:
schema, field math, rig compilation, locomotion, scale architecture, quality
ladder, lab contract, boot contract, and numeric gates. Treat every formula below as a
verifiable contract: it earns trust only through CPU/TSL parity tests,
deterministic lab captures, and numeric gates in this document.

Contents:

1. [Spaces and conventions](#1-spaces-and-conventions)
2. [CharacterSpec schema](#2-characterspec-schema)
3. [Field contract (the parity law)](#3-field-contract-the-parity-law)
4. [Rig compiler](#4-rig-compiler)
5. [Canonical shell](#5-canonical-shell)
6. [Locomotion library](#6-locomotion-library)
7. [Scale architecture](#7-scale-architecture)
8. [Quality ladder toward skinned-look](#8-quality-ladder-toward-skinned-look)
9. [Creature lab contract](#9-creature-lab-contract)
10. [Numeric gates](#10-numeric-gates)
11. [Boot, compile, and spawn contract](#11-boot-compile-and-spawn-contract)

## 1. Spaces and conventions

| Quantity | Space | Convention |
| --- | --- | --- |
| `PartSpec.a/b/offset/hip` | parent-local | Y-up, +Z forward, accumulated over parent anchors |
| compiled primitive endpoints | creature-local | identity rest frame, root at ground origin |
| posed primitive endpoints | creature-local | root motion lives in the instance transform; world-space posed primitives forfeit instanced batching and per-instance culling |
| `RigPose.position/yaw/roll` | world | yaw 0 faces +Z; pose order: squash → roll → yaw → translate |
| field distance `d` | creature-local units | `d = 0` is the skin; `iso > 0` inflates (outline shells) |
| part colors | authored sRGB hex → linear floats before upload | data buffers are `NoColorSpace` |

Never let two of these spaces touch without naming the transform. The classic
silent failure is feeding world-space primitives to a local-space shell or
vice versa: the creature renders but breathes/slides against its own outline
and shadows.

## 2. CharacterSpec schema

```ts
interface CharacterSpec {
  name: string;
  seed?: number;          // seeded LCG for per-creature variation
  scale?: number;         // uniform world scale, default 1
  locomotion: {
    type: 'biped' | 'quadruped' | 'hexapod' | 'hopper' | 'flyer' | 'swimmer';
    speed?: number;       // cruise, world units/s
    stepLength?: number;  // legged: stride trigger distance
    stepHeight?: number;  // legged: swing arc apex
    hopLength?: number;   hopHeight?: number;      // hopper
    altitude?: number;    radius?: number;         // flyer patrol
    buoyancy?: number;    undulation?: number;     // swimmer
  };
  parts: PartSpec[];
}

interface PartSpec {
  id: string;             // unique, non-empty
  shape: 'capsule' | 'sphere' | 'cone' | 'rope' | 'leg';
  parent?: string;        // anchor accumulation over parent chain
  a?: [number, number, number]; b?: [number, number, number]; // capsule/cone
  offset?: [number, number, number];  // sphere center / rope root
  r?: number; r2?: number;            // radius, cone end radius
  k?: number;             // smooth-min blend radius (default r * 0.6)
  kCap?: number;          // cap for thin parts so antennae don't dissolve
  color?: string;         // #rrggbb sRGB
  segments?: number; length?: number; taper?: number;  // rope
  hip?: [number, number, number]; upper?: number; lower?: number; phase?: number; // leg
  flap?: number;          // wing-beat amplitude, radians
}
```

Validation is one gate and every error names `part.field`. Enforce: unique
ids, known shapes and locomotion types, `#rrggbb` colors, positive numerics,
valid parent references, and locomotion leg count (biped=2, quadruped=4,
hexapod=6, others 0; flyers may carry tucked legs). Slot budget: reject specs
whose compiled slot count exceeds the configured material budget `maxParts`
(implementer-chosen schema cap, not a canonical constant) — `writePose` must
throw, not clamp.

## 3. Field contract (the parity law)

One set of formulas, two implementations — a pure CPU sampler and the TSL
emitter. They are the SAME math and change in the SAME commit. Unit tests run
against the CPU twin; the shader inherits correctness through the contract.

Tapered capsule distance (spheres are zero-length capsules):

```
t = baLen2 < 1e-12 ? 0 : clamp(dot(p - a, b - a) / baLen2, 0, 1)
d = |p - a - (b - a) * t| - lerp(ra, rb, t)
```

Exactness bound: this lerp-radius form is the true distance only for
`ra = rb`. The exact round-cone surface is the tangent cone of the two end
spheres, not the lerp cone; with taper slope `s = (rb - ra)/|b - a|` the
interior distances are compressed by `sqrt(1 + s²)` (4.4% at `|s| = 0.3`).
Acceptable within the gradient gates below; for stronger tapers use the exact
round-cone distance with its tangency case split.

Pairwise sequential polynomial smooth-min (Quilez), blend radius of the
incoming primitive, `k = max(k_i, 1e-5)`:

```
h = clamp(0.5 + 0.5 * (d - d_i) / k, 0, 1)
d = lerp(d, d_i, h) - k * h * (1 - h)
```

Sequential smin is NOT commutative: canonicalize part order at compile time
(sort by stable part id) so authored/generated array order can never change
the surface. For authored control over "limb blends into body but not into
antenna", make blend topology explicit (per-part `kCap`, or symmetric
`k_ij = min(k_i, k_j)` edges over the compile-time adjacency) rather than
relying on order side effects.

Analytic gradient, fused into the same loop — never ship 6-tap finite
differences in the shader:

```
q        = p - a - (b - a) * t
radial   = q / max(|q|, 1e-6)
s        = (rb - ra) / max(|b - a|, 1e-6)     // taper slope; 0 for uniform capsules/spheres
gradPrim = radial - s * normalize(b - a)      // axial term only while 0 < t < 1; caps are radial-only
grad     = mix(grad, gradPrim_i, h)           // through each smin
```

The axial `-s·â` term is the gradient of the `-lerp(ra, rb, t)` taper and is
NOT optional for cones: dropping it tilts normals by `atan(s)` on every
tapered part and fails the CPU gradient gate for any `|s| > ~0.05`. In the
interior region `q ⊥ (b - a)`, so `|gradPrim| = sqrt(1 + s²)`; either
normalize `gradPrim` or account for the magnitude in the gates below.

For the polynomial smooth-min, `mix(gradA, gradB, h)` is the EXACT gradient
in the unclamped interior, not an approximation: with
`h = 0.5 + (d_A - d_B) / (2k)`, the cross terms
`(d_B - d_A)∇h - k(1 - 2h)∇h` cancel identically, and at saturation the mix
degenerates to the surviving branch. The only approximation in the normal
path is treating per-primitive cap/interior transitions as C¹, which the
clamp on `t` makes piecewise-exact. Keep the central-difference gradient
(`GRAD_EPS = 1e-3`, 6 taps) as a CPU verification tap: assert
`|analytic - centralDiff| < 5e-2` over seeded samples near the surface.

Proximity color kernel (softmax over the candidate set):

```
w_i   = exp(-max(d_i - d_min, 0) / max(k_i, 1e-5))
color = Σ w_i * c_i / max(Σ w_i, 1e-12)
```

Newton snap onto `d = iso`, bounded and residual-aware:

```
for step in 0..maxSteps:                 // 2 is enough with early-out
  d, grad = field(p)                     // fused evaluation
  if abs(d - iso) < epsilon: break       // residual early-out
  move = clamp((d - iso) / max(dot(grad, grad), 1e-6), -maxStep, maxStep)
  p -= grad * move
// maxStep = 2 * maxPrimitiveRadius
```

This is the true first-order step `Δp = -(d - iso)·∇d/|∇d|²`. The common
`/|∇d|` variant implicitly assumes `|∇d| = 1`; in blend regions `|∇s| < 1`,
so it undershoots and spends the second iteration finishing the first one's
work. Dividing by `|∇d|²` restores the full Newton step there; the clamp
bounds the move where `|∇d| → 0` near the medial axis.

## 4. Rig compiler

- Slot allocation: capsule/cone/sphere → 1 slot; rope → `segments` slots;
  leg → 2 slots (upper, lower). Primitive record: `a.xyz, ra | b.xyz, rb |
  k, r, g, b` (12 floats).
- Anchors accumulate over parent chains in parent-local space; `scale`
  multiplies every length and radius; defaults: color `[0.85, 0.72, 0.5]`,
  `k = r * 0.6`, k floor `1e-4`.
- `bodyLift = max over legs((upper + lower) * 0.92 - hip.y)` keeps knees bent.
- Pose transform, in order: volume-preserving squash about the ground plane
  (`y *= squash`, `xz *= 1/sqrt(max(squash, 0.05))`), roll, yaw, translate
  (+ `bodyLift * min(squash, 1)` vertical).
- Compile-time candidate sets: expand each primitive's rest AABB by `r + k`;
  two parts are blend-adjacent if the expanded boxes intersect. Each emitted
  vertex stores its owner slot + up to K adjacent slots. Poses deform, so pad
  adjacency by the locomotion's maximum excursion (leg reach, rope length,
  flap amplitude) — validate at lab time by asserting the snapped
  candidate-set surface matches the full-field surface within the residual
  gate across a locomotion sweep.
- K-candidate evaluation is an approximation of the canonical sequential,
  order-dependent global smooth-min fold, not a bounded local rewrite of the
  field. Rest-AABB adjacency is a heuristic candidate selector, not an error
  bound: unsaturated `h` tails can reach in from every primitive, and pose
  deformation invalidates rest-space adjacency. The only accepted bound is the
  `candidate-set vs full-field surface` locomotion sweep gate in §10; if that
  gate fails its threshold, reject the spec/tier or raise K, rebuild the
  candidate sets, and rerun the sweep until it passes.
- Cache compiled geometry by `schemaVersion | compilerVersion | tier | slot
  count and classes | strong digest of geometry-affecting fields`. A bare
  32-bit hash of the spec JSON is collision-prone at library scale and cannot
  invalidate on compiler changes.

## 5. Canonical shell

Per-slot canonical capsule, reconstructed and posed entirely in the vertex
stage from the primitive buffer (`aPart` selects the slot, `aAxial` marks cap
progression; the mesh itself is never re-posed on the CPU):

| Tier | radialSegments | capRings | verts/slot `(2+2c)r+2` | tris/slot `r(4+4c)` |
| --- | ---: | ---: | ---: | ---: |
| hero | 12 | 3 | 98 | 192 |
| crowd | 10 | 2 | 62 | 120 |
| background | 8 | 2 | 50 | 96 |

Add a radial-angle attribute (`aTheta`) alongside `aPart`/`aAxial`: together
with axial `t` they are stable creature-surface coordinates for the detail
ladder (§8) — snap displacement must not be the only surface
parameterization.

Orient winding outward on the CPU against a reconstructed unit capsule and
flip violating triangles; gate with `dot(faceNormal, outward) > 0` for every
pre-snap face. Vertex-basis reconstruction: axis from `b - a` with a
`|axis.y| < 0.99` helper pick — cross-product basis, no quaternions needed.

## 6. Locomotion library

All deterministic: seeded LCG + injected sim clock. Run on a fixed-step
accumulator (clamp input dt, e.g. accumulate ≤ 0.25 s; step at 1/60; keep
previous+current pose; render interpolated). Variable render dt straight into
gait/hop is a known visual bug: one hitch completes half a swing in one frame.

**Reactive planted gait** (2/4/6 legs, one system): feet are world-planted;
a foot lifts when it lags its home (hip projected to ground in the body
frame) by more than `stepLength` AND its diagonal phase group is active;
swings over `swingTime ≈ 0.18 s` with arc `sin(π t) * stepHeight`, landing
overshot `0.5 * stepLength` along velocity. The defaults assume
decimetre-to-metre legs; rescale by dynamic similarity — swing time
`∝ sqrt(L/g)` (pendulum period), and keep the Froude number `v²/(gL) ≲ 1`:
above it real animals stop walking, and a planted gait reads wrong. Gates:
stance feet move `< 1e-9` while planted (stationary and moving); a biped
never lifts both feet.

Foot solve and storage chain: world-planted foot target --apply inverse root
instance transform--> body-frame IK target --solve IK in body frame-->
creature-local upper/lower leg slots --contiguous storage upload-->
posed-AABB culling-bounds update. The root transform is applied exactly once,
by the object/instance matrix after creature-local SoA upload; `rootTransformSingleApplication`
checks that no slot endpoint already contains root translation or root yaw.

**2-bone IK**: clamp reach to `[|l1-l2|+1e-4, l1+l2-1e-4]`;
`a = (l1² - l2² + d²) / 2d`, `h = sqrt(max(l1² - a², 0))`; bend hint points
sideways-out + 0.4 forward in the body frame, made perpendicular to hip→foot
by full 3D Gram-Schmidt. Derived: with a fully orthogonalized unit hint, the
joint at `hip + dir·a + perp·h` reconstructs both limb lengths EXACTLY
(`a² + h² = l1²`; `(d−a)² + h² = l2²` algebraically), so residual error is
f32/f64 rounding only. A partial Gram-Schmidt that drops the Y term leaves a
non-perpendicular component and DOES corrupt lengths — observed ~2e-4 in the
lab's seeded poses (pose-dependent, grows with the hint's Y content; not a
bound). Gate: reconstructed limb lengths match spec to 4 decimals — a loose
ceiling relative to the exact solve, sized to catch exactly that
orthogonalization-bug class (2e-4 fails a 4-decimal match).

**Hopper**: state machine `idle → crouch → air → land`. Physics: air height
is the normalized ballistic parabola `4 t (1 - t) * hopHeight` (`t ∈ [0,1]`;
it also matches launch/landing velocity ratios, which `sin(π t)` does not),
and `airDuration = max(0.28, 0.9 * sqrt(hopHeight))` because flight time over
apex `H` is `2·sqrt(2H/g) = 0.903·sqrt(H)` at `g = 9.81` — the `0.28 s` floor
keeps micro-hops legible (styling). Styling constants: `crouchTime 0.16`,
`landTime 0.14`, idle `0.6–2.2 s`; squash: idle `1 + 0.015 sin(6t)`, crouch
`lerp(1, 0.72, t)`, air `1 + 0.28 cos²(π t) * (t < 0.5 ? 1 : 0.6)`, land
`lerp(0.78, 1, t)`. Squash is volume-preserving via the rig transform.

**Flyer**: closed-form patrol — position on a circle + bob from
`a = phase + simTime * angularSpeed`; yaw follows the tangent; bank
`sign * min(0.5, speed * 0.35)`; flap phase
`phase * 3 + simTime * (4.5 + 2|angularSpeed|) * π`. Sampled, not integrated:
seekable to any time for deterministic capture.

**Verlet ropes** (tails, ears): fixed step 1/60, gravity 3.5 (styling: ≈ g/3
reads calm at creature scale; use `9.81 * scale` for physical), damping keep
`1 - 0.12`, 3 relaxation passes, ≤ 8 substeps per update, dt accumulation
capped at 0.25 s. Anchor follows the posed body; taper radius toward the tip.
Per fixed step, write order is: base body pose writes rest slots after
volume-preserving squash staging; root yaw/translation remain in the instance
transform and are not baked into SoA endpoints; body-frame IK writes leg slots
from planted targets; rope-verlet then writes its consecutive `a.xyz|b.xyz`
segment slots from the final particle chain. If stages target the same slot,
the later stage wins; rope-verlet slot cost is
`ropeSubsteps * ropeRelaxationPasses * ropeSegments`, not O(slots).

**Swimmer**: buoyancy spring toward injected `getWaterHeight(x, z, t)`
(stiffness clamped 1..80, response `clamp(stiffness * dt, 0, 1)`), body
undulation and roll from the swim phase. The injected provider is a water-skill
contract, not a creature-side sampler. Open seas use
`threejs-spectral-ocean/examples/webgpu-fft-ocean/createCpuWaterHeightSampler()`,
which evaluates a dominant-bin truncation of the same authored FFT spectrum and
publishes `estimateTruncationError()`. Bounded pools use
`threejs-water-optics/examples/webgpu-bounded-water/createBoundedWaterHeightQuery()`,
which evaluates the exact authored analytic wave list and declares the live
StorageTexture heightfield residual as a separate budget. The provider owns the
parity-error obligation; creature locomotion treats the query as authoritative,
does not blend in GPU readback, and must keep buoyancy response error against
that injected surface `< 0.09` world units across a seeded run (executed by the
§10 lab gate table — pending until the Wave B lab lands).

## 7. Scale architecture

- **One geometry + one material per species/tier.** Pose in a storage buffer:
  `struct Prim { vec4 a; vec4 b; vec4 meta; }` indexed
  `instanceIndex * maxParts + slot`, via `instancedArray()`/`storage()` nodes
  (verify exact r185 API in installed source — `apiProof` per router). The
  rig writes into one mapped `Float32Array`; one contiguous upload per frame.
- **Bounded evaluation.** Loop over the candidate set (or at minimum a
  dynamic loop bounded by the actual part count `P`), never a masked
  compile-time unroll over the full budget. A K-candidate loop approximates
  the sequential, order-dependent global fold defined in §3; it is accepted
  only by the full-field locomotion sweep gate, so failed sweeps reject the
  spec/tier or raise K before rebuild. **Vertex field cost model** (count
  fused `d, grad` capsule evaluations per shell vertex):

  | Symbol | Meaning |
  | --- | --- |
  | `P` | compiled primitive count for the spec (`≤ maxParts`) |
  | `K` | \|candidate set\| for the vertex (`≤` tier cap in §5) |
  | `S` | accepted Newton snap steps (`≤` tier snap cap) |
  | `Q` | field queries per fused eval (`1` analytic; `7` if central-diff FD) |
  | `C` | extra fused passes over the same candidate indices (color softmax `= 1`; self-AO §8 adds `R` offset samples along `n`) |

  Masked full-budget path (forbidden):

  ```
  E_mask = (S + 1) · Q · P
  ```

  Candidate-set path (mandated):

  ```
  E_cand   = (S + 1) · Q · K
  E_shade  = E_cand + C · (S + 1) · K   // when color/AO reuse the same set
  ```

  ALU ratio at equal `S` (analytic good path vs FD masked path):

  ```
  E_mask(FD) / E_cand(analytic) = 7 · P / K
  ```

  Plug in `P`, `K`, `S` from the spec and tier table — not from any external
  project's constants. Frame ms and population caps are lab measurements (§9),
  never asserted here.
- **Culling.** Root motion in `Object3D`/instance matrix; per-instance
  bounding sphere from final creature-local SoA primitive AABBs each fixed
  step, then transformed to world by the same instance matrix that renders the
  creature. This is the last stage in the foot pipeline from §6 and is where
  root placement affects visibility; frustum-cull instances into a compacted
  visible list (CPU per species cell, or a compute pass at large counts).
- **Material variants.** Cache by `{tier, outline, debugMode, K}`. Toon
  bands, outline width, sun direction, tint, warmth are uniforms — changing
  them must not rebuild node graphs or instances.
- **Outline.** Crowds: creature-ID + normal/depth edge detection as one post
  pass over the population. Hero: iso-offset back-face hull
  (`iso = outlineWidth`) as a second material — accept that it re-runs the
  snap, and strip color/AO work from its graph.
- **Shadow parity.** The depth/shadow path must consume the same snapped
  position function as the display material. Do not assume the renderer
  transfers `positionNode` to the shadow pass — assert it: render a posed
  creature, compare visible silhouette vs shadow-map footprint in a lab test.
- **Debug modes** are build-time material variants (`off | unsnapped |
  distance | weights | normals`): unsnapped shows the pre-snap shell;
  distance heat-maps `|d|` at the surface; weights shows blended albedo;
  normals shows `n * 0.5 + 0.5`. Each is an observable checkpoint in the
  build order: unsnapped must look like posed capsules; distance must be
  near-zero (dark) everywhere after snap; normals must be smooth across
  blends.

## 8. Quality ladder toward skinned-look

Ordered; each rung is optional per tier, and low tiers stop early:

1. **Analytic gradient normals** across blends (baseline — FD normals across
   12-segment tessellation shade as flat patches).
2. **SDF self-AO**:
   `ao = clamp(1 - k_ao · Σ_i 2^{-i} · max(r_i - d(p + n·r_i), 0) / r_i, 0, 1)`
   over 3–5 exponentially spaced radii along the normal, `k_ao ≈ 1`. The
   `/r_i` makes each occlusion term dimensionless, so `k_ao` survives
   creature rescale; grounds limb joins and belly/ground contact. Ground blob shadows for crowds that skip real shadow receive.
3. **Scene-light integration**: keep the authored toon ramp but multiply by
   received shadow/contact terms; creatures that neither receive shadows nor
   see local lights read pasted-on.
4. **Stable surface coordinates** (`aPart` owner, axial `t`, radial `theta`) →
   procedural detail fields in creature space: fur/scale banding, wear,
   counter-shading gradients, per-part roughness/ramp identity. Author via
   `$threejs-procedural-fields` patterns.
5. **Eyes and face as authored meshes** parented to head slots: separate
   small geometry with blink/look-at controls and its own material. SDF
   blend-shells do not do eyes well; do not try.
6. **Secondary motion**: verlet ropes for tails/ears (§6), squash
   states, flap phases; add per-part jiggle springs driven by pose
   acceleration for fleshy creatures.
7. **Hybrid bodies**: for hero anatomy beyond blended capsules, generate a
   rest mesh from the field once (marching cubes/dual contouring offline or
   at load), skin it to the capsule rig by proximity weights, and keep one
   SDF correction step at render. The control rig, locomotion, and spec
   pipeline are unchanged — only the skin swaps.

Ceiling honesty: photoreal humans, cloth, and production animation libraries
still belong to imported skinned assets. This ladder targets stylized
creatures, fauna, mascots, and NPCs — there it can match or beat low-poly
skinned pipelines because morphology is generatable and joints never crease.

## 9. Creature lab contract

A standalone lab app (strict dev port, package-source aliases, zero app
imports) is the proving ground; the shipping scene stays a thin adapter.

- **Deterministic driver**: fixed step 1/60; `seek(t)`, `step(n, dtMs)`,
  `advance(dt)`; gate `seek(1)` ≡ `step(60, 1000/60)` exactly.
- **Programmatic API** (`window.__lab`): telemetry snapshot (rig slots,
  bodyLift, geometry stats, per-creature driver state, camera, renderer,
  last-frame ms), focus/tier/debug/toon controls, spec JSON editor with
  `part.field` errors, seeded generation grid, `renderOnce`, `dispose`.
- **Evidence metrics**: foot-drift markers (planted-foot world delta per
  frame over a stride; gate `< 1e-4`), snap residual sweep across a locomotion
  cycle, seed sweeps for generated specs, tier switcher screenshots, hop apex
  sampling (step the clock to the exact apex — temporal gaps are where QA lies).
- Lab evidence proves the package, never the shipping scene: keep the claim
  boundary explicit in the lab README.

Wire evidence bundles per `$threejs-visual-validation`.

## 10. Numeric gates

Pending gate: the lab that executes this table is not yet built (`HANDOFF.md`
§3 item 3.9e — the register's one open item). Every threshold below is the
contract that lab must enforce; until it exists, none of these rows may be
cited as passed evidence. CPU-derivable rows (smin, gradient, taper) are
additionally checked by the settled-math derivations in §2–§4.

| Gate | Threshold |
| --- | --- |
| smooth-min ≤ hard-min + 1e-9 | 200 seeded samples |
| thin-part blend containment (`kCap`) | ≤ 0.006 excess |
| gradient magnitude near surface | 0.95–1.05 with per-primitive normalization (raw un-normalized magnitude is `sqrt(1 + s²)`; the raw gate only holds for taper slope `|s| ≤ 0.32`) |
| analytic vs central-diff gradient (CPU) | < 5e-2 near surface |
| snap residual after Newton steps | < 0.02 of body scale |
| pre-snap vertex move clamp | < 2 × max radius |
| canonical winding | outward `dot > 0`, every face |
| candidate-set vs full-field surface | within snap residual gate across locomotion sweep |
| stance foot drift (stationary + moving) | < 1e-9 per frame |
| IK limb length reconstruction | 4 decimals |
| swim surface coupling | < 0.09 |
| platform-mounted foot slide | < 1e-4 |
| shadow/silhouette parity | visual assert in lab |
| geometry counts per tier | exact table in §5 |
| determinism | same seed + sim clock ⇒ bit-identical pose |
| pipeline compiles after reveal | 0 (count via `renderer.info` / GPU capture) |
| buffer reallocations after init | 0 — storage sized at population cap |
| per-creature spawn main-thread cost | ≤ 0.25 ms; O(slots) write, zero alloc |
| first revealed frame | ≤ 1.5× steady-state frame time |

Stance-drift thresholds are not contradictory; they measure different frames:

| Threshold | Gate row / evidence | Space and reference frame |
| --- | --- | --- |
| `< 1e-9` | stance foot drift | sim-step-local: per fixed step in creature space after inverse root conversion |
| `< 1e-4` | foot-drift evidence markers | world-space marker displacement accumulated over a stride |
| `< 1e-4` | platform-mounted foot slide | platform-relative displacement under a moving platform transform |

## 11. Boot, compile, and spawn contract

Init-time jank is the dominant failure mode of naïve implementations:
pipeline compilation, geometry generation, and buffer allocation all land on
the frame the first creature appears. Separate costs by lifetime:

| Lifetime | Work | Where |
| --- | --- | --- |
| once per tier | canonical shell geometry (§5) + winding verification — slot-class geometry is species-independent | init; cacheable by versioned digest (§4) |
| once per species | spec validation, rig compile, blend adjacency + candidate sets, material-variant graphs, storage allocation at population cap | init; time-sliced ≤ 4 ms/frame or in a worker (inputs are plain data) |
| once per creature | spec/genome instantiation + first O(slots) pose write | any time; ≤ 0.25 ms, zero allocation |
| per frame | locomotion fixed steps + one contiguous storage upload per species | steady state |

- **Pipeline warm-up.** WebGPU compiles one pipeline per material variant per
  pass on first use; unwarmed, that stall lands on the first visible frame.
  `await renderer.compileAsync(...)` every shippable variant — display,
  depth/shadow, and the outline pass — behind the load screen. Debug variants
  (§7) are lab-only: never warm or ship them.
- **Spawn is a write, not a build.** Population growth touches only the pose
  storage region and the visible-instance list. Buffers are sized at cap at
  init: a WebGPU storage-buffer grow is a new buffer plus bind-group rebuild —
  never mid-scene.
- **No synchronous meshing.** The hybrid rung (§8.7) runs marching cubes /
  dual contouring offline or during the load phase, never at spawn.
- **Determinism makes init cacheable.** Shell geometry, adjacency, and
  candidate sets are pure functions of `(spec, tier, compiler version)` —
  cache by the §4 digest and skip the work on revisit.

Boot gates (also in §10): zero pipeline compilations after reveal (count via
`renderer.info` or a GPU-devtools capture), zero buffer reallocations after
init, per-spawn main-thread cost ≤ 0.25 ms, first revealed frame ≤ 1.5× the
steady-state frame time.

## Architecture upgrade ledger

Do not cite external game implementations as authority. External code may
supply **test fixtures** only; trust comes from the formulas above and the §10
numeric gates executed in the lab.

| Rejected pattern | Mandated replacement |
| --- | --- |
| Masked compile-time unroll over all `P` primitives per vertex | Candidate set of size `K`; loop bounded by `K` or actual `P` |
| `Q = 7` FD gradient taps per shader field query | Fused analytic gradient (`Q = 1`); FD only on CPU for parity |
| Per-instance pose in material uniforms (one draw per creature) | Per-species storage-buffer SoA + instancing |
| `frustumCulled = false` | Local pose + root transform + per-instance posed bounds |
| Crowd outline = second full snap draw per creature | Post ID/normal edge pass; iso-offset hull hero-only |
| Variable render `dt` into gait/hop | Fixed-step accumulator + interpolated presentation pose |
| Order-dependent sequential smin without canonical sort | Sort by stable part id + explicit blend topology (`kCap`, adjacency) |
| Shadow pass assumes display `positionNode` | Same snapped position on cast/receive nodes; lab silhouette gate |
| 32-bit spec hash as sole cache key | Versioned digest: schema + compiler + tier + topology |
| Debug/tier rebuild per creature | Material-variant cache `{tier, outline, debugMode, K}` + uniform scalars |
