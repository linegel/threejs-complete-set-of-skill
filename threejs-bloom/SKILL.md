---
name: threejs-bloom
description: Design workload-selected bloom in Three.js r185 WebGPU/TSL, choosing physical HDR scene bloom versus selective MRT contribution, with exact BloomNode pyramid costs, transparent blending rules, PSF limits, and mobile/tile-GPU gates.
---

# Bloom

Bloom approximates the broad tail of an imaging point-spread function (PSF).
The physically motivated input is scene-linear HDR radiance. A bright-pass and
selective emissive membership are real-time/art-direction approximations, not
optical laws. The base scene must remain readable with bloom disabled.

Use `$threejs-choose-skills` for renderer/budget preflight,
`$threejs-exposure-color-grading` for exposure and output ownership, and
`$threejs-image-pipeline` when the scene pass/MRT is shared.

## Numeric provenance

- **[Derived]** follows from installed r185 source or a displayed equation.
- **[Gated]** is a branch threshold validated on the target scene/device.
- **[Measured]** is target-device evidence.
- **[Authored]** is a starting value or planning ceiling.

Release numbers and list ordering are identifiers, not tuning claims.

## Choose the bloom signal before building MRT

| Visual contract | Input | Decision threshold |
| --- | --- | --- |
| Optical glare: bright direct lighting, reflections, transmission, sky/sun, and emission should respond to one exposure-relative luminance rule | `bloom(sceneColor)` | Default. It needs no bloom-membership MRT and includes final transparent/reflected radiance. |
| Art-directed selective glow: named surfaces must bloom differently from equally bright radiance | `bloom(emissiveContribution)` from the existing scene-pass MRT | Use only when no single bright-pass threshold can meet the contributor false-positive/false-negative contract **[Gated]** and the measured MRT delta fits. |
| Selective boost plus optical highlights | `bloom(sceneColor + authoredBoost)` | Use only when both mechanisms are required and the extra attachment is charged once **[Gated]**. |
| Base form disappears without bloom | neither | Repair geometry/material/lighting first. Bloom is deferred. |

Selective MRT is not automatically higher quality. It omits bright reflected
and transmitted radiance unless those signals are authored into the
contribution target. Full-scene bloom is usually both more physical and cheaper
on bandwidth-limited devices.

## Radiometric And Reactive Contract

When the route declares a physics-to-render boundary, consume its immutable
`PhysicsPresentationCandidate` -> `CameraViewPublication` ->
`ViewPreparationPublication` ->
`PhysicsPresentationSnapshot` chain and bind `LightingTransportSnapshot`
through a provider-wide `PresentedStatePair` (`entityId: typed-absence`) in the
Candidate whose binding ID is referenced by the Snapshot, from the
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Validate the exact central presentation and lighting channel descriptors; do
not redeclare a bloom-local lighting record. Bloom input is scene-linear
radiance in its declared render-local basis. Match the pair's context/provider/
signal IDs, descriptor/state/resource generations, `PresentationStateHandle`,
each state's requested presentation instant, mapped source instant, clock-map
revision/error, and the lighting bundle `sampleInstant`; validate channel
`actualPhysicsTime`, filter/age, maximum staleness, validity, and error.
Irradiance transport values
must pass through the lighting/BRDF contract before bloom. Selective emission
cannot use an unrelated arbitrary intensity scale.

The provenance `requestedPresentationInstant` and bundle `sampleInstant` are
narrow `PhysicsInstant` values. Provider `requestedPhysicsTime` and channel
`actualPhysicsTime` are `PhysicsTime` wrappers whose discriminant selects
exactly one arm consistent with the signal descriptor's `timeSemantics`; a raw
`PhysicsInstant` or `PhysicsTimeInterval` is invalid in either wrapper field.

Basis, quantity, SI unit, bundle `sampleInstant`, channel `actualPhysicsTime`,
state/resource version, validity, and error are checked per canonical channel.
Canonical lighting-provider channels
remain SI-valued. A normalized RGB bloom input is a separately named
render-local signal produced by a versioned SI-to-render conversion with
reference scale, provenance, and error; it is not a normalized canonical
lighting channel. One route-wide label
cannot make `incidentRadiance`, `surfaceIrradiance`,
`directSolarIrradiance`, `skyIrradiance`, `transmittance`, or material emission
dimensionally compatible; applied attenuation uses `attenuationFactorIds`.
A nonphysical route leaves the router physics fields `not used` and declares
only its render-local color contract.

Declare threshold domain explicitly:

- scene-referred threshold: fixed in the bloom input's radiance units;
- exposed-linear threshold: convert each frame by the adapted exposure;
- display-referred threshold: invert the declared output/tone-map path or reject
  the policy when no stable inverse exists.

Do not tune one numeric threshold across incompatible lighting bases. A change
to basis/calibration, working primaries, quantity convention, or exposure-key
policy emits the relevant `ViewPreparationPublication.reactivePublications`
entry and recomputes/reseeds
threshold state before bloom. Shadow commits and discontinuous foam,
emissive, or optical changes produce a versioned radiance-reactive mask for any
upstream temporal history. `BloomNode` itself has no history to reset, but it
must consume the source after required rejection/reseed and publish the same
epoch in diagnostics.
`ViewPreparationPublication.resetDependencies` is an immutable plan; append the performed threshold
conversion, upstream history action, graph rebuild, and submission to
`FrameExecutionRecord`. Device loss appends a `FrameExecutionRecord` with
`overallStatus: device-lost`, affected target execution statuses
`device-lost`, cancelled dependent actions, and lost-generation entries in
`leaseDispositionById`; it invalidates bloom resources and timing evidence without
mutating the sealed snapshot. Rebuild under the new backend/resource generation.

## r185 source facts

Verified against installed `three@0.185.1` **[Measured]**:

| Fact | Consequence |
| --- | --- |
| `bloom(node, strength, radius, threshold)` and `BloomNode.setResolutionScale()` exist. | Use the built-in baseline; do not invent stale pass wrappers. |
| The default internal linear scale is `0.5` **[Derived]**. | It is a source default, not a device-quality decision. |
| High-pass weight is `smoothstep(threshold, threshold + smoothWidth, luminance(input.rgb))` **[Derived]**. | Thresholding occurs in the input's scene-linear domain. `smoothWidth` is a soft knee, not blur radius. |
| The node uses `5` mip levels with separable kernel radii `[6, 10, 14, 18, 22]` **[Derived]**. | It is a multi-Gaussian approximation, not an arbitrary physical PSF. |
| `radius` mixes fixed cross-mip weights; it does not change kernel support **[Derived]**. | Call it a mip-spread control, not a physical radius or sigma. |
| Internal bright/blur targets are RGBA16F **[Derived]**. | BloomNode itself cannot become an R11/RG compact path through a quality flag. |
| Blur stages write alpha `1` and the composite carries nonzero alpha **[Derived]**. | Add bloom RGB while preserving scene alpha when canvas/compositor alpha matters. |
| Only MRT output named `output` uses material blending by default; other outputs default to no blending **[Derived]**. | Transparent emissive contributions overwrite unless the MRT output receives an explicit blend mode. |
| r185 `MRTNode.merge()` assigns merged modes to `blendings`, not the operative `blendModes` map **[Derived]**. | A material-level `mrtNode` can drop the scene emissive blend mode; do not use that combination in the canonical transparent path. |
| `PassNode.compileAsync()` compiles the scene pass, not BloomNode's fullscreen materials **[Derived]**. | Warm and time the complete RenderPipeline; scene compilation alone is insufficient. |

Initialize and hard-gate WebGPU:

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'threejs-bloom requires WebGPU.' );
}
```

There is no non-WebGPU implementation in this skill.

## Canonical graphs

Optical/full-scene path:

```text
one HDR scene pass -> BloomNode(scene color) -> HDR add -> one output transform
```

Selective path:

```text
one HDR scene pass with output + emissive MRT
  -> BloomNode(emissive contribution)
  -> add to scene color
  -> one output transform
```

Both paths use one scene traversal. The selective path adds an HDR attachment;
it does not add a selection scene render.

Treat the HDR add as `vec4(scene.rgb + bloom.rgb, scene.a)`, not an unchecked
vec4 sum. An opaque swapchain can hide alpha corruption that later appears in
DOM/video compositing.

Read [references/hdr-bloom-system.md](references/hdr-bloom-system.md) for
verified code, transparent MRT blending, exact pass/fetch/memory equations,
adaptation rules, and validation.

## Transparent contribution contract

For selective bloom, inspect the emissive texture before tuning bloom. r185
MRT outputs other than `output` do not inherit material blending by default.
Configure the emissive MRT output with `BlendMode(MaterialBlending)`. Author
transparent contribution through the regular `emissiveNode`, already weighted
for the material's premultiplied/straight-alpha policy. Avoid material-level
`mrtNode` overrides in r185 because the stock MRT merge loses the configured
non-output blend map.

Use additive contribution for additive optical energy; use alpha compositing
only when the visible surface uses the same ordered model. Charge transparent
cost by measured covered fragments/overdraw, not object count. A screen-filling
layer can cost more than thousands of tiny contributors.

If visible emission and bloom contribution must diverge per transparent
material, use a separately measured contribution pass or a source-verified
custom MRT fix. This forfeits the stock one-scene-pass guarantee and must be
budgeted explicitly.

## Quality gates

| Tier | Authored start | Gate |
| --- | --- | --- |
| Full | scale `0.5`, strength `0.35-0.75`, mip-spread `0.25-0.45`, soft knee `0.05-0.12` **[Authored]** | HDR signal, PSF footprint, and full marginal time pass at maximum target DPR. |
| Balanced | scale `0.33-0.5`, narrower contribution/threshold range **[Authored]** | Fixed-view halo error is acceptable and measured bloom delta fits. |
| Constrained WebGPU | scale `0.25-0.33`, reduced transparent screen coverage, optional bloom disable **[Authored]** | Tile bandwidth, thermal run, and minimum-mip dimension pass; otherwise disable bloom. |

Threshold has no portable numeric default. Derive it from the stabilized
exposure and a false-color pre-tone luminance view. For selective input,
threshold still controls energy within membership; it is not the membership
mechanism.

The deepest r185 level is valid only when
`floor(scale * min(width, height)) >= 16` **[Derived/Gated]**. Below that, the
fixed `5`-level chain reaches a zero-sized target. Reduce mip count in a custom
node or disable bloom for that surface size; do not rely on undefined tiny-
target behavior.

## Composable marginal budget

```text
deltaBloomFull = time(scene + full-scene bloom) - time(scene)       [Measured]
deltaMRT = time(scene with contribution MRT) - time(scene)          [Measured]
deltaBloomSelective = time(scene + contribution MRT + bloom) - time(scene)
                                                                    [Measured]
route valid iff charged delta <= declaredMarginalBloomBudget        [Gated]
```

If another effect already owns the same emissive attachment, charge its
measured attachment delta once in the unique-work ledger. Use the complete
paired `deltaBloomSelective` for acceptance; do not add independently sampled
MRT and BloomNode percentiles or assume their interaction is zero.

Let `A = scale^2 * width * height` bloom pixels **[Derived]**. The fixed r185
node performs `12` fullscreen draws **[Derived]**: one high-pass, two blur
directions across `5` levels, and one composite. Its allocated internal target
storage approaches `29.3125 * A` bytes before integer-size floors **[Derived]**
and its shader work is about
`42.3047 * A` texture samples plus `4.6641 * A` pixel writes **[Derived]**.

At `1920x1080`, scale `0.5`, internal targets occupy `14.49 MiB`; a selective
RGBA16F emissive attachment adds `15.82 MiB`, for `30.31 MiB` incremental live
image storage before depth, output, MSAA, alignment, and tile scratch
**[Derived]**.

Do not seed the search with adapter-class millisecond tables. They obscure DPR,
HDR sparsity, MRT stores, browser state, and thermal behavior. Declare one
product marginal budget **[Gated]**, measure the complete charged delta with
matched warmed A/B traces **[Measured]**, and reject every tier that misses it.

For a pixel-bound miss, estimate
`nextScale = currentScale * sqrt(budgetMs / measuredMs)` **[Derived]**, clamp
to the tier and minimum-mip gates, then remeasure. The square-root estimate is
invalid when MRT stores, fixed pass overhead, or transparent overdraw dominate.

## Tile/mobile rules

- Prefer full-scene input when it meets the visual contract; it removes the
  full-resolution contribution attachment.
- Measure MRT with the target MSAA count. An RGBA16F contribution attachment is
  `8 * width * height` resolved bytes **[Derived]** and may add multisample tile
  storage before resolve.
- Reduce bloom scale before changing the scene resolution. Bloom cost is
  approximately quadratic in linear scale while the pixel-bound assumption
  holds **[Derived]**.
- Use screen-coverage/overdraw heatmaps for transparent contributors. Sorting,
  destination reads, and two attachment writes can dominate a tile renderer.
- Run a sustained thermal trace; a short desktop capture does not validate
  mobile equilibrium.

## Visual wrongness signatures

| Signature | Cause / decision |
| --- | --- |
| Gray, clipped highlight cores | HDR was clamped or output-converted before high-pass. |
| Uniform milky veil | Threshold/knee admits broad midtones, or strength compensates for a bad source signal. |
| Bright reflections stay razor-sharp while emitters glow | Selective MRT omitted optical radiance; use scene-color or hybrid input. |
| Transparent contributors disappear or pop by draw order | Emissive MRT blending/alpha is wrong. |
| Halo changes with DPR or resize | Fixed mip/kernel footprint changed in output-pixel terms; validate endpoints or use a custom PSF. |
| Blocky staircase around small highlights | Bloom scale is too low for the feature; raise scale or reject bloom for that tier. |
| Tiny hot pixels create enormous halos | Unbounded HDR fireflies; repair sampling/exposure or robustly cap the source before bloom. |
| Scene form vanishes when bloom is disabled | Bloom is carrying silhouette/lighting; repair the base scene. |
| Bloom-off timing is unchanged | Bloom remains reachable in the active graph; replace output node and set `needsUpdate`. |
| Transparent canvas gains an opaque rectangle or wrong edge alpha | Bloom alpha was added to scene alpha; preserve base alpha explicitly. |

## Ownership boundary

This skill owns source-signal selection, BloomNode controls, selective MRT
contribution, transparent blending, PSF diagnostics, and bloom marginal cost.
Exposure/color grading owns metering, adaptation, tone mapping, and display
conversion. Image-pipeline owns shared scene passes and global ordering.
